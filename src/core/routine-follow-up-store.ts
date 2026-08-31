import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

import { z } from 'zod'

import { dataPath } from './paths.js'

const timestampSchema = z.number().finite().int().nonnegative()
const identitySchema = z.string().min(1).refine((value) => value.trim() === value, {
  message: 'identity must not have leading or trailing whitespace',
})

export const routineFollowUpRecordSchema = z.object({
  inboxEntryId: identitySchema,
  reportTs: timestampSchema,
  issueWorkspaceId: identitySchema,
  issueId: identitySchema,
  createdAt: timestampSchema,
}).strict()

export type RoutineFollowUpRecord = z.infer<typeof routineFollowUpRecordSchema>
export type RoutineFollowUpInput = Omit<RoutineFollowUpRecord, 'createdAt'>

const routineFollowUpFileSchema = z.object({
  version: z.literal(1),
  active: z.array(routineFollowUpRecordSchema),
}).strict().superRefine((file, ctx) => {
  const seen = new Set<string>()
  for (const [index, record] of file.active.entries()) {
    if (seen.has(record.inboxEntryId)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['active', index, 'inboxEntryId'],
        message: `duplicate inboxEntryId: ${record.inboxEntryId}`,
      })
    }
    seen.add(record.inboxEntryId)
  }
})

interface RoutineFollowUpFile {
  version: 1
  active: RoutineFollowUpRecord[]
}

export class RoutineFollowUpConflictError extends Error {
  readonly code = 'routine_follow_up_conflict'

  constructor(readonly inboxEntryId: string) {
    super(`Routine follow-up already exists with different authority for Inbox entry ${inboxEntryId}`)
    this.name = 'RoutineFollowUpConflictError'
  }
}

export class RoutineFollowUpCreateDisallowedError extends Error {
  readonly code = 'routine_follow_up_create_disallowed'

  constructor(readonly inboxEntryId: string) {
    super(`Routine follow-up ${inboxEntryId} no longer permits a new durable record.`)
    this.name = 'RoutineFollowUpCreateDisallowedError'
  }
}

export class RoutineFollowUpStaleObservationError extends Error {
  readonly code = 'routine_follow_up_stale_observation'

  constructor(readonly inboxEntryId: string) {
    super(`Routine follow-up ${inboxEntryId} changed while the request was in flight.`)
    this.name = 'RoutineFollowUpStaleObservationError'
  }
}

export class RoutineFollowUpUnavailableError extends Error {
  readonly code = 'routine_follow_up_unavailable'

  constructor(readonly loadError: Error) {
    super('Routine follow-up storage is unavailable because its durable state could not be loaded.')
    this.name = 'RoutineFollowUpUnavailableError'
  }
}

export interface RoutineFollowUpPutResult {
  followUp: RoutineFollowUpRecord
  created: boolean
}

export interface RoutineFollowUpPutOptions {
  /** False for recovery-only requests or when authoritative state forbids a new carry. */
  allowCreate: boolean
  /** Per-entry revision returned by `observe()` before external authority checks. */
  observedRevision: number
  createdAt?: number
}

export interface RoutineFollowUpObservation {
  followUp: RoutineFollowUpRecord | null
  revision: number
}

/**
 * Product-owned queue of scheduled reports the human explicitly carried out
 * of an Office review shift. It records intent only: it never edits or
 * dispatches the referenced Issue.
 */
export class RoutineFollowUpStore {
  private mutationQueue: Promise<void> = Promise.resolve()
  /**
   * Process-local CAS tokens are sufficient: a process restart also destroys
   * every request that could hold an older observation.
   */
  private readonly revisions = new Map<string, number>()

  private constructor(
    private readonly path: string,
    private active: RoutineFollowUpRecord[],
    readonly loadError: Error | null = null,
  ) {}

  static async load(
    path = dataPath('inbox', 'routine-follow-ups.json'),
  ): Promise<RoutineFollowUpStore> {
    let raw: string
    try {
      raw = await readFile(path, 'utf8')
    } catch (error: unknown) {
      if (error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
        return new RoutineFollowUpStore(path, [])
      }
      throw error
    }

    const parsed = routineFollowUpFileSchema.parse(JSON.parse(raw))
    return new RoutineFollowUpStore(path, parsed.active)
  }

