/**
 * OpenAlice-owned resumable conversation identities.
 *
 * Product surfaces exchange `resumeId`; native runtime session ids never cross
 * the backend boundary. This registry is the translation table between that
 * stable product identity and the current CLI-specific conversation id.
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

import type { Logger } from './logger.js'
import { generateResumeId } from './resume-id.js'
import type { SessionRuntimeBinding } from './cli-adapter.js'
import type { SessionMetadata } from './session-metadata.js'
import { parseSessionMetadata } from './session-metadata.js'
import type { SessionRuntimeBindingStore } from './session-runtime-store.js'

export type SessionPresence = 'active' | 'archived' | 'deleted'

export function sessionPresence(
  record: { readonly presence?: SessionPresence } | null | undefined,
): SessionPresence {
  return record?.presence ?? 'active'
}

export function parseSessionPresence(value: unknown): SessionPresence | undefined {
  if (value === 'active' || value === 'archived' || value === 'deleted') return value
  return undefined
}

export function canTransitionPresence(from: SessionPresence, to: SessionPresence): boolean {
  if (from === to) return true
  if (from === 'active' && to === 'archived') return true
  if (from === 'archived' && (to === 'active' || to === 'deleted')) return true
  if (from === 'deleted' && to === 'archived') return true
  return false
}

export class ResumePresenceError extends Error {
  constructor(
    readonly code: 'not_found' | 'retired' | 'wrong_workspace' | 'invalid_transition',
    message: string,
  ) {
    super(message)
    this.name = 'ResumePresenceError'
  }
}

export interface ResumeIdentityRecord {
  readonly resumeId: string
  readonly wsId: string
  readonly agent: string
  /** Runtime-only hydration of the Workspace-owned AI config. Launch paths
   * keep the Agent runtime frozen; an idle Session may replace credential,
   * model, and effort through Session settings or the Issue page. */
  runtimeBinding?: SessionRuntimeBinding
  /** Workspace-owned coworker nametag. Hydrated from the Session dossier; never flushed here. */
  displayName?: string
  agentSessionId?: string
  latestTaskId?: string
  readonly createdAt: number
  updatedAt: number
  /** Product employment state. Native transcript history is retained either way. */
  lifecycle: 'active' | 'retired'
  /**
   * In-desk floor presence. Missing means active. Distinct from `lifecycle`:
   * `retired` still means the coworker left with the Workspace.
   */
  presence?: SessionPresence
  retiredAt?: number
  retirementReason?: string
  successorResumeId?: string
  /**
   * Immutable product bag (birth first). Written only when the identity is
   * created; later ensure() calls never rewrite it. Historical records omit it.
   */
  metadata?: SessionMetadata
}

export class ResumeRegistry {
  private readonly records = new Map<string, ResumeIdentityRecord>()
  private flushChain: Promise<void> = Promise.resolve()

  private constructor(
    private readonly path: string,
    private readonly logger: Logger,
    private readonly runtimeBindings: SessionRuntimeBindingStore,
  ) {}

  static async load(
    path: string,
    logger: Logger,
    runtimeBindings: SessionRuntimeBindingStore,
  ): Promise<ResumeRegistry> {
    const registry = new ResumeRegistry(path, logger, runtimeBindings)
    await registry.read()
    return registry
  }

  private async read(): Promise<void> {
    try {
      const parsed = JSON.parse(await readFile(this.path, 'utf8')) as { version?: unknown; records?: unknown }
      if (parsed.version !== 1 || !Array.isArray(parsed.records)) {
        throw new Error('resume-identities.json has an unsupported shape')
      }
      for (const value of parsed.records) {
        if (!value || typeof value !== 'object') throw new Error('resume-identities.json contains an invalid record')
        const record = value as Record<string, unknown>
        if (
          typeof record['resumeId'] !== 'string' ||
          typeof record['wsId'] !== 'string' ||
          typeof record['agent'] !== 'string' ||
          typeof record['createdAt'] !== 'number' ||
          typeof record['updatedAt'] !== 'number'
        ) throw new Error('resume-identities.json contains an invalid record')
        const dossier = await this.runtimeBindings.readDossier({
          wsId: record['wsId'],
          resumeId: record['resumeId'],
          agent: record['agent'],
        })
        const metadata = parseSessionMetadata(record['metadata'])
        const presence = parseSessionPresence(record['presence'])
        this.records.set(record['resumeId'], {
          resumeId: record['resumeId'],
          wsId: record['wsId'],
          agent: record['agent'],
          createdAt: record['createdAt'],
          updatedAt: record['updatedAt'],
          lifecycle: record['lifecycle'] === 'retired' ? 'retired' : 'active',
          ...(presence && presence !== 'active' ? { presence } : {}),
          ...(typeof record['agentSessionId'] === 'string'
            ? { agentSessionId: record['agentSessionId'] }
            : {}),
          ...(typeof record['latestTaskId'] === 'string'
            ? { latestTaskId: record['latestTaskId'] }
            : {}),
          ...(dossier?.ai ? { runtimeBinding: dossier.ai } : {}),
          ...(dossier?.displayName ? { displayName: dossier.displayName } : {}),
          ...(typeof record['retiredAt'] === 'number'
            ? { retiredAt: record['retiredAt'] }
            : {}),
          ...(typeof record['retirementReason'] === 'string'
            ? { retirementReason: record['retirementReason'] }
            : {}),
          ...(typeof record['successorResumeId'] === 'string'
            ? { successorResumeId: record['successorResumeId'] }
            : {}),
          ...(metadata ? { metadata } : {}),
        })
      }
    } catch (err) {
      // Migration creates the file for existing installs. A fresh install has
      // no identities until its first conversation is created.
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return
      this.logger.error('resume_registry.read_failed', { path: this.path, err })
      // Resume identities are the durable employment/signature ledger. A
      // malformed file must stop startup instead of silently making every
      // coworker appear new and severing provenance links.
      throw err
    }
  }

