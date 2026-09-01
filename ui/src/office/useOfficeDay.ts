import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { api } from '../api'
import type {
  OfficeDayCommand,
  OfficeDayEnvelope,
  OfficeDayEvidenceReceipt,
  OfficeDayMutationReason,
  OfficeDayMutationResponse,
  OfficeDayRecord,
} from '../api/office'
import {
  officeDutyKey,
  type OfficeCadenceDutyCandidate,
  type OfficeDutyAcknowledgementResult,
} from './duty-registry'

const OFFICE_DAY_POLL_MS = 15_000
const OFFICE_DAY_CHANNEL = 'openalice:office-day'
const OFFICE_DAY_SEEN_DUTY_LIMIT = 1_024
const DAY_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const EMPTY_EVIDENCE_RECEIPTS: readonly OfficeDayEvidenceReceipt[] = []
const MUTATION_REASONS = new Set<OfficeDayMutationReason>([
  'stale-day',
  'stale-shift',
  'no-change',
  'duty-not-pending',
  'shift-not-complete',
])

function isIdentity(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.trim() === value
}

function isTimestamp(value: unknown): value is number {
  return typeof value === 'number'
    && Number.isFinite(value)
    && Number.isSafeInteger(value)
    && value >= 0
}

function isStringArray(value: unknown, max = Number.POSITIVE_INFINITY): value is string[] {
  return Array.isArray(value)
    && value.length <= max
    && value.every(isIdentity)
    && new Set(value).size === value.length
}

function isOfficeDayRecord(value: unknown, dayKey: string, timeZone: string): value is OfficeDayRecord {
  if (!value || typeof value !== 'object') return false
  const day = value as Record<string, unknown>
  if (day.dayKey !== dayKey
    || day.timeZone !== timeZone
    || !isTimestamp(day.openedAt)
    || !isTimestamp(day.updatedAt)
    || !day.shift
    || typeof day.shift !== 'object'
    || !isStringArray(day.seenDutyIds, OFFICE_DAY_SEEN_DUTY_LIMIT)
    || !Array.isArray(day.evidenceReceipts)) return false

  const shift = day.shift as Record<string, unknown>
  if (!isTimestamp(shift.id)
    || !isTimestamp(shift.openedAt)
    || !isStringArray(shift.slots, 4)
    || !isStringArray(shift.order, 4)
    || typeof shift.cleared !== 'boolean') return false
  if (shift.cleared && (shift.slots.length === 0 || shift.order.length > 0)) return false
  const slotIds = new Set(shift.slots)
  if (!shift.order.every((id) => slotIds.has(id))) return false
  const seenDutyIds = new Set(day.seenDutyIds)
  if (!shift.slots.every((id) => seenDutyIds.has(id))) return false

  const seenReceipts = new Set<string>()
  return day.evidenceReceipts.every((value) => {
    if (!value || typeof value !== 'object') return false
    const receipt = value as Record<string, unknown>
    if (!isIdentity(receipt.subjectKey)
      || !isIdentity(receipt.fingerprint)
      || !isTimestamp(receipt.reviewedAt)) return false
    const exactReceipt = JSON.stringify([receipt.subjectKey, receipt.fingerprint])
    if (seenReceipts.has(exactReceipt)) return false
    seenReceipts.add(exactReceipt)
    return true
  })
}

function validatedEnvelope(value: unknown): OfficeDayEnvelope {
  if (!value || typeof value !== 'object') {
    throw new Error('Invalid Office Day response')
  }
  const envelope = value as Record<string, unknown>
  if (!isTimestamp(envelope.serverNow)
    || typeof envelope.dayKey !== 'string'
    || !DAY_KEY_PATTERN.test(envelope.dayKey)
    || !isIdentity(envelope.timeZone)
    || !isTimestamp(envelope.nextRolloverAt)
    || !isTimestamp(envelope.revision)
    || (envelope.day !== null
      && !isOfficeDayRecord(envelope.day, envelope.dayKey, envelope.timeZone))) {
    throw new Error('Invalid Office Day response')
  }
  return envelope as unknown as OfficeDayEnvelope
}

function validatedMutation(value: unknown): OfficeDayMutationResponse {
  const envelope = validatedEnvelope(value)
  const mutation = value as Record<string, unknown>
  if (typeof mutation.applied !== 'boolean'
    || (mutation.reason !== undefined
      && (typeof mutation.reason !== 'string'
        || !MUTATION_REASONS.has(mutation.reason as OfficeDayMutationReason)))) {
    throw new Error('Invalid Office Day mutation response')
  }
  return { ...envelope, applied: mutation.applied, ...(mutation.reason
    ? { reason: mutation.reason as OfficeDayMutationReason }
    : {}) }
}

function envelopeChanged(current: OfficeDayEnvelope | null, next: OfficeDayEnvelope): boolean {
  if (!current) return true
  if (next.revision !== current.revision) return next.revision > current.revision
  if (next.serverNow !== current.serverNow) return next.serverNow > current.serverNow
  return next.dayKey !== current.dayKey
    || next.timeZone !== current.timeZone
    || next.nextRolloverAt !== current.nextRolloverAt
    || Boolean(next.day) !== Boolean(current.day)
}

