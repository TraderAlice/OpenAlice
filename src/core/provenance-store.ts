/**
 * Durable Session -> artifact provenance.
 *
 * `resumeId` is the product Session identity. Native runtime session ids never
 * enter this store. Records are durable attribution activities; mutable
 * artifacts accumulate edges instead of overwriting one "author" field.
 * High-frequency updates may advance one activity window's timestamp.
 */
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

import { z } from 'zod'

import type { InboxOrigin } from './inbox-store.js'

const executionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('headless'), taskId: z.string().min(1) }),
  z.object({ kind: z.literal('interactive'), sessionRecordId: z.string().min(1) }),
])

export const sessionOriginSchema = z.object({
  kind: z.literal('session'),
  workspaceId: z.string().min(1),
  resumeId: z.string().min(1),
  agent: z.string().min(1),
  execution: executionSchema.optional(),
})
export type SessionOrigin = z.infer<typeof sessionOriginSchema>

export const artifactRefSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('inbox'), inboxEntryId: z.string().min(1) }),
  z.object({ kind: z.literal('issue'), workspaceId: z.string().min(1), issueId: z.string().min(1) }),
  z.object({
    kind: z.literal('report'),
    workspaceId: z.string().min(1),
    path: z.string().min(1),
    revision: z.string().min(1).optional(),
  }),
  z.object({
    kind: z.literal('trade-decision'),
    accountId: z.string().min(1),
    decisionId: z.string().min(1),
  }),
])
export type ArtifactRef = z.infer<typeof artifactRefSchema>

export const provenanceActions = ['created', 'updated', 'commented', 'sent', 'decided', 'reconstructed'] as const
export type ProvenanceAction = (typeof provenanceActions)[number]

const originSchema = z.union([
  sessionOriginSchema,
  z.object({ kind: z.literal('human') }),
  z.object({ kind: z.literal('external'), system: z.string().min(1) }),
  z.object({ kind: z.literal('unknown'), reason: z.string().min(1) }),
])
export type ArtifactOrigin = z.infer<typeof originSchema>

/** Compact field-level audit payload. Large documents such as Issue What are
 * represented by a field-only entry; Git remains the content rollback layer. */
const provenanceFieldChangeSchema = z.object({
  field: z.string().min(1).max(64),
  before: z.string().max(1000).optional(),
  after: z.string().max(1000).optional(),
})
export type ProvenanceFieldChange = z.infer<typeof provenanceFieldChangeSchema>

const provenanceMutationSchema = z.object({
  fields: z.array(provenanceFieldChangeSchema).min(1).max(24),
})
export type ProvenanceMutation = z.infer<typeof provenanceMutationSchema>

const recordSchema = z.object({
  id: z.string().min(1),
  artifact: artifactRefSchema,
  action: z.enum(provenanceActions),
  origin: originSchema,
  at: z.number().finite(),
  fingerprint: z.string().min(1).optional(),
  mutation: provenanceMutationSchema.optional(),
})
export type ProvenanceRecord = z.infer<typeof recordSchema>

/** Consecutive low-level updates inside one editing session are one product
 * activity, not one timeline row per autosave / agent patch. */
export const ACTIVITY_UPDATE_COALESCE_MS = 15 * 60 * 1000

export interface ProvenanceAppendOptions {
  coalesceWithinMs?: number
}

export interface ProvenanceQuery {
  artifact?: ArtifactRef
  action?: ProvenanceAction
  resumeId?: string
  limit?: number
}

export interface IProvenanceStore {
  append(
    input: Omit<ProvenanceRecord, 'id'> & { id?: string },
    options?: ProvenanceAppendOptions,
  ): Promise<ProvenanceRecord>
  list(query?: ProvenanceQuery): ProvenanceRecord[]
  latest(query: ProvenanceQuery): ProvenanceRecord | null
}

interface LoggerLike {
  warn(message: string, meta?: Record<string, unknown>): void
}

export class ArtifactProvenanceStore implements IProvenanceStore {
  private records: ProvenanceRecord[] = []
  private flushChain: Promise<void> = Promise.resolve()

  private constructor(
    private readonly path: string,
    private readonly logger: LoggerLike,
  ) {}

  static async load(path: string, logger: LoggerLike): Promise<ArtifactProvenanceStore> {
    const store = new ArtifactProvenanceStore(path, logger)
    await store.read()
    return store
  }

  private async read(): Promise<void> {
    try {
      const parsed = JSON.parse(await readFile(this.path, 'utf8')) as { records?: unknown[] }
      this.records = (Array.isArray(parsed.records) ? parsed.records : [])
        .map((value) => recordSchema.safeParse(value))
        .filter((result): result is z.ZodSafeParseSuccess<ProvenanceRecord> => result.success)
        .map((result) => result.data)
    } catch {
      this.records = []
    }
  }

