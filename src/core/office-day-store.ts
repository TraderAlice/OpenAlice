import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

import { z } from 'zod'

import { dataPath } from './paths.js'
import { nextCronFire, resolveScheduleTimezone } from './schedule-expr.js'

const OFFICE_DAY_SHIFT_LIMIT = 4
const OFFICE_DAY_RECEIPT_LIMIT = 256
const OFFICE_DAY_SEEN_DUTY_LIMIT = 1_024
const OFFICE_DAY_EXACT_KEY_LIMIT = 65_536
const timestampSchema = z.number().finite().int().nonnegative().safe()
const revisionSchema = z.number().int().nonnegative().safe()
const shiftIdSchema = z.number().int().positive().safe()
const exactStringSchema = (maxLength: number) => z.string().min(1).max(maxLength).refine(
  (value) => value.trim() === value,
  { message: 'value must not have leading or trailing whitespace' },
)
const dutyIdSchema = exactStringSchema(OFFICE_DAY_EXACT_KEY_LIMIT)
const evidenceIdentitySchema = exactStringSchema(8_192)
const dayKeySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

function uniqueValues(values: readonly string[]): boolean {
  return new Set(values).size === values.length
}

function uniqueDutyListSchema(minLength = 0) {
  return z.array(dutyIdSchema).min(minLength).max(OFFICE_DAY_SHIFT_LIMIT).superRefine((values, ctx) => {
    if (!uniqueValues(values)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'duty ids must be unique' })
    }
  })
}

export const officeDayShiftSchema = z.object({
  id: shiftIdSchema,
  openedAt: timestampSchema,
  slots: uniqueDutyListSchema(),
  order: uniqueDutyListSchema(),
  cleared: z.boolean(),
}).strict().superRefine((shift, ctx) => {
  if (shift.cleared && (shift.slots.length === 0 || shift.order.length > 0)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['cleared'],
      message: 'a cleared shift must have admitted slots and no pending order',
    })
  }
  const slots = new Set(shift.slots)
  shift.order.forEach((dutyId, index) => {
    if (!slots.has(dutyId)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['order', index],
        message: `shift order contains a duty outside slots: ${dutyId}`,
      })
    }
  })
})

export const officeDayEvidenceReceiptSchema = z.object({
  subjectKey: evidenceIdentitySchema,
  fingerprint: evidenceIdentitySchema,
  reviewedAt: timestampSchema,
}).strict()

export const officeDayRecordSchema = z.object({
  dayKey: dayKeySchema,
  timeZone: exactStringSchema(256),
  openedAt: timestampSchema,
  updatedAt: timestampSchema,
  shift: officeDayShiftSchema,
  seenDutyIds: z.array(dutyIdSchema).max(OFFICE_DAY_SEEN_DUTY_LIMIT).superRefine((values, ctx) => {
    if (!uniqueValues(values)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'seen duty ids must be unique' })
    }
  }),
  evidenceReceipts: z.array(officeDayEvidenceReceiptSchema).max(OFFICE_DAY_RECEIPT_LIMIT),
}).strict().superRefine((day, ctx) => {
  if (day.updatedAt < day.openedAt) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['updatedAt'], message: 'updatedAt precedes openedAt' })
  }
  const seen = new Set<string>()
  day.evidenceReceipts.forEach((receipt, index) => {
    const identity = JSON.stringify([receipt.subjectKey, receipt.fingerprint])
    if (seen.has(identity)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['evidenceReceipts', index],
        message: 'duplicate exact evidence receipt',
      })
    }
    seen.add(identity)
  })
  const seenDutyIds = new Set(day.seenDutyIds)
  day.shift.slots.forEach((dutyId, index) => {
    if (!seenDutyIds.has(dutyId)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['shift', 'slots', index],
        message: 'active shift contains a duty absent from the day admission ledger',
      })
    }
  })
})

