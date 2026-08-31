import { useCallback, useEffect, useMemo, useState } from 'react'

import { officeDutyEstimateMinutes, type OfficeDutyCandidate, type OfficeDutySourceStatus } from './duty-registry'
import {
  createOfficeShiftSnapshot,
  deferOfficeShiftDuty,
  readOfficeShiftSnapshot,
  reconcileOfficeShiftSnapshot,
  writeOfficeShiftSnapshot,
  type OfficeShiftSnapshot,
} from './office-shift'

export type OfficeShiftState = 'planning' | 'active' | 'quiet' | 'complete' | 'clear' | 'degraded'

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
  defer(duty: OfficeDutyCandidate): void
  startNext(): void
}

export function useOfficeShift(input: {
  readonly candidates: readonly OfficeDutyCandidate[]
  readonly status: OfficeDutySourceStatus
  readonly unresolvedCount: number
}): OfficeShift {
  const { candidates: sourceCandidates, status, unresolvedCount } = input
  const [snapshot, setSnapshot] = useState<OfficeShiftSnapshot | null>(readOfficeShiftSnapshot)

  useEffect(() => {
    setSnapshot((current) => {
      const next = reconcileOfficeShiftSnapshot(
        current,
        sourceCandidates,
        status,
        unresolvedCount,
      )
      if (next && next !== current) writeOfficeShiftSnapshot(next)
      return next
    })
  }, [sourceCandidates, status, unresolvedCount])

  const candidateById = useMemo(
    () => new Map(sourceCandidates.map((candidate) => [candidate.id, candidate] as const)),
    [sourceCandidates],
  )
  const shiftCandidates = useMemo(() => (snapshot?.order ?? []).flatMap((id) => {
    const candidate = candidateById.get(id)
    return candidate ? [candidate] : []
  }), [candidateById, snapshot?.order])
  const total = snapshot?.slots.length ?? 0
  const completed = Math.max(0, total - (snapshot?.order.length ?? 0))
  const remainingMinutes = shiftCandidates.reduce(
    (sum, candidate) => sum + officeDutyEstimateMinutes(candidate),
    0,
  )
  const backlogCount = status === 'ready'
    ? Math.max(0, sourceCandidates.length - (snapshot?.order.length ?? 0))
    : null
  const canStartNext = status === 'ready'
    && (snapshot?.order.length ?? 0) === 0
    && sourceCandidates.length > 0

  let state: OfficeShiftState
  if (shiftCandidates.length > 0) state = 'active'
  else if (status === 'error') state = 'degraded'
  else if (status === 'loading') state = 'planning'
  else if (!snapshot || snapshot.slots.length === 0) state = 'quiet'
  else if (snapshot.cleared) state = 'clear'
  else state = 'complete'

  const defer = useCallback((duty: OfficeDutyCandidate) => {
    setSnapshot((current) => {
      if (!current) return current
      const next = deferOfficeShiftDuty(current, duty.id)
      if (next !== current) writeOfficeShiftSnapshot(next)
      return next
    })
  }, [])

  const startNext = useCallback(() => {
    if (status !== 'ready' || sourceCandidates.length === 0) return
    const next = createOfficeShiftSnapshot(sourceCandidates)
    writeOfficeShiftSnapshot(next)
    setSnapshot(next)
  }, [sourceCandidates, status])

  return {
    candidates: shiftCandidates,
    state,
    sourceStatus: status,
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
