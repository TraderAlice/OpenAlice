import { useCallback, useEffect, useRef, useState } from 'react'

import { api } from '../api'
import type { IssueDetail } from '../api/issues'

const POLL_MS = 15_000

export interface UseIssueDetail {
  data: IssueDetail | null
  /** Set when the LATEST refresh failed (may coexist with a stale snapshot). */
  error: string | null
  /** True only before the very first load for this (wsId, id). */
  loading: boolean
  /**
   * Apply a server-returned detail immediately (after a write) without waiting
   * for the next poll. The PATCH / comment endpoints return the same shape as
   * GET, so the write path is authoritative — no optimistic divergence.
   */
  mutate: (next: IssueDetail) => void
}

/**
 * Read-only detail for one issue (GET /api/issues/:wsId/:id) — its full fields,
 * markdown body, and headless run history (Activity feed). Light poll while the
 * detail tab is open so a running run's status / the feed stay live. Unlike the
 * board hook there's no process-level cache (detail is opened on demand, one at
 * a time); it refetches when (wsId, id) changes.
 */
export function useIssueDetail(wsId: string, id: string): UseIssueDetail {
  const [data, setData] = useState<IssueDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    // Reset so switching issues doesn't show the previous one's body.
    setData(null)
    setError(null)
    const load = async () => {
      try {
        const next = await api.issues.getDetail(wsId, id)
        if (mounted.current) {
          setData(next)
          setError(null)
        }
      } catch (e) {
        if (mounted.current) setError(e instanceof Error ? e.message : String(e))
      }
    }
    void load()
    const timer = setInterval(() => void load(), POLL_MS)
    return () => {
      mounted.current = false
      clearInterval(timer)
    }
  }, [wsId, id])

  const mutate = useCallback((next: IssueDetail) => {
    if (mounted.current) {
      setData(next)
      setError(null)
    }
  }, [])

  return { data, error, loading: data === null && error === null, mutate }
}