const officeDayFileSchema = z.object({
  version: z.literal(1),
  revision: revisionSchema,
  day: officeDayRecordSchema,
}).strict().superRefine((file, ctx) => {
  if (file.revision < file.day.shift.id) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['revision'],
      message: 'revision must not precede the active shift id',
    })
  }
})

const openOfficeDayCommandSchema = z.object({
  dayKey: dayKeySchema,
  slots: uniqueDutyListSchema(),
}).strict()

const shiftCommandBase = {
  dayKey: dayKeySchema,
  shiftId: shiftIdSchema,
}

export const officeDayCommandSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('reconcile-shift'),
    ...shiftCommandBase,
    presentSlotIds: uniqueDutyListSchema(),
    proposedSlots: uniqueDutyListSchema(),
    unresolvedCount: revisionSchema,
  }).strict(),
  z.object({
    type: z.literal('defer-duty'),
    ...shiftCommandBase,
    dutyId: dutyIdSchema,
  }).strict(),
  z.object({
    type: z.literal('start-next-shift'),
    ...shiftCommandBase,
    slots: uniqueDutyListSchema(1),
  }).strict(),
  z.object({
    type: z.literal('review-evidence'),
    ...shiftCommandBase,
    dutyId: dutyIdSchema,
    subjectKey: evidenceIdentitySchema,
    fingerprint: evidenceIdentitySchema,
  }).strict(),
  z.object({
    type: z.literal('forget-evidence'),
    dayKey: dayKeySchema,
    subjectKey: evidenceIdentitySchema,
  }).strict(),
]).superRefine((command, ctx) => {
  if (command.type === 'review-evidence'
    && !matchesCanonicalCadenceDuty(command.dutyId, command.subjectKey, command.fingerprint)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['dutyId'],
      message: 'review evidence identity does not match its exact cadence duty key',
    })
  }
})

interface OfficeDayFile {
  version: 1
  revision: number
  day: OfficeDayRecord
}

export type OfficeDayShift = z.infer<typeof officeDayShiftSchema>
export type OfficeDayEvidenceReceipt = z.infer<typeof officeDayEvidenceReceiptSchema>
export type OfficeDayRecord = z.infer<typeof officeDayRecordSchema>
export type OpenOfficeDayCommand = z.infer<typeof openOfficeDayCommandSchema>
export type OfficeDayCommand = z.infer<typeof officeDayCommandSchema>

export interface OfficeDayObservation {
  readonly serverNow: number
  readonly dayKey: string
  readonly timeZone: string
  readonly nextRolloverAt: number
  readonly revision: number
  readonly day: OfficeDayRecord | null
}

export type OfficeDayMutationReason =
  | 'stale-day'
  | 'stale-shift'
  | 'no-change'
  | 'duty-not-pending'
  | 'shift-not-complete'

export type OfficeDayMutationResult = OfficeDayObservation & {
  readonly applied: boolean
  readonly reason?: OfficeDayMutationReason
}

export interface OfficeDayStoreOptions {
  readonly path?: string
  readonly now?: () => number
  readonly timeZone?: string
}

export class OfficeDayUnavailableError extends Error {
  readonly code = 'office_day_unavailable'

  constructor(readonly loadError: Error) {
    super('Office Day storage is unavailable because its durable state could not be loaded.')
    this.name = 'OfficeDayUnavailableError'
  }
}

/**
 * AliceProject-owned daily diligence state. Domain completion remains in the
 * Inbox, Issue, and Decision Desk stores; this sidecar owns only the finite
 * patrol order and exact evidence receipts for one server-local calendar day.
 */
export class OfficeDayStore {
  private mutationQueue: Promise<void> = Promise.resolve()

  private constructor(
    private readonly path: string,
    private readonly now: () => number,
    private readonly timeZone: string,
    private file: OfficeDayFile | null,
    readonly loadError: Error | null = null,
  ) {}

