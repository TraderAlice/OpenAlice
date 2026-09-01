import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import {
  officeDutyEstimateMinutes,
  officeDutyKey,
  officeDutyProviderFromKey,
  type OfficeDutyCandidate,
  type OfficeDutySourceEpochs,
  type OfficeDutySourceStatus,
} from './duty-registry'
import {
  createOfficeShiftSnapshot,
  deferOfficeShiftDuty,
  reconcileOfficeShiftSnapshot,
  type OfficeShiftSnapshot,
} from './office-shift'
import type { OfficeDayController } from './useOfficeDay'

export type OfficeShiftState = 'planning' | 'active' | 'quiet' | 'complete' | 'clear' | 'degraded'

const OFFICE_RECONCILIATION_RETRY_INITIAL_DELAY_MS = 2_000
const OFFICE_RECONCILIATION_RETRY_MAX_DELAY_MS = 60_000

export interface OfficeShift {
  readonly candidates: readonly OfficeDutyCandidate[]
  readonly state: OfficeShiftState
  readonly sourceStatus: OfficeDutySourceStatus
  readonly total: number
  readonly completed: number
  readonly position: number | null
  readonly remainingMinutes: number
  /** Actionable duties waiting outside this frozen shift; excludes reviewed follow-ups. */
  readonly backlogCount: number | null
  readonly canStartNext: boolean
  defer(duty: OfficeDutyCandidate): Promise<void>
  startNext(): Promise<void>
}

export interface OfficeShiftSettlementSource {
  readonly requestEpoch: number
  readonly successEpoch: number
  refresh(): Promise<void>
}

function combinedStatus(
  primary: OfficeDutySourceStatus,
  secondary: OfficeDutySourceStatus,
): OfficeDutySourceStatus {
  if (primary === 'error' || secondary === 'error') return 'error'
  if (primary === 'loading' || secondary === 'loading') return 'loading'
  return 'ready'
}

function sameDutyOrder(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((dutyId, index) => dutyId === right[index])
}

function rejectedMutationMessage(action: string, reason?: string): string {
  return reason
    ? `Office Day ${action} was rejected: ${reason}.`
    : `Office Day ${action} was not applied.`
}

/**
 * Projects the Project-authoritative Office Day into the finite shift HUD.
 * The optional in-memory path keeps isolated consumers usable until they wire
 * the Day controller; it deliberately provides no refresh/tab persistence.
 */
