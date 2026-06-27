import { useEffect, useRef, useState } from 'react'

import { api } from '../api'
import type { IssueSnapshot } from '../api/issues'

/**
 * Process-level cache of the last snapshot. It survives unmount, so reopening
 * the Issues tab (or mounting any future consumer) shows data instantly
 * instead of flashing "Loading…" while a fresh fetch round-trips. The backend
 * serves this from the launcher scanner's warm cache, so the refresh is cheap.
 *
 * Mirrors hooks/useSchedules.ts — same poll cadence + warm-cache shape, but
 * reads the full issue board (scheduled + unscheduled work items).
 */
let cached: IssueSnapshot | null = null

const POLL_MS = 15_000

export interface UseIssues {
  data: IssueSnapshot | null
  /** Set when the LATEST refresh failed (may coexist with a stale snapshot). */
  error: string | null
  /** True only before the very first load this session (cache cold). */
  loading: boolean
}

/**
 * Shared data source for the global Issue board (GET /api/issues). Polls while
 * mounted and keeps a process-level cache so the data is already on screen when
 * a consumer mounts.
 */
export function useIssues(): UseIssues {
  const [data, setData] = useState<IssueSnapshot | null>(cached)
  const [error, setError] = useState<string | null>(null)
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    const load = async () => {
      try {
        const next = await api.issues.get()
        cached = next
        if (mounted.current) {
          setData(next)
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

  return { data, error, loading: data === null && error === null }
}