  /**
   * Composition-root loader. A corrupt sidecar disables only the Office
   * decision queue; the strict `load()` contract above remains available to
   * diagnostics and tests that must observe the malformed state directly.
   */
  static async loadOrUnavailable(
    path = dataPath('inbox', 'routine-follow-ups.json'),
  ): Promise<RoutineFollowUpStore> {
    try {
      return await RoutineFollowUpStore.load(path)
    } catch (error) {
      return RoutineFollowUpStore.unavailable(error, path)
    }
  }

  static unavailable(
    error: unknown,
    path = dataPath('inbox', 'routine-follow-ups.json'),
  ): RoutineFollowUpStore {
    const loadError = error instanceof Error ? error : new Error(String(error))
    return new RoutineFollowUpStore(path, [], loadError)
  }

  get available(): boolean {
    return this.loadError === null
  }

  list(): RoutineFollowUpRecord[] {
    this.assertAvailable()
    return this.active.map((record) => ({ ...record }))
  }

  get(inboxEntryId: string): RoutineFollowUpRecord | null {
    return this.observe(inboxEntryId).followUp
  }

  observe(inboxEntryId: string): RoutineFollowUpObservation {
    this.assertAvailable()
    const record = this.active.find((candidate) => candidate.inboxEntryId === inboxEntryId)
    return {
      followUp: record ? { ...record } : null,
      revision: this.revision(inboxEntryId),
    }
  }

  async put(
    input: RoutineFollowUpInput,
    options: RoutineFollowUpPutOptions,
  ): Promise<RoutineFollowUpPutResult> {
    this.assertAvailable()
    const { allowCreate, observedRevision } = options
    if (!Number.isSafeInteger(observedRevision) || observedRevision < 0) {
      throw new TypeError('observedRevision must be a non-negative safe integer')
    }
    const createdAt = options.createdAt ?? Date.now()
    const candidate = routineFollowUpRecordSchema.parse({ ...input, createdAt })
    return this.withMutation(async () => {
      const existing = this.active.find((record) => record.inboxEntryId === candidate.inboxEntryId)
      if (existing) {
        if (!sameAuthority(existing, candidate)) {
          throw new RoutineFollowUpConflictError(candidate.inboxEntryId)
        }
        return { followUp: { ...existing }, created: false }
      }
      if (this.revision(candidate.inboxEntryId) !== observedRevision) {
        throw new RoutineFollowUpStaleObservationError(candidate.inboxEntryId)
      }
      if (!allowCreate) {
        throw new RoutineFollowUpCreateDisallowedError(candidate.inboxEntryId)
      }

      const next = [...this.active, candidate]
      await this.write({ version: 1, active: next })
      this.active = next
      this.bumpRevision(candidate.inboxEntryId)
      return { followUp: { ...candidate }, created: true }
    })
  }

  async remove(inboxEntryId: string): Promise<boolean> {
    this.assertAvailable()
    return this.withMutation(async () => {
      // inboxEntryId is the active-only identity: after Carry marks the report
      // read, resolve has no valid later incarnation to distinguish or preserve.
      const next = this.active.filter((record) => record.inboxEntryId !== inboxEntryId)
      const removed = next.length !== this.active.length
      if (removed) {
        await this.write({ version: 1, active: next })
        this.active = next
      }
      // Even an idempotent resolve is an authoritative newer intent for this
      // key and must invalidate a fresh carry that observed the earlier state.
      this.bumpRevision(inboxEntryId)
      return removed
    })
  }

  private async withMutation<T>(mutation: () => Promise<T>): Promise<T> {
    const run = this.mutationQueue.then(mutation, mutation)
    this.mutationQueue = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }

  private assertAvailable(): void {
    if (this.loadError) throw new RoutineFollowUpUnavailableError(this.loadError)
  }

  private revision(inboxEntryId: string): number {
    return this.revisions.get(inboxEntryId) ?? 0
  }

  private bumpRevision(inboxEntryId: string): void {
    this.revisions.set(inboxEntryId, this.revision(inboxEntryId) + 1)
  }

  private async write(file: RoutineFollowUpFile): Promise<void> {
    const validated = routineFollowUpFileSchema.parse(file)
    await mkdir(dirname(this.path), { recursive: true })
    const tmp = `${this.path}.tmp`
    await writeFile(tmp, `${JSON.stringify(validated, null, 2)}\n`, { mode: 0o600 })
    await rename(tmp, this.path)
  }
}

function sameAuthority(a: RoutineFollowUpRecord, b: RoutineFollowUpRecord): boolean {
  return a.inboxEntryId === b.inboxEntryId
    && a.reportTs === b.reportTs
    && a.issueWorkspaceId === b.issueWorkspaceId
    && a.issueId === b.issueId
}