export type OfficeDayStatus = 'loading' | 'ready' | 'error'

export interface OfficeDayController {
  readonly status: OfficeDayStatus
  readonly dayKey: string | null
  readonly timeZone: string | null
  readonly nextRolloverAt: number | null
  readonly revision: number
  readonly day: OfficeDayRecord | null
  /** Every exact receipt retained for this Project-local day. */
  readonly evidenceReceipts: readonly OfficeDayEvidenceReceipt[]
  hasEvidenceReceipt(subjectKey: string, fingerprint: string): boolean
  refresh(): Promise<void>
  open(slots: readonly string[]): Promise<OfficeDayMutationResponse>
  reconcileShift(input: {
    dayKey: string
    shiftId: number
    presentSlotIds: readonly string[]
    proposedSlots: readonly string[]
    unresolvedCount: number
  }): Promise<OfficeDayMutationResponse>
  deferDuty(input: {
    dayKey: string
    shiftId: number
    dutyId: string
  }): Promise<OfficeDayMutationResponse>
  startNextShift(input: {
    dayKey: string
    shiftId: number
    slots: readonly string[]
  }): Promise<OfficeDayMutationResponse>
  reviewEvidence(duty: OfficeCadenceDutyCandidate): Promise<OfficeDutyAcknowledgementResult>
  forgetEvidence(subjectKey: string): Promise<void>
}

/**
 * Project-authoritative Office Day transport. Commands serialize in one tab;
 * the server serializes every renderer and returns its full current snapshot.
 */
