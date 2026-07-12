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
  const requestKey = `${wsId}:${id}`
  const activeKey = useRef(requestKey)
  // A GET that started before a successful write must not land afterwards and
  // restore its stale snapshot over the editor. Incremented by `mutate`; each
  // poll only commits when no authoritative write has happened in between.
  const mutationVersion = useRef(0)

  useEffect(() => {
    mounted.current = true
    activeKey.current = requestKey
    // Reset so switching issues doesn't show the previous one's body.
    setData(null)
    setError(null)
    const load = async () => {
      const startedAtMutation = mutationVersion.current
      try {
        const next = await api.issues.getDetail(wsId, id)
        if (mounted.current && mutationVersion.current === startedAtMutation) {
          setData(next)
          setError(null)
        }
      } catch (e) {
        if (mounted.current && mutationVersion.current === startedAtMutation) {
          setError(e instanceof Error ? e.message : String(e))
        }
      }
    }
    void load()
    const timer = setInterval(() => void load(), POLL_MS)
    return () => {
      mounted.current = false
      clearInterval(timer)
    }
  }, [wsId, id, requestKey])

  const mutate = useCallback((next: IssueDetail) => {
    if (mounted.current && activeKey.current === requestKey) {
      mutationVersion.current += 1
      setData(next)
      setError(null)
    }
  }, [requestKey])

  return { data, error, loading: data === null && error === null, mutate }
}
