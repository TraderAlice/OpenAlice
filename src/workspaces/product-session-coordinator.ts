import type { SessionRuntimeBinding } from './cli-adapter.js'
import type { Logger } from './logger.js'
import { generatePetnameId } from './petname-id.js'
import {
  type ResumeIdentityRecord,
  type ResumeRegistry,
} from './resume-registry.js'
import type { SessionMetadata } from './session-metadata.js'
import {
  normalizeSessionTitle,
  type SessionRecord,
  type SessionRegistry,
} from './session-registry.js'

export type ProductSessionSurface = NonNullable<SessionRecord['surface']>

export interface EnsureProductSessionInput {
  readonly resumeId?: string
  readonly wsId: string
  readonly agent: string
  readonly namePrefix: string
  readonly agentSessionId?: string
  readonly latestTaskId?: string
  readonly runtimeBinding?: SessionRuntimeBinding
  readonly metadata?: SessionMetadata
  readonly recordId?: string
  readonly state?: SessionRecord['state']
  readonly surface?: ProductSessionSurface
  readonly fallbackTitle?: string
  readonly sourceRunId?: string
  /** Preserve the historical birth time while repairing a missing roster row. */
  readonly recordCreatedAt?: number
  readonly now?: number
}

export interface EnsuredProductSession {
  readonly identity: ResumeIdentityRecord
  readonly session: SessionRecord
  readonly created: boolean
}

/**
 * Keeps the product identity ledger and the durable Session roster paired.
 *
 * ResumeRegistry remains the sole allocator and native-id translation table;
 * SessionRegistry remains the launcher/UI roster. This coordinator owns the
 * invariant that every non-purged resume identity has exactly one roster row
 * from birth, regardless of whether its first execution is headless, terminal,
 * or WebPi. Presence and retirement hide or disable a row; they do not destroy
 * the durable pairing.
 */
export class ProductSessionCoordinator {
  private readonly mutationTails = new Map<string, Promise<unknown>>()

  constructor(
    private readonly resumes: ResumeRegistry,
    private readonly sessions: SessionRegistry,
    private readonly logger: Logger,
  ) {}

  async ensure(input: EnsureProductSessionInput): Promise<EnsuredProductSession> {
    const identity = await this.resumes.ensure({
      ...(input.resumeId ? { resumeId: input.resumeId } : {}),
      wsId: input.wsId,
      agent: input.agent,
      ...(input.agentSessionId ? { agentSessionId: input.agentSessionId } : {}),
      ...(input.latestTaskId ? { latestTaskId: input.latestTaskId } : {}),
      ...(input.runtimeBinding ? { runtimeBinding: input.runtimeBinding } : {}),
      ...(input.metadata ? { metadata: input.metadata } : {}),
      ...(input.now !== undefined ? { now: input.now } : {}),
    })
    return this.ensureRecord(identity, input)
  }

  private ensureRecord(
    identity: ResumeIdentityRecord,
    input: EnsureProductSessionInput,
  ): Promise<EnsuredProductSession> {
    return this.serialize(identity.resumeId, async () => {
      await this.sessions.ensureLoaded(identity.wsId)
      const existing = this.sessions.findByResumeId(identity.wsId, identity.resumeId)
      if (existing) {
        if (existing.agent !== identity.agent) {
          throw new Error(
            `session record ${existing.id} belongs to ${existing.wsId}/${existing.agent}, ` +
            `but resume identity ${identity.resumeId} belongs to ${identity.wsId}/${identity.agent}`,
          )
        }
        const patch: {
          state?: SessionRecord['state']
          surface?: SessionRecord['surface']
          fallbackTitle?: string
          sourceRunId?: string
          resumeHint?: SessionRecord['resumeHint']
          lastActiveAt?: string
        } = {}
        if (input.state && existing.state !== input.state) patch.state = input.state
        if (input.surface && existing.surface !== input.surface) patch.surface = input.surface
        const fallbackTitle = normalizeSessionTitle(input.fallbackTitle)
        if (fallbackTitle && !existing.fallbackTitle) patch.fallbackTitle = fallbackTitle
        if (input.sourceRunId && !existing.sourceRunId) patch.sourceRunId = input.sourceRunId
        if (input.agentSessionId && !existing.resumeHint) {
          patch.resumeHint = { kind: 'agent-session-id', value: input.agentSessionId }
        }
        if (Object.keys(patch).length > 0) {
          patch.lastActiveAt = new Date(input.now ?? Date.now()).toISOString()
          const updated = await this.sessions.update(identity.wsId, existing.id, patch)
          if (!updated) throw new Error(`SessionRecord disappeared during ensure: ${existing.id}`)
          return { identity, session: updated, created: false }
        }
        return { identity, session: existing, created: false }
      }

      const now = input.recordCreatedAt ?? input.now ?? Date.now()
      const createdAt = new Date(now).toISOString()
      const fallbackTitle = normalizeSessionTitle(input.fallbackTitle)
      const recordId = input.recordId ?? generatePetnameId(identity.agent, {
        fallbackPrefix: 'session',
        isTaken: (candidate) =>
          this.sessions.findById(candidate) !== undefined,
      })
      const record: SessionRecord = {
        id: recordId,
        resumeId: identity.resumeId,
        wsId: identity.wsId,
        agent: identity.agent,
        name: this.sessions.nextName(identity.wsId, identity.agent, input.namePrefix),
        createdAt,
        lastActiveAt: createdAt,
        state: input.state ?? 'paused',
        surface: input.surface ?? 'headless',
        ...(fallbackTitle ? { fallbackTitle } : {}),
        ...(input.sourceRunId ? { sourceRunId: input.sourceRunId } : {}),
        ...(input.agentSessionId
          ? { resumeHint: { kind: 'agent-session-id' as const, value: input.agentSessionId } }
          : {}),
      }
      await this.sessions.create(record)
      this.logger.info('product_session.created', {
        wsId: record.wsId,
        recordId: record.id,
        resumeId: record.resumeId,
        agent: record.agent,
        surface: record.surface,
      })
      return { identity, session: record, created: true }
    })
  }