  get(resumeId: string): ResumeIdentityRecord | null {
    return this.records.get(resumeId) ?? null
  }

  /** Backend records newest-first. Callers must project them before crossing an
   * API/tool boundary because records also carry the native runtime mapping. */
  list(opts: { wsId?: string; limit?: number } = {}): ResumeIdentityRecord[] {
    const records = [...this.records.values()]
      .filter((record) => !opts.wsId || record.wsId === opts.wsId)
      .sort((a, b) => b.updatedAt - a.updatedAt)
    return opts.limit && opts.limit > 0 ? records.slice(0, opts.limit) : records
  }

  async ensure(input: {
    resumeId?: string
    wsId: string
    agent: string
    agentSessionId?: string
    latestTaskId?: string
    runtimeBinding?: SessionRuntimeBinding
    /** Birth bag for a newly allocated identity. Ignored when resuming existing. */
    metadata?: SessionMetadata
    now?: number
  }): Promise<ResumeIdentityRecord> {
    const resumeId = input.resumeId ?? generateResumeId({
      isTaken: (candidate) => this.records.has(candidate),
    })
    const existing = this.records.get(resumeId)
    if (existing) {
      if (existing.wsId !== input.wsId || existing.agent !== input.agent) {
        throw new Error(`resume identity ${resumeId} belongs to ${existing.wsId}/${existing.agent}`)
      }
      if (existing.lifecycle === 'retired') {
        throw new Error(`resume identity ${resumeId} is retired`)
      }
      if (sessionPresence(existing) === 'deleted') {
        throw new Error(`resume identity ${resumeId} is deleted`)
      }
      if (
        input.runtimeBinding
        && existing.runtimeBinding
        && JSON.stringify(input.runtimeBinding) !== JSON.stringify(existing.runtimeBinding)
      ) {
        throw new Error(`resume identity ${resumeId} already owns a different runtime binding`)
      }
      if (input.runtimeBinding && !existing.runtimeBinding) {
        await this.runtimeBindings.ensure({
          wsId: input.wsId,
          resumeId,
          agent: input.agent,
          binding: input.runtimeBinding,
        })
        existing.runtimeBinding = input.runtimeBinding
      }
      if (input.agentSessionId) existing.agentSessionId = input.agentSessionId
      if (input.latestTaskId) existing.latestTaskId = input.latestTaskId
      // metadata.createdBy is first-write-wins: never rewrite on ensure of an
      // existing identity, even when callers pass a different stamp.
      existing.updatedAt = input.now ?? Date.now()
      await this.flush()
      return existing
    }
    if (input.runtimeBinding) {
      await this.runtimeBindings.ensure({
        wsId: input.wsId,
        resumeId,
        agent: input.agent,
        binding: input.runtimeBinding,
      })
    }
    const now = input.now ?? Date.now()
    const record: ResumeIdentityRecord = {
      resumeId,
      wsId: input.wsId,
      agent: input.agent,
      createdAt: now,
      updatedAt: now,
      lifecycle: 'active',
      ...(input.agentSessionId ? { agentSessionId: input.agentSessionId } : {}),
      ...(input.latestTaskId ? { latestTaskId: input.latestTaskId } : {}),
      ...(input.runtimeBinding ? { runtimeBinding: input.runtimeBinding } : {}),
      ...(input.metadata ? { metadata: input.metadata } : {}),
    }
    this.records.set(resumeId, record)
    await this.flush()
    return record
  }