  static async load(options: OfficeDayStoreOptions = {}): Promise<OfficeDayStore> {
    const path = options.path ?? dataPath('office', 'day.json')
    const now = options.now ?? Date.now
    const timeZone = concreteTimeZone(options.timeZone ?? resolveScheduleTimezone())
    let raw: string
    try {
      raw = await readFile(path, 'utf8')
    } catch (error: unknown) {
      if (error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
        return new OfficeDayStore(path, now, timeZone, null)
      }
      throw error
    }
    const file = officeDayFileSchema.parse(JSON.parse(raw))
    concreteTimeZone(file.day.timeZone)
    return new OfficeDayStore(path, now, timeZone, file)
  }

  static async loadOrUnavailable(options: OfficeDayStoreOptions = {}): Promise<OfficeDayStore> {
    try {
      return await OfficeDayStore.load(options)
    } catch (error) {
      return OfficeDayStore.unavailable(error, options)
    }
  }

  static unavailable(error: unknown, options: OfficeDayStoreOptions = {}): OfficeDayStore {
    const loadError = error instanceof Error ? error : new Error(String(error))
    return new OfficeDayStore(
      options.path ?? dataPath('office', 'day.json'),
      options.now ?? Date.now,
      concreteTimeZone(options.timeZone ?? resolveScheduleTimezone()),
      null,
      loadError,
    )
  }

  get available(): boolean {
    return this.loadError === null
  }

  observe(): OfficeDayObservation {
    this.assertAvailable()
    return this.observation(this.calendar())
  }

  async open(input: unknown): Promise<OfficeDayMutationResult> {
    this.assertAvailable()
    const command = openOfficeDayCommandSchema.parse(input)
    return this.withMutation(async () => {
      const calendar = this.calendar()
      if (command.dayKey !== calendar.dayKey) return this.result(false, 'stale-day', calendar)
      if (this.currentDay(calendar)) return this.result(false, 'no-change', calendar)

      const nextRevision = this.nextRevision()
      const day: OfficeDayRecord = {
        dayKey: calendar.dayKey,
        timeZone: calendar.timeZone,
        openedAt: calendar.serverNow,
        updatedAt: calendar.serverNow,
        shift: {
          id: nextRevision,
          openedAt: calendar.serverNow,
          slots: [...command.slots],
          order: [...command.slots],
          cleared: false,
        },
        seenDutyIds: [...command.slots],
        evidenceReceipts: [],
      }
      await this.commit(nextRevision, day)
      return this.result(true, undefined, calendar)
    })
  }