export function useOfficeDay(): OfficeDayController {
  const [status, setStatus] = useState<OfficeDayStatus>('loading')
  const [envelope, setEnvelope] = useState<OfficeDayEnvelope | null>(null)
  const envelopeRef = useRef<OfficeDayEnvelope | null>(null)
  const mountedRef = useRef(false)
  const requestTokenRef = useRef(0)
  const latestSettledTokenRef = useRef(0)
  const mutationTailRef = useRef<Promise<void>>(Promise.resolve())
  const channelRef = useRef<BroadcastChannel | null>(null)

  const acceptEnvelope = useCallback((next: OfficeDayEnvelope) => {
    const current = envelopeRef.current
    if (!envelopeChanged(current, next)) return
    envelopeRef.current = next
    if (mountedRef.current) setEnvelope(next)
  }, [])

  const runRequest = useCallback(async <T extends OfficeDayEnvelope>(
    request: () => Promise<T>,
    validate: (value: unknown) => T,
  ): Promise<T> => {
    const token = requestTokenRef.current + 1
    requestTokenRef.current = token
    if (!envelopeRef.current && mountedRef.current) setStatus('loading')
    try {
      const response = validate(await request())
      acceptEnvelope(response)
      if (mountedRef.current && token >= latestSettledTokenRef.current) {
        latestSettledTokenRef.current = token
        setStatus('ready')
      }
      return response
    } catch (error) {
      if (mountedRef.current && token >= latestSettledTokenRef.current) {
        latestSettledTokenRef.current = token
        setStatus('error')
      }
      throw error
    }
  }, [acceptEnvelope])

  const refresh = useCallback(async (): Promise<void> => {
    await runRequest(() => api.office.day(), validatedEnvelope)
  }, [runRequest])

  const enqueueMutation = useCallback(<T extends OfficeDayMutationResponse>(
    mutation: () => Promise<T>,
  ): Promise<T> => {
    let resolveResult!: (value: T) => void
    let rejectResult!: (error: unknown) => void
    const result = new Promise<T>((resolve, reject) => {
      resolveResult = resolve
      rejectResult = reject
    })
    const run = mutationTailRef.current.then(async () => {
      try {
        const response = await runRequest(mutation, validatedMutation as (value: unknown) => T)
        if (response.applied) channelRef.current?.postMessage({
          dayKey: response.dayKey,
          revision: response.revision,
        })
        resolveResult(response)
      } catch (error) {
        rejectResult(error)
      }
    })
    mutationTailRef.current = run.then(() => undefined, () => undefined)
    return result
  }, [runRequest])

  const open = useCallback((slots: readonly string[]) => {
    const current = envelopeRef.current
    if (!current) return Promise.reject(new Error('Office Day is not ready.'))
    return enqueueMutation(() => api.office.openDay({
      dayKey: current.dayKey,
      slots: [...slots],
    }))
  }, [enqueueMutation])

  const command = useCallback((value: OfficeDayCommand) => (
    enqueueMutation(() => api.office.commandDay(value))
  ), [enqueueMutation])

  const reconcileShift = useCallback((input: {
    dayKey: string
    shiftId: number
    presentSlotIds: readonly string[]
    proposedSlots: readonly string[]
    unresolvedCount: number
  }) => command({
    type: 'reconcile-shift',
    dayKey: input.dayKey,
    shiftId: input.shiftId,
    presentSlotIds: [...input.presentSlotIds],
    proposedSlots: [...input.proposedSlots],
    unresolvedCount: input.unresolvedCount,
  }), [command])

  const deferDuty = useCallback((input: {
    dayKey: string
    shiftId: number
    dutyId: string
  }) => command({ type: 'defer-duty', ...input }), [command])

  const startNextShift = useCallback((input: {
    dayKey: string
    shiftId: number
    slots: readonly string[]
  }) => command({
    type: 'start-next-shift',
    dayKey: input.dayKey,
    shiftId: input.shiftId,
    slots: [...input.slots],
  }), [command])

  const reviewEvidence = useCallback(async (
    duty: OfficeCadenceDutyCandidate,
  ): Promise<OfficeDutyAcknowledgementResult> => {
    const current = envelopeRef.current
    const day = current?.day
    if (!current || !day) throw new Error('Office Day is not ready.')
    const response = await command({
      type: 'review-evidence',
      dayKey: current.dayKey,
      shiftId: day.shift.id,
      dutyId: officeDutyKey(duty),
      subjectKey: duty.receipt.subjectKey,
      fingerprint: duty.receipt.fingerprint,
    })
    const exactReceipt = response.day?.evidenceReceipts.some((receipt) => (
      receipt.subjectKey === duty.receipt.subjectKey
      && receipt.fingerprint === duty.receipt.fingerprint
    )) ?? false
    if (!exactReceipt) throw new Error('Office Day changed before this evidence was reviewed.')
    return response.applied ? 'acknowledged' : 'already-resolved'
  }, [command])

  const forgetEvidence = useCallback(async (subjectKey: string): Promise<void> => {
    const current = envelopeRef.current
    if (!current?.day) return
    await command({ type: 'forget-evidence', dayKey: current.dayKey, subjectKey })
  }, [command])

  useEffect(() => {
    mountedRef.current = true
    void refresh().catch(() => undefined)
    const intervalId = window.setInterval(() => void refresh().catch(() => undefined), OFFICE_DAY_POLL_MS)
    const refreshVisible = () => {
      if (document.visibilityState === 'visible') void refresh().catch(() => undefined)
    }
    const refreshFocused = () => void refresh().catch(() => undefined)
    document.addEventListener('visibilitychange', refreshVisible)
    window.addEventListener('focus', refreshFocused)
    if (typeof BroadcastChannel !== 'undefined') {
      const channel = new BroadcastChannel(OFFICE_DAY_CHANNEL)
      channel.onmessage = () => void refresh().catch(() => undefined)
      channelRef.current = channel
    }
    return () => {
      mountedRef.current = false
      window.clearInterval(intervalId)
      document.removeEventListener('visibilitychange', refreshVisible)
      window.removeEventListener('focus', refreshFocused)
      channelRef.current?.close()
      channelRef.current = null
    }
  }, [refresh])

  useEffect(() => {
    const nextRolloverAt = envelope?.nextRolloverAt
    if (nextRolloverAt == null) return
    const delay = Math.max(250, nextRolloverAt - (envelope?.serverNow ?? nextRolloverAt) + 25)
    const timeoutId = window.setTimeout(() => void refresh().catch(() => undefined), delay)
    return () => window.clearTimeout(timeoutId)
  }, [envelope?.nextRolloverAt, envelope?.serverNow, refresh])

  const dayKey = envelope?.dayKey ?? null
  const timeZone = envelope?.timeZone ?? null
  const nextRolloverAt = envelope?.nextRolloverAt ?? null
  const revision = envelope?.revision ?? 0
  const day = envelope && envelope.day?.dayKey === envelope.dayKey ? envelope.day : null
  const evidenceReceipts = day?.evidenceReceipts ?? EMPTY_EVIDENCE_RECEIPTS
  const exactEvidenceReceipts = useMemo(() => new Set(
    evidenceReceipts.map((receipt) => JSON.stringify([receipt.subjectKey, receipt.fingerprint])),
  ), [evidenceReceipts])
  const hasEvidenceReceipt = useCallback((subjectKey: string, fingerprint: string) => (
    exactEvidenceReceipts.has(JSON.stringify([subjectKey, fingerprint]))
  ), [exactEvidenceReceipts])

  return useMemo(() => ({
    status,
    dayKey,
    timeZone,
    nextRolloverAt,
    revision,
    day,
    evidenceReceipts,
    hasEvidenceReceipt,
    refresh,
    open,
    reconcileShift,
    deferDuty,
    startNextShift,
    reviewEvidence,
    forgetEvidence,
  }), [
    day,
    dayKey,
    deferDuty,
    evidenceReceipts,
    forgetEvidence,
    hasEvidenceReceipt,
    nextRolloverAt,
    open,
    reconcileShift,
    refresh,
    reviewEvidence,
    revision,
    startNextShift,
    status,
    timeZone,
  ])
}
