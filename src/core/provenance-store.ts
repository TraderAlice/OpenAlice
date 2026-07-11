/**
 * Durable Session -> artifact provenance.
 *
 * `resumeId` is the product Session identity. Native runtime session ids never
 * enter this store. Records are immutable attribution occurrences; mutable
 * artifacts accumulate edges instead of overwriting one "author" field.
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

export const provenanceActions = ['created', 'updated', 'commented', 'sent', 'decided'] as const
export type ProvenanceAction = (typeof provenanceActions)[number]

const originSchema = z.union([
  sessionOriginSchema,
  z.object({ kind: z.literal('human') }),
  z.object({ kind: z.literal('external'), system: z.string().min(1) }),
  z.object({ kind: z.literal('unknown'), reason: z.string().min(1) }),
])
export type ArtifactOrigin = z.infer<typeof originSchema>

const recordSchema = z.object({
  id: z.string().min(1),
  artifact: artifactRefSchema,
  action: z.enum(provenanceActions),
  origin: originSchema,
  at: z.number().finite(),
  fingerprint: z.string().min(1).optional(),
})
export type ProvenanceRecord = z.infer<typeof recordSchema>

export interface ProvenanceQuery {
  artifact?: ArtifactRef
  action?: ProvenanceAction
  resumeId?: string
  limit?: number
}

export interface IProvenanceStore {
  append(input: Omit<ProvenanceRecord, 'id'> & { id?: string }): Promise<ProvenanceRecord>
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

  async append(input: Omit<ProvenanceRecord, 'id'> & { id?: string }): Promise<ProvenanceRecord> {
    const candidate = recordSchema.parse({ ...input, id: input.id ?? randomUUID() })
    if (candidate.fingerprint) {
      const existing = this.records.find((record) => record.fingerprint === candidate.fingerprint)
      if (existing) return existing
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
