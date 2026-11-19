import { useEffect, useState } from 'react'

import { api } from '../api'
import type { ScheduleSkipState, ScheduleSnapshot, ScheduleTask } from '../api/schedule'

/**
 * Process-level cache of the last snapshot. It survives unmount, so reopening
 * a schedule surface shows data instantly instead of flashing while a fresh
 * fetch round-trips. The backend serves this from the launcher scanner's warm
 * cache, so the refresh is cheap.
 */
let cached: ScheduleSnapshot | null = null
let latestError: string | null = null
let requestEpoch = 0
let activePollers = 0
let pollTimer: ReturnType<typeof setInterval> | null = null

const POLL_MS = 15_000

const snapshotListeners = new Set<() => void>()
const stateListeners = new Set<() => void>()

function notifySnapshot(): void {
  for (const listener of snapshotListeners) listener()
}

function notifyState(): void {
  for (const listener of stateListeners) listener()
}

export async function refreshSchedules(): Promise<void> {
  const request = ++requestEpoch
  try {
    const next = await api.schedule.get()
    if (request !== requestEpoch) return
    const snapshotChanged = cached !== next
    const errorChanged = latestError !== null
    cached = next
    latestError = null
    if (snapshotChanged) notifySnapshot()
    if (snapshotChanged || errorChanged) notifyState()
  } catch (e) {
    if (request !== requestEpoch) return
    const message = e instanceof Error ? e.message : String(e)
    if (latestError !== message) {
      latestError = message
      notifyState()
    }
  }
}

function retainPoller(): () => void {
  activePollers += 1
  if (activePollers === 1) {
    void refreshSchedules()
    pollTimer = setInterval(() => void refreshSchedules(), POLL_MS)
  } else {
    void refreshSchedules()
  }
  return () => {
    activePollers = Math.max(0, activePollers - 1)
    if (activePollers === 0 && pollTimer !== null) {
      clearInterval(pollTimer)
      pollTimer = null
    }
  }
}

/** Test-only helper to clear the module-level warm cache and poll state. */
export function resetSchedulesCache(): void {
  requestEpoch += 1
  cached = null
  latestError = null
  if (pollTimer !== null) {
    clearInterval(pollTimer)
    pollTimer = null
  }
  activePollers = 0
}

export function resolveScheduleTask(
  snapshot: ScheduleSnapshot | null | undefined,
  wsId: string,
  taskId: string,
): ScheduleTask | undefined {
  const workspace = snapshot?.workspaces?.find((ws) => ws.wsId === wsId)
  if (!workspace || workspace.status !== 'ok') return undefined
  return workspace.tasks.find((task) => task.id === taskId)
}

/**
 * Resolve the active scanner `skipState` for `(wsId, taskId)`.
 * When `snapshot` has loaded an `'ok'` workspace entry for `wsId`, its task
 * projection is authoritative (including clearing a previous skip state);
 * before `snapshot` loads, falls back to an inline `fallback` if provided.
 */
export function resolveScheduleSkipState(
  snapshot: ScheduleSnapshot | null | undefined,
  wsId: string,
  taskId: string,
  fallback?: ScheduleSkipState,
): ScheduleSkipState | undefined {
  const workspace = snapshot?.workspaces?.find((ws) => ws.wsId === wsId)
  if (workspace && workspace.status === 'ok') {
    const task = workspace.tasks.find((entry) => entry.id === taskId)
    if (!task || !task.enabled) return undefined
    return task.skipState
  }
  return fallback
}

export interface UseSchedulesOptions {
  enabled?: boolean
}

export interface UseSchedules {
  snapshot: ScheduleSnapshot | null
  /** Set when the LATEST refresh failed (may coexist with a stale snapshot). */
  error: string | null
  /** True only before the very first load this session (cache cold). */
  loading: boolean
  /** Trigger an immediate refresh across all mounted schedule consumers. */
  refresh: () => Promise<void>
}

/**
 * Shared data source for the workspace self-scheduling snapshot (GET
 * /api/schedule). Polls while mounted and keeps a process-level cache so the
 * data is already on screen when a consumer mounts.
 */
export function useSchedules(options?: UseSchedulesOptions): UseSchedules {
  const enabled = options?.enabled ?? true
  const [, setTick] = useState(0)

  useEffect(() => {
    if (!enabled) return
    const rerender = () => setTick((n) => n + 1)
    stateListeners.add(rerender)
    const release = retainPoller()
    return () => {
      stateListeners.delete(rerender)
      release()
    }
  }, [enabled])

  return {
    snapshot: cached,
    error: latestError,
    loading: enabled && cached === null && latestError === null,
    refresh: refreshSchedules,
  }
}

/**
 * Lightweight subscription to `ScheduleSnapshot` that only re-renders when the
 * snapshot itself changes (ignoring transient poll errors) and skips polling
 * when `enabled` is false.
 */
export function useScheduleSnapshot(options?: UseSchedulesOptions): {
  snapshot: ScheduleSnapshot | null
  refresh: () => Promise<void>
} {
  const enabled = options?.enabled ?? true
  const [snapshot, setSnapshot] = useState<ScheduleSnapshot | null>(() => cached)

  useEffect(() => {
    if (!enabled) return
    setSnapshot(cached)
    const sync = () => setSnapshot(cached)
    snapshotListeners.add(sync)
    const release = retainPoller()
    return () => {
      snapshotListeners.delete(sync)
      release()
    }
  }, [enabled])

  return { snapshot, refresh: refreshSchedules }
}
