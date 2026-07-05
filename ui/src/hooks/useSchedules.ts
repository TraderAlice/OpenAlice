import { useEffect, useRef, useState } from 'react'

import { api } from '../api'
import type { ScheduleSnapshot } from '../api/schedule'

/**
 * Process-level cache of the last snapshot. It survives unmount, so reopening
 * the Schedules tab (or mounting any future consumer) shows data instantly
 * instead of flashing "Loading…" while a fresh fetch round-trips. The backend
 * serves this from the launcher scanner's warm cache, so the refresh is cheap.
 */
let cached: ScheduleSnapshot | null = null

const POLL_MS = 15_000

export interface UseSchedules {
  snapshot: ScheduleSnapshot | null
  /** Set when the LATEST refresh failed (may coexist with a stale snapshot). */
  error: string | null
  /** True only before the very first load this session (cache cold). */
  loading: boolean
}

/**
 * Shared data source for the workspace self-scheduling snapshot (GET
 * /api/schedule). Polls while mounted and keeps a process-level cache so the
 * data is already on screen when a consumer mounts. Reusable by the Schedules
 * dashboard and any future "agents at work" visualization.
 */
export function useSchedules(): UseSchedules {
  const [snapshot, setSnapshot] = useState<ScheduleSnapshot | null>(cached)
  const [error, setError] = useState<string | null>(null)
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    const load = async () => {
      try {
        const next = await api.schedule.get()
        cached = next
        if (mounted.current) {
          setSnapshot(next)
          setError(null)
        }
      } catch (e) {
        if (mounted.current) setError(e instanceof Error ? e.message : String(e))
      }
    }
    void load()
    const id = setInterval(() => void load(), POLL_MS)
    return () => {
      mounted.current = false
      clearInterval(id)
    }
  }, [])

  return { snapshot, error, loading: snapshot === null && error === null }
}