  async setPresence(input: {
    resumeId: string
    wsId: string
    presence: SessionPresence
    now?: number
  }): Promise<ResumeIdentityRecord> {
    const record = this.records.get(input.resumeId)
    if (!record) throw new ResumePresenceError('not_found', `resume identity ${input.resumeId} was not found`)
    if (record.wsId !== input.wsId) {
      throw new ResumePresenceError('wrong_workspace', `resume identity ${input.resumeId} belongs to ${record.wsId}`)
    }
    if (record.lifecycle === 'retired') {
      throw new ResumePresenceError('retired', `resume identity ${input.resumeId} is retired`)
    }
    const current = sessionPresence(record)
    if (!canTransitionPresence(current, input.presence)) {
      throw new ResumePresenceError(
        'invalid_transition',
        `cannot move resume identity ${input.resumeId} from ${current} to ${input.presence}`,
      )
    }
    if (input.presence === 'active') delete record.presence
    else record.presence = input.presence
    record.updatedAt = input.now ?? Date.now()
    await this.flush()
    return record
  }

  async bindAgentSessionId(resumeId: string, agentSessionId: string): Promise<void> {
    const record = this.records.get(resumeId)
    if (!record || record.agentSessionId === agentSessionId) return
    record.agentSessionId = agentSessionId
    record.updatedAt = Date.now()
    await this.flush()
  }

  async replaceRuntimeBinding(input: {
    resumeId: string
    wsId: string
    agent: string
    runtimeBinding: SessionRuntimeBinding
    now?: number
  }): Promise<ResumeIdentityRecord> {
    const record = this.records.get(input.resumeId)
    if (!record) throw new Error(`resume identity ${input.resumeId} was not found`)
    if (record.wsId !== input.wsId || record.agent !== input.agent) {
      throw new Error(`resume identity ${input.resumeId} belongs to ${record.wsId}/${record.agent}`)
    }
    if (record.lifecycle === 'retired') {
      throw new Error(`resume identity ${input.resumeId} is retired`)
    }
    await this.runtimeBindings.replace({
      wsId: input.wsId,
      resumeId: input.resumeId,
      agent: input.agent,
      binding: input.runtimeBinding,
    })
    record.runtimeBinding = input.runtimeBinding
    record.updatedAt = input.now ?? Date.now()
    await this.flush()
    return record
  }

  async setDisplayName(input: {
    resumeId: string
    wsId: string
    displayName: string | null
  }): Promise<ResumeIdentityRecord> {
    const record = this.records.get(input.resumeId)
    if (!record) throw new ResumePresenceError('not_found', `resume identity ${input.resumeId} was not found`)
    if (record.wsId !== input.wsId) {
      throw new ResumePresenceError('wrong_workspace', `resume identity ${input.resumeId} belongs to ${record.wsId}`)
    }
    if (record.lifecycle === 'retired') {
      throw new ResumePresenceError('retired', `resume identity ${input.resumeId} is retired`)
    }
    const displayName = await this.runtimeBindings.setDisplayName({
      wsId: input.wsId,
      resumeId: input.resumeId,
      agent: record.agent,
      displayName: input.displayName,
    })
    if (displayName) record.displayName = displayName
    else delete record.displayName
    return record
  }

  async retireWorkspace(
    wsId: string,
    input: { reason: string; successors?: Readonly<Record<string, string>>; now?: number },
  ): Promise<ResumeIdentityRecord[]> {
    const now = input.now ?? Date.now()
    const changed: ResumeIdentityRecord[] = []
    for (const record of this.records.values()) {
      if (record.wsId !== wsId) continue
      record.lifecycle = 'retired'
      record.retiredAt = now
      record.retirementReason = input.reason
      const successor = input.successors?.[record.resumeId]
      if (successor) record.successorResumeId = successor
      record.updatedAt = now
      changed.push(record)
    }
    if (changed.length > 0) await this.flush()
    return changed
  }

  /** Restore the old coworkers with their old signatures and native mappings. */
  async recallWorkspace(wsId: string, now = Date.now()): Promise<ResumeIdentityRecord[]> {
    const changed: ResumeIdentityRecord[] = []
    for (const record of this.records.values()) {
      if (record.wsId !== wsId || record.lifecycle !== 'retired') continue
      record.lifecycle = 'active'
      delete record.retiredAt
      delete record.retirementReason
      delete record.successorResumeId
      record.updatedAt = now
      changed.push(record)
    }
    if (changed.length > 0) await this.flush()
    return changed
  }

  private async flush(): Promise<void> {
    const next = this.flushChain.then(() => this.flushNow())
    this.flushChain = next.catch(() => undefined)
    await next
  }

  private async flushNow(): Promise<void> {
    try {
      await mkdir(dirname(this.path), { recursive: true })
      const tmp = `${this.path}.tmp`
      const records = [...this.records.values()].map(({
        runtimeBinding: _runtimeBinding,
        displayName: _displayName,
        ...record
      }) => record)
      await writeFile(tmp, JSON.stringify({ version: 1, records }, null, 2), 'utf8')
      await rename(tmp, this.path)
    } catch (err) {
      this.logger.warn('resume_registry.flush_failed', { err })
      // Callers such as Workspace offboarding depend on retirement being
      // durable before the Catalog transition is committed.
      throw err
    }
  }
}
