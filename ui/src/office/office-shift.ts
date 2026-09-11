import {
  officeDutyKey,
  type OfficeDutyCandidate,
  type OfficeDutySourceStatus,
} from './duty-registry'

export const OFFICE_SHIFT_LIMIT = 4

export interface OfficeShiftSnapshot {
  readonly createdAt: number
  /** Frozen exact-duty membership. */
  readonly slots: readonly string[]
  /** Pending exact-duty order. Later rotates this list without changing progress. */
  readonly order: readonly string[]
  /** True only when the frozen shift settled with no remaining mandatory domain facts. */
  readonly cleared: boolean
}

function uniqueIds(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))]
}

function scheduledIssueRoutineKey(candidate: OfficeDutyCandidate): string | null {
  if (candidate.kind === 'cadence') {
    return `${candidate.destination.workspaceId}\u0000${candidate.destination.issueId}`
  }
  if (candidate.kind === 'inbox' && candidate.delivery.declaredIssue) {
    const { workspaceId, issueId } = candidate.delivery.declaredIssue
    return `${workspaceId}\u0000${issueId}`
  }
  return null
}

export function createOfficeShiftSnapshot(
  candidates: readonly OfficeDutyCandidate[],
  now = Date.now(),
): OfficeShiftSnapshot {
  const candidateKeys = new Set<string>()
  const canonical = candidates.filter((candidate) => {
    const key = officeDutyKey(candidate)
    if (!candidate.id.trim() || candidateKeys.has(key)) return false
    candidateKeys.add(key)
    return true
  })
  const coveredRoutines = new Set<string>()
  const firstCoverage: OfficeDutyCandidate[] = []
  const repeatedVersions: OfficeDutyCandidate[] = []
  for (const candidate of canonical) {
    const routine = scheduledIssueRoutineKey(candidate)
    if (routine && coveredRoutines.has(routine)) {
      repeatedVersions.push(candidate)
      continue
    }
    if (routine) coveredRoutines.add(routine)
    firstCoverage.push(candidate)
  }
  // Cover distinct declared routines and all ungrouped facts first. If fewer
  // than four exist, fill the finite batch with separate repeated deliveries
  // in their original canonical order; no row or receipt is coalesced.
  const slots = uniqueIds([...firstCoverage, ...repeatedVersions]
    .slice(0, OFFICE_SHIFT_LIMIT)
    .map(officeDutyKey))
  return { createdAt: now, slots, order: slots, cleared: false }
}

export function reconcileOfficeShiftSnapshot(
  snapshot: OfficeShiftSnapshot | null,
  candidates: readonly OfficeDutyCandidate[],
  status: OfficeDutySourceStatus,
  unresolvedCount: number,
  now = Date.now(),
): OfficeShiftSnapshot | null {
  if (status !== 'ready') return snapshot
  if (!snapshot) return createOfficeShiftSnapshot(candidates, now)

  // A previously cleared shift yields to the next real arrival automatically.
  if ((snapshot.cleared || snapshot.slots.length === 0) && candidates.length > 0) {
    return createOfficeShiftSnapshot(candidates, now)
  }

  const candidateKeys = new Set(candidates.map(officeDutyKey))
  const order = snapshot.order.filter((key) => candidateKeys.has(key))
  const cleared = snapshot.slots.length > 0 && order.length === 0 && unresolvedCount === 0
  if (cleared === snapshot.cleared
    && order.length === snapshot.order.length
    && order.every((id, index) => id === snapshot.order[index])) {
    return snapshot
  }
  return { ...snapshot, order, cleared }
}

export function deferOfficeShiftDuty(
  snapshot: OfficeShiftSnapshot,
  dutyKey: string,
): OfficeShiftSnapshot {
  const index = snapshot.order.indexOf(dutyKey)
  if (index < 0 || snapshot.order.length < 2) return snapshot
  const order = [...snapshot.order]
  order.splice(index, 1)
  order.push(dutyKey)
  return { ...snapshot, order }
}
