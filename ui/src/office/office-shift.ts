import type { OfficeDutyCandidate, OfficeDutySourceStatus } from './duty-registry'

export const OFFICE_SHIFT_LIMIT = 4
export const OFFICE_SHIFT_STORAGE_KEY = 'openalice:office-shift:v1'

export interface OfficeShiftSnapshot {
  readonly version: 1
  readonly createdAt: number
  /** Frozen membership. Missing candidates count as completed only after every source is ready. */
  readonly slots: readonly string[]
  /** Pending slot order. Later rotates this list without changing membership or progress. */
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
  const candidateIds = new Set<string>()
  const canonical = candidates.filter((candidate) => {
    if (!candidate.id.trim() || candidateIds.has(candidate.id)) return false
    candidateIds.add(candidate.id)
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
    .map((candidate) => candidate.id))
  return { version: 1, createdAt: now, slots, order: slots, cleared: false }
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

  const candidateIds = new Set(candidates.map((candidate) => candidate.id))
  const order = snapshot.order.filter((id) => candidateIds.has(id))
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
  dutyId: string,
): OfficeShiftSnapshot {
  const index = snapshot.order.indexOf(dutyId)
  if (index < 0 || snapshot.order.length < 2) return snapshot
  const order = [...snapshot.order]
  order.splice(index, 1)
  order.push(dutyId)
  return { ...snapshot, order }
}

export function readOfficeShiftSnapshot(): OfficeShiftSnapshot | null {
  if (typeof window === 'undefined') return null
  try {
    const parsed: unknown = JSON.parse(window.sessionStorage.getItem(OFFICE_SHIFT_STORAGE_KEY) ?? 'null')
    if (!parsed || typeof parsed !== 'object') return null
    const candidate = parsed as Record<string, unknown>
    if (candidate.version !== 1
      || !Number.isFinite(candidate.createdAt)
      || !Array.isArray(candidate.slots)
      || !candidate.slots.every((value) => typeof value === 'string')
      || !Array.isArray(candidate.order)
      || !candidate.order.every((value) => typeof value === 'string')
      || typeof candidate.cleared !== 'boolean') {
      return null
    }
    const slots = uniqueIds(candidate.slots as string[])
    const slotIds = new Set(slots)
    const order = uniqueIds(candidate.order as string[]).filter((id) => slotIds.has(id))
    return {
      version: 1,
      createdAt: candidate.createdAt as number,
      slots,
      order,
      cleared: candidate.cleared,
    }
  } catch {
    return null
  }
}

export function writeOfficeShiftSnapshot(snapshot: OfficeShiftSnapshot): void {
  try {
    window.sessionStorage.setItem(OFFICE_SHIFT_STORAGE_KEY, JSON.stringify(snapshot))
  } catch {
    // Same-tab storage is continuity only; domain completion remains authoritative.
  }
}