  async execute(input: unknown): Promise<OfficeDayMutationResult> {
    this.assertAvailable()
    const command = officeDayCommandSchema.parse(input)
    return this.withMutation(async () => {
      const calendar = this.calendar()
      if (command.dayKey !== calendar.dayKey) return this.result(false, 'stale-day', calendar)
      const day = this.currentDay(calendar)
      if (!day) return this.result(false, 'stale-day', calendar)

      if (command.type === 'forget-evidence') {
        const evidenceReceipts = day.evidenceReceipts.filter(
          (receipt) => receipt.subjectKey !== command.subjectKey,
        )
        if (evidenceReceipts.length === day.evidenceReceipts.length) {
          return this.result(false, 'no-change', calendar)
        }
        await this.commitUpdatedDay(day, { evidenceReceipts }, calendar.serverNow)
        return this.result(true, undefined, calendar)
      }

      if (day.shift.id !== command.shiftId) return this.result(false, 'stale-shift', calendar)

      switch (command.type) {
        case 'reconcile-shift': {
          if (day.shift.cleared || day.shift.slots.length === 0) {
            const unseenSlots = unseenDutyIds(day, command.proposedSlots)
            if (unseenSlots.length > 0) {
              await this.commitNewShift(day, unseenSlots, calendar.serverNow)
              return this.result(true, undefined, calendar)
            }
            if (day.shift.cleared) return this.result(false, 'no-change', calendar)
          }
          const present = new Set(command.presentSlotIds)
          const order = day.shift.order.filter((dutyId) => present.has(dutyId))
          const cleared = day.shift.slots.length > 0
            && order.length === 0
            && command.unresolvedCount === 0
          if (sameStrings(order, day.shift.order) && cleared === day.shift.cleared) {
            return this.result(false, 'no-change', calendar)
          }
          await this.commitUpdatedDay(day, {
            shift: { ...day.shift, order, cleared },
          }, calendar.serverNow)
          return this.result(true, undefined, calendar)
        }
        case 'defer-duty': {
          const index = day.shift.order.indexOf(command.dutyId)
          if (index < 0) return this.result(false, 'duty-not-pending', calendar)
          if (day.shift.order.length < 2 || index === day.shift.order.length - 1) {
            return this.result(false, 'no-change', calendar)
          }
          const order = [...day.shift.order]
          order.splice(index, 1)
          order.push(command.dutyId)
          await this.commitUpdatedDay(day, { shift: { ...day.shift, order } }, calendar.serverNow)
          return this.result(true, undefined, calendar)
        }
        case 'start-next-shift': {
          if (day.shift.order.length > 0) return this.result(false, 'shift-not-complete', calendar)
          const unseenSlots = unseenDutyIds(day, command.slots)
          if (unseenSlots.length === 0) return this.result(false, 'no-change', calendar)
          await this.commitNewShift(day, unseenSlots, calendar.serverNow)
          return this.result(true, undefined, calendar)
        }
        case 'review-evidence': {
          const receiptExists = day.evidenceReceipts.some((receipt) => (
            receipt.subjectKey === command.subjectKey && receipt.fingerprint === command.fingerprint
          ))
          const dutyPending = day.shift.order.includes(command.dutyId)
          if (!dutyPending) {
            return this.result(false, receiptExists ? 'no-change' : 'duty-not-pending', calendar)
          }
          const evidenceReceipts = receiptExists
            ? day.evidenceReceipts
            : [...day.evidenceReceipts, {
                subjectKey: command.subjectKey,
                fingerprint: command.fingerprint,
                reviewedAt: calendar.serverNow,
              }]
          const order = day.shift.order.filter((dutyId) => dutyId !== command.dutyId)
          await this.commitUpdatedDay(day, {
            shift: { ...day.shift, order, cleared: false },
            evidenceReceipts,
          }, calendar.serverNow)
          return this.result(true, undefined, calendar)
        }
      }
    })
  }

  private async withMutation<T>(mutation: () => Promise<T>): Promise<T> {
    const run = this.mutationQueue.then(mutation, mutation)
    this.mutationQueue = run.then(() => undefined, () => undefined)
    return run
  }

  private calendar(): OfficeDayCalendar {
    const serverNow = this.now()
    if (!Number.isSafeInteger(serverNow) || serverNow < 0) {
      throw new Error('Office Day clock returned an invalid timestamp.')
    }
    const dayKey = officeDayKey(serverNow, this.timeZone)
    const nextRolloverAt = nextCronFire('0 0 * * *', serverNow, this.timeZone)
    if (nextRolloverAt === null) throw new Error('Office Day could not resolve its next local midnight.')
    return { serverNow, dayKey, timeZone: this.timeZone, nextRolloverAt }
  }

  private currentDay(calendar: OfficeDayCalendar): OfficeDayRecord | null {
    const day = this.file?.day
    return day && day.dayKey === calendar.dayKey && day.timeZone === calendar.timeZone ? day : null
  }

  private observation(calendar: OfficeDayCalendar): OfficeDayObservation {
    const day = this.currentDay(calendar)
    return {
      ...calendar,
      revision: this.file?.revision ?? 0,
      day: day ? cloneDay(day) : null,
    }
  }

