import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

import { z } from 'zod'

import { dataPath } from './paths.js'

const timestampSchema = z.number().finite().int().nonnegative()
const identitySchema = z.string().min(1).refine((value) => value.trim() === value, {
  message: 'identity must not have leading or trailing whitespace',
})
const decisionNoteSchema = z.string().min(1).max(280).refine((value) => value.trim() === value, {
  message: 'decision note must not have leading or trailing whitespace',
})
const decisionNoteInputSchema = z.string()
  .transform((value) => value.trim())
  .pipe(z.string().min(1).max(280))

export const routineFollowUpRecordSchema = z.object({
  inboxEntryId: identitySchema,
  reportTs: timestampSchema,
  issueWorkspaceId: identitySchema,
  issueId: identitySchema,
  createdAt: timestampSchema,
}).strict()

export type RoutineFollowUpRecord = z.infer<typeof routineFollowUpRecordSchema>
export type RoutineFollowUpInput = Omit<RoutineFollowUpRecord, 'createdAt'>

export const routineDecisionInputSchema = z.discriminatedUnion('outcome', [
  z.object({ outcome: z.literal('maintain-plan') }).strict(),
  z.object({ outcome: z.literal('revise-plan'), note: decisionNoteInputSchema }).strict(),
  z.object({ outcome: z.literal('evidence-unavailable') }).strict(),
])

export type RoutineDecisionInput = z.infer<typeof routineDecisionInputSchema>

const decisionRecordShape = {
  ...routineFollowUpRecordSchema.shape,
  decidedAt: timestampSchema,
}

export const routineDecisionRecordSchema = z.discriminatedUnion('outcome', [
  z.object({
    ...decisionRecordShape,
    outcome: z.literal('maintain-plan'),
  }).strict(),
  z.object({
    ...decisionRecordShape,
    outcome: z.literal('revise-plan'),
    note: decisionNoteSchema,
  }).strict(),
  z.object({
    ...decisionRecordShape,
    outcome: z.literal('evidence-unavailable'),
  }).strict(),
])

export type RoutineDecisionRecord = z.infer<typeof routineDecisionRecordSchema>

const routineFollowUpFileSchema = z.object({
  version: z.literal(2),
  active: z.array(routineFollowUpRecordSchema),
  decisions: z.array(routineDecisionRecordSchema),
}).strict().superRefine((file, ctx) => {
  const activeIds = new Set<string>()
  for (const [index, record] of file.active.entries()) {
    if (activeIds.has(record.inboxEntryId)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['active', index, 'inboxEntryId'],
        message: `duplicate inboxEntryId: ${record.inboxEntryId}`,
      })
    }
    activeIds.add(record.inboxEntryId)
  }
  const decisionIds = new Set<string>()
  for (const [index, decision] of file.decisions.entries()) {
    if (decisionIds.has(decision.inboxEntryId)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['decisions', index, 'inboxEntryId'],
        message: `duplicate decision inboxEntryId: ${decision.inboxEntryId}`,
      })
    }
    if (activeIds.has(decision.inboxEntryId)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['decisions', index, 'inboxEntryId'],
        message: `decision remains active: ${decision.inboxEntryId}`,
      })
    }
    const previous = file.decisions[index - 1]
    if (previous && compareDecisions(previous, decision) > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['decisions', index, 'decidedAt'],
        message: 'decisions must be ordered by decidedAt and inboxEntryId',
      })
    }
    decisionIds.add(decision.inboxEntryId)
  }
})

interface RoutineFollowUpFile {
  version: 2
  active: RoutineFollowUpRecord[]
  decisions: RoutineDecisionRecord[]
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