  async append(
    input: Omit<ProvenanceRecord, 'id'> & { id?: string },
    options: ProvenanceAppendOptions = {},
  ): Promise<ProvenanceRecord> {
    const candidate = recordSchema.parse({ ...input, id: input.id ?? randomUUID() })
    if (candidate.fingerprint) {
      const existing = this.records.find((record) => record.fingerprint === candidate.fingerprint)
      if (existing) return existing
    }

    const coalesceWithinMs = options.coalesceWithinMs ?? 0
    if (coalesceWithinMs > 0) {
      // Coalesce only with the latest activity for this artifact. An intervening
      // create/comment/send/etc. starts a new activity window even if an older
      // update has the same origin.
      const previous = this.latest({ artifact: candidate.artifact })
      const elapsed = previous ? candidate.at - previous.at : -1
      if (
        previous &&
        previous.action === candidate.action &&
        artifactOriginsMatch(previous.origin, candidate.origin) &&
        elapsed >= 0 && elapsed <= coalesceWithinMs
      ) {
        if (candidate.mutation) {
          const merged = mergeProvenanceMutation(previous.mutation, candidate.mutation)
          if (merged.fields.length > 0) previous.mutation = merged
          else delete previous.mutation
        }
        previous.at = candidate.at
        await this.flush()
        return previous
      }
    }

    this.records.push(candidate)
    await this.flush()
    return candidate
  }

  list(query: ProvenanceQuery = {}): ProvenanceRecord[] {
    let records = this.records.filter((record) =>
      (!query.artifact || artifactMatches(record.artifact, query.artifact)) &&
      (!query.action || record.action === query.action) &&
      (!query.resumeId || (record.origin.kind === 'session' && record.origin.resumeId === query.resumeId)),
    )
    records = [...records].sort((a, b) => b.at - a.at)
    return query.limit && query.limit > 0 ? records.slice(0, query.limit) : records
  }

  latest(query: ProvenanceQuery): ProvenanceRecord | null {
    return this.list({ ...query, limit: 1 })[0] ?? null
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
      await writeFile(tmp, JSON.stringify({ version: 1, records: this.records }, null, 2) + '\n', {
        mode: 0o600,
      })
      await rename(tmp, this.path)
    } catch (err) {
      this.logger.warn('provenance_store.flush_failed', { err })
    }
  }
}

/** Keep the first observed value and the latest value inside one autosave/edit
 * window. A field that returns to its original value disappears from the net
 * activity; content-only fields remain as one compact "edited" entry. */
export function mergeProvenanceMutation(
  previous: ProvenanceMutation | undefined,
  next: ProvenanceMutation,
): ProvenanceMutation {
  const fields = new Map<string, ProvenanceFieldChange>()
  for (const change of previous?.fields ?? []) fields.set(change.field, { ...change })
  for (const change of next.fields) {
    const earlier = fields.get(change.field)
    const merged: ProvenanceFieldChange = earlier
      ? {
          field: change.field,
          ...(earlier.before !== undefined ? { before: earlier.before } : {}),
          ...(change.after !== undefined ? { after: change.after } : {}),
        }
      : { ...change }
    if (
      merged.before !== undefined &&
      merged.after !== undefined &&
      merged.before === merged.after
    ) fields.delete(change.field)
    else fields.set(change.field, merged)
  }
  return { fields: [...fields.values()] }
}

/** Product identity equality for grouping activity without exposing runtime
 * native ids. Session execution identifies the concrete occurrence when set. */
export function artifactOriginsMatch(a: ArtifactOrigin, b: ArtifactOrigin): boolean {
  if (a.kind !== b.kind) return false
  if (a.kind === 'human' && b.kind === 'human') return true
  if (a.kind === 'external' && b.kind === 'external') return a.system === b.system
  if (a.kind === 'unknown' && b.kind === 'unknown') return a.reason === b.reason
  if (a.kind === 'session' && b.kind === 'session') {
    if (a.workspaceId !== b.workspaceId || a.resumeId !== b.resumeId || a.agent !== b.agent) return false
    if (!a.execution || !b.execution) return a.execution === b.execution
    if (a.execution.kind !== b.execution.kind) return false
    return a.execution.kind === 'headless' && b.execution.kind === 'headless'
      ? a.execution.taskId === b.execution.taskId
      : a.execution.kind === 'interactive' && b.execution.kind === 'interactive'
        ? a.execution.sessionRecordId === b.execution.sessionRecordId
        : false
  }
  return false
}

/** Undefined revision in a query means "all revisions of this report path". */
function artifactMatches(record: ArtifactRef, query: ArtifactRef): boolean {
  if (record.kind !== query.kind) return false
  if (record.kind === 'inbox' && query.kind === 'inbox') return record.inboxEntryId === query.inboxEntryId
  if (record.kind === 'issue' && query.kind === 'issue') {
    return record.workspaceId === query.workspaceId && record.issueId === query.issueId
  }
  if (record.kind === 'report' && query.kind === 'report') {
    return record.workspaceId === query.workspaceId && record.path === query.path &&
      (query.revision === undefined || record.revision === query.revision)
  }
  if (record.kind === 'trade-decision' && query.kind === 'trade-decision') {
    return record.accountId === query.accountId && record.decisionId === query.decisionId
  }
  return false
}

/** Convert the already-authoritative request origin into the common envelope. */
export function sessionOriginFromInboxOrigin(
  workspaceId: string,
  origin: InboxOrigin | undefined,
): SessionOrigin | null {
  if (!origin?.resumeId || !origin.agent) return null
  return {
    kind: 'session',
    workspaceId,
    resumeId: origin.resumeId,
    agent: origin.agent,
    ...(origin.kind === 'headless' && origin.runId
      ? { execution: { kind: 'headless' as const, taskId: origin.runId } }
      : origin.kind === 'interactive' && origin.sessionId
        ? { execution: { kind: 'interactive' as const, sessionRecordId: origin.sessionId } }
        : {}),
  }
}