  private result(
    applied: boolean,
    reason: OfficeDayMutationReason | undefined,
    calendar: OfficeDayCalendar,
  ): OfficeDayMutationResult {
    return {
      ...this.observation(calendar),
      applied,
      ...(reason ? { reason } : {}),
    }
  }

  private nextRevision(): number {
    const current = this.file?.revision ?? 0
    if (current >= Number.MAX_SAFE_INTEGER) throw new Error('Office Day revision space is exhausted.')
    return current + 1
  }

  private async commitNewShift(
    day: OfficeDayRecord,
    slots: readonly string[],
    updatedAt: number,
  ): Promise<void> {
    const nextRevision = this.nextRevision()
    await this.commit(nextRevision, {
      ...day,
      updatedAt,
      shift: {
        id: nextRevision,
        openedAt: updatedAt,
        slots: [...slots],
        order: [...slots],
        cleared: false,
      },
      seenDutyIds: [...day.seenDutyIds, ...slots],
    })
  }

  private async commitUpdatedDay(
    day: OfficeDayRecord,
    patch: Partial<Pick<OfficeDayRecord, 'shift' | 'evidenceReceipts'>>,
    updatedAt: number,
  ): Promise<void> {
    await this.commit(this.nextRevision(), { ...day, ...patch, updatedAt })
  }

  private async commit(revision: number, day: OfficeDayRecord): Promise<void> {
    const file = officeDayFileSchema.parse({ version: 1, revision, day })
    await this.write(file)
    this.file = file
  }

  private async write(file: OfficeDayFile): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true })
    const temp = `${this.path}.${process.pid}.${randomUUID()}.tmp`
    try {
      await writeFile(temp, `${JSON.stringify(file, null, 2)}\n`, { mode: 0o600 })
      await rename(temp, this.path)
    } finally {
      await unlink(temp).catch(() => undefined)
    }
  }

  private assertAvailable(): void {
    if (this.loadError) throw new OfficeDayUnavailableError(this.loadError)
  }
}

interface OfficeDayCalendar {
  readonly serverNow: number
  readonly dayKey: string
  readonly timeZone: string
  readonly nextRolloverAt: number
}

function concreteTimeZone(timeZone: string): string {
  new Intl.DateTimeFormat('en-US', { timeZone }).format()
  return timeZone
}

export function officeDayKey(timestamp: number, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(timestamp))
  const value = (kind: 'year' | 'month' | 'day') => parts.find((part) => part.type === kind)?.value
  const year = value('year')
  const month = value('month')
  const day = value('day')
  if (!year || !month || !day) throw new Error('Office Day could not resolve its local calendar date.')
  return `${year}-${month}-${day}`
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function cloneDay(day: OfficeDayRecord): OfficeDayRecord {
  return {
    ...day,
    shift: { ...day.shift, slots: [...day.shift.slots], order: [...day.shift.order] },
    seenDutyIds: [...day.seenDutyIds],
    evidenceReceipts: day.evidenceReceipts.map((receipt) => ({ ...receipt })),
  }
}

function unseenDutyIds(day: OfficeDayRecord, proposedSlots: readonly string[]): string[] {
  const seen = new Set(day.seenDutyIds)
  return proposedSlots.filter((dutyId) => !seen.has(dutyId))
}

function matchesCanonicalCadenceDuty(
  dutyId: string,
  subjectKey: string,
  fingerprint: string,
): boolean {
  try {
    const value: unknown = JSON.parse(dutyId)
    if (!Array.isArray(value)
      || value.length !== 5
      || value[0] !== 'office-duty-v1'
      || value[1] !== 'cadence'
      || typeof value[2] !== 'string'
      || value[2].length === 0
      || value[2].trim() !== value[2]
      || value[3] !== subjectKey
      || value[4] !== fingerprint) return false
    return JSON.stringify(value) === dutyId
  } catch {
    return false
  }
}