  constructor(
    readonly inboxEntryId: string,
    readonly reason: 'already-reviewed' | 'already-decided' = 'already-reviewed',
  ) {
    super(reason === 'already-decided'
      ? `Routine follow-up ${inboxEntryId} already has a decision receipt.`
      : `Routine follow-up ${inboxEntryId} was already reviewed.`)
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

export class RoutineFollowUpDecisionConflictError extends Error {
  readonly code = 'routine_follow_up_decision_conflict'

  constructor(readonly inboxEntryId: string) {
    super(`Routine follow-up ${inboxEntryId} already has a different decision receipt.`)
    this.name = 'RoutineFollowUpDecisionConflictError'
  }
}

export class RoutineFollowUpDecisionMissingError extends Error {
  readonly code = 'routine_follow_up_decision_missing'

  constructor(readonly inboxEntryId: string) {
    super(`Routine follow-up ${inboxEntryId} has neither an active carry nor a decision receipt.`)
    this.name = 'RoutineFollowUpDecisionMissingError'
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

export interface RoutineFollowUpDecisionResult {
  decision: RoutineDecisionRecord
  created: boolean
}

export interface RoutineFollowUpDecisionOptions {
  /** Per-entry revision returned by `observe()` before external evidence checks. */
  observedRevision: number
  decidedAt?: number
}

/**
 * Product-owned queue and receipt ledger for scheduled reports the human
 * explicitly carried out of an Office review shift. Decisions record only the
 * human's declared disposition; they never edit or dispatch the referenced Issue.
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
    private decisions: RoutineDecisionRecord[],
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
        return new RoutineFollowUpStore(path, [], [])
      }
      throw error
    }

    const parsed = routineFollowUpFileSchema.parse(JSON.parse(raw))
    return new RoutineFollowUpStore(path, parsed.active, parsed.decisions)
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
    return new RoutineFollowUpStore(path, [], [], loadError)
  }

  get available(): boolean {
    return this.loadError === null
  }

  list(): RoutineFollowUpRecord[] {
    this.assertAvailable()
    return this.active.map((record) => ({ ...record }))
  }

  listDecisions(): RoutineDecisionRecord[] {
    this.assertAvailable()
    return this.decisions.map((record) => ({ ...record }))
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
      if (this.decisions.some((decision) => decision.inboxEntryId === candidate.inboxEntryId)) {
        throw new RoutineFollowUpCreateDisallowedError(candidate.inboxEntryId, 'already-decided')
      }
      if (!allowCreate) {
        throw new RoutineFollowUpCreateDisallowedError(candidate.inboxEntryId)
      }

      const next = [...this.active, candidate]
      await this.write({ version: 2, active: next, decisions: this.decisions })
      this.active = next
      this.bumpRevision(candidate.inboxEntryId)
      return { followUp: { ...candidate }, created: true }
    })
  }

  async decide(
    inboxEntryId: string,
    input: RoutineDecisionInput,
    options: RoutineFollowUpDecisionOptions,
  ): Promise<RoutineFollowUpDecisionResult> {
    this.assertAvailable()
    const exactInboxEntryId = identitySchema.parse(inboxEntryId)
    const exactInput = routineDecisionInputSchema.parse(input)
    const { observedRevision } = options
    if (!Number.isSafeInteger(observedRevision) || observedRevision < 0) {
      throw new TypeError('observedRevision must be a non-negative safe integer')
    }
    const decidedAt = timestampSchema.parse(options.decidedAt ?? Date.now())
    return this.withMutation(async () => {
      const existing = this.decisions.find(
        (decision) => decision.inboxEntryId === exactInboxEntryId,
      )
      if (existing) {
        if (!sameDecision(existing, exactInput)) {
          throw new RoutineFollowUpDecisionConflictError(exactInboxEntryId)
        }
        // A repeated exact decision remains an authoritative newer intent and
        // invalidates any stale carry request still holding an older revision.
        this.bumpRevision(exactInboxEntryId)
        return { decision: { ...existing }, created: false }
      }
      if (this.revision(exactInboxEntryId) !== observedRevision) {
        throw new RoutineFollowUpStaleObservationError(exactInboxEntryId)
      }
      const followUp = this.active.find((record) => record.inboxEntryId === exactInboxEntryId)
      if (!followUp) throw new RoutineFollowUpDecisionMissingError(exactInboxEntryId)

      const decision = routineDecisionRecordSchema.parse({
        ...followUp,
        ...exactInput,
        decidedAt,
      })
      const active = this.active.filter((record) => record.inboxEntryId !== exactInboxEntryId)
      const decisions = orderDecisions([...this.decisions, decision])
      await this.write({ version: 2, active, decisions })
      this.active = active
      this.decisions = decisions
      this.bumpRevision(exactInboxEntryId)
      return { decision: { ...decision }, created: true }
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

function sameDecision(a: RoutineDecisionRecord, b: RoutineDecisionInput): boolean {
  return a.outcome === b.outcome
    && (a.outcome !== 'revise-plan' || (b.outcome === 'revise-plan' && a.note === b.note))
}

function compareDecisions(a: RoutineDecisionRecord, b: RoutineDecisionRecord): number {
  return a.decidedAt - b.decidedAt || a.inboxEntryId.localeCompare(b.inboxEntryId)
}

function orderDecisions(decisions: readonly RoutineDecisionRecord[]): RoutineDecisionRecord[] {
  return [...decisions].sort(compareDecisions)
}