export function useOfficeShift(input: {
  readonly candidates: readonly OfficeDutyCandidate[]
  /** Readiness of candidate-producing patrol sources. */
  readonly status: OfficeDutySourceStatus
  /** Optional broader readiness required before the whole Office may settle clear. */
  readonly settlementStatus?: OfficeDutySourceStatus
  readonly unresolvedCount: number
  /** Per-provider successful refresh counters for safe negative reconciliation. */
  readonly sourceEpochs: OfficeDutySourceEpochs
  /** Durable sidecar whose empty snapshot must be newer than the latest Inbox snapshot. */
  readonly settlementSource?: OfficeShiftSettlementSource | null
  readonly officeDay?: OfficeDayController | null
}): OfficeShift {
  const {
    candidates: sourceCandidates,
    status,
    settlementStatus = status,
    unresolvedCount,
    sourceEpochs,
    settlementSource = null,
    officeDay = null,
  } = input
  const [localSnapshot, setLocalSnapshot] = useState<OfficeShiftSnapshot | null>(null)
  const [failedReconciliationIntent, setFailedReconciliationIntent] = useState<string | null>(null)
  const [reconciliationRetryTick, setReconciliationRetryTick] = useState(0)
  const reconciliationIntentRef = useRef<string | null>(null)
  const latestReconciliationIntentRef = useRef<string | null>(null)
  const previousReconciliationIntentRef = useRef<string | null>(null)
  const reconciliationRetryTimerRef = useRef<number | null>(null)
  const reconciliationRetryReadyIntentRef = useRef<string | null>(null)
  const reconciliationRetryStateRef = useRef<{
    readonly intent: string
    readonly failures: number
  } | null>(null)
  const settlementRefreshIntentRef = useRef<string | null>(null)
  const shiftSourceBaselineRef = useRef<{
    readonly identity: string
    readonly requested: { readonly inbox: number; readonly issues: number }
  } | null>(null)

  const dayStatus = officeDay?.status ?? 'ready'
  const proposedSnapshot = useMemo(
    () => createOfficeShiftSnapshot(sourceCandidates),
    [sourceCandidates],
  )
  const persistedSnapshot = useMemo<OfficeShiftSnapshot | null>(() => {
    const shift = officeDay?.day?.shift
    return shift ? {
      createdAt: shift.openedAt,
      slots: shift.slots,
      order: shift.order,
      cleared: shift.cleared,
    } : null
  }, [officeDay?.day?.shift])
  const snapshot = officeDay ? persistedSnapshot : localSnapshot
  const openDay = officeDay?.open
  const reconcileShift = officeDay?.reconcileShift
  const officeDayKey = officeDay?.dayKey ?? null
  const officeDayRecord = officeDay?.day ?? null
  const shiftIdentity = officeDayRecord && officeDayKey
    ? `${officeDayKey}:${officeDayRecord.shift.id}`
    : null
  if (shiftIdentity && shiftSourceBaselineRef.current?.identity !== shiftIdentity) {
    shiftSourceBaselineRef.current = {
      identity: shiftIdentity,
      requested: {
        inbox: sourceEpochs.inbox.requested,
        issues: sourceEpochs.issues.requested,
      },
    }
  }
  const shiftSourceBaseline = shiftIdentity === shiftSourceBaselineRef.current?.identity
    ? shiftSourceBaselineRef.current.requested
    : null
  const settlementBarrierRef = useRef<{
    readonly identity: string
    readonly requested: number
  } | null>(null)
  const settlementBarrierIdentity = shiftIdentity && settlementSource
    ? `${shiftIdentity}:${sourceEpochs.inbox.successful}`
    : null
  if (settlementBarrierIdentity
    && settlementBarrierRef.current?.identity !== settlementBarrierIdentity) {
    settlementBarrierRef.current = {
      identity: settlementBarrierIdentity,
      requested: settlementSource!.requestEpoch,
    }
    settlementRefreshIntentRef.current = null
  }
  const settlementBarrier = settlementBarrierIdentity === settlementBarrierRef.current?.identity
    ? settlementBarrierRef.current
    : null
  const settlementFresh = !settlementSource
    || !settlementBarrier
    || settlementSource.successEpoch > settlementBarrier.requested
  const effectiveSettlementStatus: OfficeDutySourceStatus = settlementStatus !== 'ready'
    ? settlementStatus
    : settlementFresh ? 'ready' : 'loading'
  const effectiveUnresolvedCount = effectiveSettlementStatus === 'ready'
    ? unresolvedCount
    : Math.max(1, unresolvedCount)
  useEffect(() => {
    if (!settlementSource || !settlementBarrier || settlementFresh) return
    const intent = settlementBarrier.identity
    if (settlementRefreshIntentRef.current === intent) return
    settlementRefreshIntentRef.current = intent
    void settlementSource.refresh().catch(() => undefined)
  }, [settlementBarrier, settlementFresh, settlementSource])
  const candidateByKey = useMemo(
    () => new Map(sourceCandidates.map((candidate) => [officeDutyKey(candidate), candidate] as const)),
    [sourceCandidates],
  )
  const nextBatchCandidates = useMemo(() => {
    if (!officeDayRecord) return sourceCandidates
    const seenDutyIds = new Set(officeDayRecord.seenDutyIds)
    return sourceCandidates.filter((candidate) => !seenDutyIds.has(officeDutyKey(candidate)))
  }, [officeDayRecord, sourceCandidates])
  const nextBatchCandidateCount = useMemo(
    () => new Set(nextBatchCandidates.map(officeDutyKey)).size,
    [nextBatchCandidates],
  )
  const sourceKeys = useMemo(() => new Set(candidateByKey.keys()), [candidateByKey])
  const isConfirmedMissing = useCallback((key: string) => {
    if (sourceKeys.has(key) || !shiftSourceBaseline) return false
    const provider = officeDutyProviderFromKey(key)
    return provider != null
      && sourceEpochs[provider].successful > shiftSourceBaseline[provider]
  }, [shiftSourceBaseline, sourceEpochs, sourceKeys])
  const presentSlotIds = useMemo(
    () => (officeDayRecord?.shift.slots ?? []).filter((key) => !isConfirmedMissing(key)),
    [isConfirmedMissing, officeDayRecord?.shift.slots],
  )
  const proposedSlots = proposedSnapshot.slots
  const reconciliationIntent = officeDayRecord && officeDayKey
    ? JSON.stringify([
        'reconcile',
        officeDayKey,
        officeDayRecord.shift.id,
        presentSlotIds,
        proposedSlots,
        effectiveUnresolvedCount,
      ])
    : null
  latestReconciliationIntentRef.current = reconciliationIntent
  useEffect(() => {
    if (previousReconciliationIntentRef.current === reconciliationIntent) return
    previousReconciliationIntentRef.current = reconciliationIntent
    if (reconciliationRetryTimerRef.current !== null) {
      window.clearTimeout(reconciliationRetryTimerRef.current)
      reconciliationRetryTimerRef.current = null
    }
    reconciliationRetryReadyIntentRef.current = null
    reconciliationRetryStateRef.current = null
    if (failedReconciliationIntent !== reconciliationIntent) {
      setFailedReconciliationIntent(null)
    }
  }, [failedReconciliationIntent, reconciliationIntent])
  useEffect(() => () => {
    if (reconciliationRetryTimerRef.current !== null) {
      window.clearTimeout(reconciliationRetryTimerRef.current)
    }
  }, [])
  const markReconciliationFailed = useCallback((intent: string): boolean => {
    if (latestReconciliationIntentRef.current !== intent) return false
    if (reconciliationIntentRef.current === intent) reconciliationIntentRef.current = null
    setFailedReconciliationIntent(intent)
    if (reconciliationRetryTimerRef.current !== null) return true
    const failures = reconciliationRetryStateRef.current?.intent === intent
      ? Math.min(reconciliationRetryStateRef.current.failures + 1, 6)
      : 1
    reconciliationRetryStateRef.current = { intent, failures }
    const retryDelay = Math.min(
      OFFICE_RECONCILIATION_RETRY_INITIAL_DELAY_MS * (2 ** (failures - 1)),
      OFFICE_RECONCILIATION_RETRY_MAX_DELAY_MS,
    )
    reconciliationRetryTimerRef.current = window.setTimeout(() => {
      reconciliationRetryTimerRef.current = null
      if (latestReconciliationIntentRef.current !== intent) return
      reconciliationRetryReadyIntentRef.current = intent
      setReconciliationRetryTick((current) => current + 1)
    }, retryDelay)
    return true
  }, [])
  const clearReconciliationFailure = useCallback((intent: string): void => {
    if (latestReconciliationIntentRef.current !== intent) return
    if (reconciliationRetryTimerRef.current !== null) {
      window.clearTimeout(reconciliationRetryTimerRef.current)
      reconciliationRetryTimerRef.current = null
    }
    reconciliationRetryReadyIntentRef.current = null
    reconciliationRetryStateRef.current = null
    setFailedReconciliationIntent((current) => current === intent ? null : current)
  }, [])
  const hasStalePendingSlot = status === 'ready'
    && Boolean(snapshot?.order.some((key) => !candidateByKey.has(key)))
  const reconciliationStatus: OfficeDutySourceStatus = hasStalePendingSlot
    ? failedReconciliationIntent === reconciliationIntent ? 'error' : 'loading'
    : 'ready'
  const sourceStatus = combinedStatus(
    combinedStatus(effectiveSettlementStatus, dayStatus),
    reconciliationStatus,
  )

  useEffect(() => {
    if (officeDay) return
    setLocalSnapshot((current) => {
      if (current?.cleared && effectiveSettlementStatus !== 'ready' && sourceCandidates.length === 0) {
        return current
      }
      return reconcileOfficeShiftSnapshot(
        current,
        sourceCandidates,
        status,
        effectiveUnresolvedCount,
      )
    })
  }, [effectiveSettlementStatus, effectiveUnresolvedCount, officeDay, sourceCandidates, status])

  useEffect(() => {
    if (!officeDay || officeDay.status !== 'ready' || status !== 'ready' || !officeDayKey) return

    if (!officeDayRecord) {
      const slots = [...proposedSnapshot.slots]
      const intent = JSON.stringify(['open', officeDayKey, slots])
      if (reconciliationIntentRef.current === intent || !openDay) return
      reconciliationIntentRef.current = intent
      void openDay(slots).catch(() => {
        if (reconciliationIntentRef.current === intent) reconciliationIntentRef.current = null
      })
      return
    }

    if (officeDayRecord.shift.cleared
      && effectiveSettlementStatus !== 'ready'
      && proposedSnapshot.slots.length === 0) return

    const intent = reconciliationIntent
    const retryAllowed = failedReconciliationIntent === intent
      && reconciliationRetryReadyIntentRef.current === intent
    if (!intent
      || (failedReconciliationIntent === intent && !retryAllowed)
      || reconciliationIntentRef.current === intent
      || !reconcileShift) return
    if (retryAllowed) reconciliationRetryReadyIntentRef.current = null
    reconciliationIntentRef.current = intent
    void reconcileShift({
      dayKey: officeDayKey,
      shiftId: officeDayRecord.shift.id,
      presentSlotIds,
      proposedSlots: [...proposedSlots],
      unresolvedCount: effectiveUnresolvedCount,
    }).then((response) => {
      const responseOrder = response.day?.shift.order
      const responseSettled = response.dayKey === officeDayKey
        && responseOrder != null
        && responseOrder.every((key) => !isConfirmedMissing(key))
      if ((!response.applied && response.reason !== 'no-change') || !responseSettled) {
        if (markReconciliationFailed(intent)) {
          void officeDay.refresh().catch(() => undefined)
        }
      } else {
        clearReconciliationFailure(intent)
      }
    }).catch(() => {
      if (markReconciliationFailed(intent)) {
        void officeDay.refresh().catch(() => undefined)
      }
    })
  }, [
    clearReconciliationFailure,
    effectiveUnresolvedCount,
    failedReconciliationIntent,
    officeDay,
    officeDayKey,
    officeDayRecord,
    openDay,
    proposedSnapshot.slots,
    proposedSlots,
    reconciliationIntent,
    reconciliationRetryTick,
    reconcileShift,
    effectiveSettlementStatus,
    isConfirmedMissing,
    markReconciliationFailed,
    status,
  ])

  const shiftCandidates = useMemo(() => (snapshot?.order ?? []).flatMap((key) => {
    const candidate = candidateByKey.get(key)
    return candidate ? [candidate] : []
  }), [candidateByKey, snapshot?.order])
  const total = snapshot?.slots.length ?? 0
  const completed = Math.max(0, total - (snapshot?.order.length ?? 0))
  const remainingMinutes = shiftCandidates.reduce(
    (sum, candidate) => sum + officeDutyEstimateMinutes(candidate),
    0,
  )
  const pendingPresentCount = (snapshot?.order ?? []).filter((key) => candidateByKey.has(key)).length
  const backlogCount = status === 'ready'
    ? officeDayRecord
      ? nextBatchCandidateCount
      : Math.max(0, candidateByKey.size - pendingPresentCount)
    : null
  const canStartNext = status === 'ready'
    && dayStatus === 'ready'
    && (snapshot?.order.length ?? 0) === 0
    && nextBatchCandidateCount > 0

  let state: OfficeShiftState
  if (hasStalePendingSlot) state = reconciliationStatus === 'error' ? 'degraded' : 'planning'
  else if (shiftCandidates.length > 0) state = 'active'
  else if (status === 'error' || dayStatus === 'error') state = 'degraded'
  else if (status === 'loading' || dayStatus === 'loading') state = 'planning'
  // Known backlog remains reviewable even if a downstream disposition source
  // is unavailable; only the final Office-clear claim waits for every source.
  else if (canStartNext) state = 'complete'
  else if (effectiveSettlementStatus === 'error') state = 'degraded'
  else if (effectiveSettlementStatus === 'loading') state = 'planning'
  else if (officeDay && !officeDayRecord) state = 'planning'
  else if (!snapshot || snapshot.slots.length === 0) state = 'quiet'
  else if (snapshot.cleared) state = 'clear'
  else state = 'complete'

  const deferDuty = officeDay?.deferDuty
  const refreshDay = officeDay?.refresh
  const defer = useCallback(async (duty: OfficeDutyCandidate): Promise<void> => {
    const dutyId = officeDutyKey(duty)
    if (officeDay) {
      if (!officeDayRecord || !officeDayKey || !deferDuty) {
        throw new Error('Office Day is unavailable for Later.')
      }
      const expected = deferOfficeShiftDuty(persistedSnapshot!, dutyId)
      const response = await deferDuty({
        dayKey: officeDayKey,
        shiftId: officeDayRecord.shift.id,
        dutyId,
      })
      const responseShift = response.day?.shift
      const equivalentNoChange = response.reason === 'no-change'
        && response.dayKey === officeDayKey
        && responseShift?.id === officeDayRecord.shift.id
        && sameDutyOrder(responseShift.order, expected.order)
      if (response.applied || equivalentNoChange) return
      await refreshDay?.().catch(() => undefined)
      throw new Error(rejectedMutationMessage('Later', response.reason))
    }
    setLocalSnapshot((current) => current ? deferOfficeShiftDuty(current, dutyId) : current)
  }, [deferDuty, officeDay, officeDayKey, officeDayRecord, persistedSnapshot, refreshDay])

  const startNextShift = officeDay?.startNextShift
  const startNext = useCallback(async (): Promise<void> => {
    if (status !== 'ready' || nextBatchCandidates.length === 0) return
    const slots = [...createOfficeShiftSnapshot(nextBatchCandidates).slots]
    if (officeDay) {
      if (!officeDayRecord || !officeDayKey || !startNextShift) {
        throw new Error('Office Day is unavailable for the next shift.')
      }
      const response = await startNextShift({
        dayKey: officeDayKey,
        shiftId: officeDayRecord.shift.id,
        slots,
      })
      const responseShift = response.day?.shift
      const equivalentNoChange = response.reason === 'no-change'
        && response.dayKey === officeDayKey
        && responseShift != null
        && responseShift.id !== officeDayRecord.shift.id
        && sameDutyOrder(responseShift.slots, slots)
        && sameDutyOrder(responseShift.order, slots)
      if (response.applied || equivalentNoChange) return
      await refreshDay?.().catch(() => undefined)
      throw new Error(rejectedMutationMessage('next shift', response.reason))
    }
    setLocalSnapshot(createOfficeShiftSnapshot(nextBatchCandidates))
  }, [
    officeDay,
    officeDayKey,
    officeDayRecord,
    refreshDay,
    nextBatchCandidates,
    startNextShift,
    status,
  ])

  return {
    candidates: shiftCandidates,
    state,
    sourceStatus,
    total,
    completed,
    position: shiftCandidates.length > 0 ? completed + 1 : null,
    remainingMinutes,
    backlogCount,
    canStartNext,
    defer,
    startNext,
  }
}
