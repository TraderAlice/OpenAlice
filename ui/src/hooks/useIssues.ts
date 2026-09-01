import { useEffect, useRef, useState } from 'react'

import { api } from '../api'
import { omitTelegramConnectorIssues, type IssueSnapshot } from '../api/issues'

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
  /** Latest authoritative Issue request started by this hook. */
  requestEpoch: number
  /** Request-start epoch of the latest Issue snapshot accepted by this hook. */
  successEpoch: number
}

/**
 * Shared data source for the global Issue board (GET /api/issues). Polls while
 * mounted and keeps a process-level cache so the data is already on screen when
 * a consumer mounts.
 */
export function useIssues(): UseIssues {
  const [data, setData] = useState<IssueSnapshot | null>(cached)
  const [error, setError] = useState<string | null>(null)
  const [requestEpoch, setRequestEpoch] = useState(0)
  const [successEpoch, setSuccessEpoch] = useState(0)
  const mounted = useRef(true)
  const requestEpochRef = useRef(0)

  useEffect(() => {
    mounted.current = true
    const load = async () => {
      const request = ++requestEpochRef.current
      if (mounted.current) setRequestEpoch(request)
      try {
        const next = omitTelegramConnectorIssues(await api.issues.get())
        if (!mounted.current || request !== requestEpochRef.current) return
        cached = next
        setData(next)
        setError(null)
        setSuccessEpoch(request)
      } catch (e) {
        if (mounted.current && request === requestEpochRef.current) {
          setError(e instanceof Error ? e.message : String(e))
        }
      }
    }
    void load()
    const id = setInterval(() => void load(), POLL_MS)
    return () => {
      mounted.current = false
      clearInterval(id)
    }
  }, [])

  return {
    data,
    error,
    loading: data === null && error === null,
    requestEpoch,
    successEpoch,
  }
}