  async transition(input: {
    readonly wsId: string
    readonly resumeId: string
    readonly state: SessionRecord['state']
    readonly surface: ProductSessionSurface
    readonly sourceRunId?: string
    readonly now?: number
  }): Promise<SessionRecord> {
    return this.serialize(input.resumeId, async () => {
      await this.sessions.ensureLoaded(input.wsId)
      const record = this.sessions.findByResumeId(input.wsId, input.resumeId)
      if (!record) {
        throw new Error(`missing SessionRecord for resume identity: ${input.resumeId}`)
      }
      const updated = await this.sessions.update(input.wsId, record.id, {
        state: input.state,
        surface: input.surface,
        lastActiveAt: new Date(input.now ?? Date.now()).toISOString(),
        ...(input.sourceRunId && !record.sourceRunId ? { sourceRunId: input.sourceRunId } : {}),
      })
      if (!updated) throw new Error(`SessionRecord disappeared during transition: ${record.id}`)
      return updated
    })
  }

  /** Startup invariant repair. The migration handles released layouts; this
   * additionally repairs an interrupted two-file birth after a process crash. */
  async reconcile(input: {
    readonly namePrefixForAgent: (agent: string) => string
    /** A purged Workspace intentionally owns no remaining Session roster. */
    readonly shouldRetain?: (identity: ResumeIdentityRecord) => boolean
    readonly fallbackForResume?: (resumeId: string) => {
      readonly title?: string
      readonly sourceRunId?: string
    } | undefined
  }): Promise<number> {
    for (const record of this.sessions.listAll()) {
      const identity = this.resumes.get(record.resumeId)
      if (!identity) {
        throw new Error(
          `SessionRecord ${record.id} has no ResumeIdentityRecord: ${record.resumeId}`,
        )
      }
      if (identity.wsId !== record.wsId || identity.agent !== record.agent) {
        throw new Error(
          `SessionRecord ${record.id} ownership conflicts with resume identity ${record.resumeId}`,
        )
      }
    }
    let repaired = 0
    for (const identity of this.resumes.list()) {
      if (input.shouldRetain && !input.shouldRetain(identity)) continue
      await this.sessions.ensureLoaded(identity.wsId)
      if (this.sessions.findByResumeId(identity.wsId, identity.resumeId)) continue
      const fallback = input.fallbackForResume?.(identity.resumeId)
      await this.ensureRecord(identity, {
        resumeId: identity.resumeId,
        wsId: identity.wsId,
        agent: identity.agent,
        namePrefix: input.namePrefixForAgent(identity.agent),
        ...(identity.agentSessionId ? { agentSessionId: identity.agentSessionId } : {}),
        ...(identity.latestTaskId ? { latestTaskId: identity.latestTaskId } : {}),
        ...(identity.runtimeBinding ? { runtimeBinding: identity.runtimeBinding } : {}),
        state: 'paused',
        surface: identity.latestTaskId ? 'headless' : 'terminal',
        ...(fallback?.title ? { fallbackTitle: fallback.title } : {}),
        ...(fallback?.sourceRunId ? { sourceRunId: fallback.sourceRunId } : {}),
        recordCreatedAt: identity.createdAt,
      })
      repaired += 1
    }
    if (repaired > 0) this.logger.info('product_session.reconciled', { repaired })
    return repaired
  }

  private serialize<T>(resumeId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.mutationTails.get(resumeId) ?? Promise.resolve()
    const result = previous.then(operation, operation)
    const settled = result.then(() => undefined, () => undefined)
    this.mutationTails.set(resumeId, settled)
    void settled.finally(() => {
      if (this.mutationTails.get(resumeId) === settled) this.mutationTails.delete(resumeId)
    })
    return result
  }
}
