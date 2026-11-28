import { useCallback, useEffect, useRef, useState } from 'react'

import { api } from '../api'
import { issuesApi, omitTelegramConnectorIssues, type IssuePatch, type IssueSnapshot } from '../api/issues'
import { resourceCache } from '../lib/resource-cache'

export const ISSUES_SNAPSHOT_CACHE_KEY = 'issues:snapshot'

const POLL_MS = 15_000
const PREFETCH_STALE_MS = 15_000

/**
 * Low-priority background warm-up for the global Issue board. Populates
 * `resourceCache` so switching to the Issues tab renders immediately instead
 * of waiting on a remote round-trip.
 */
export function prefetchIssuesSnapshot(): Promise<IssueSnapshot> {
  return resourceCache.fetch<IssueSnapshot>(
    ISSUES_SNAPSHOT_CACHE_KEY,
    async ({ priority }) => omitTelegramConnectorIssues(await api.issues.get({ priority })),
    { priority: 'low', staleTimeMs: PREFETCH_STALE_MS },
  )
}

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
 * mounted and reads/writes through `resourceCache` so the data is already on
 * screen when a consumer mounts (including after global warm-up).
 */
export function useIssues(): UseIssues & { updateIssue: (wsId: string, id: string, patch: IssuePatch) => Promise<void> } {
  const [data, setData] = useState<IssueSnapshot | null>(
    () => resourceCache.peek<IssueSnapshot>(ISSUES_SNAPSHOT_CACHE_KEY) ?? null,
  )
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
        resourceCache.set(ISSUES_SNAPSHOT_CACHE_KEY, next)
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

  const updateIssue = useCallback(async (wsId: string, id: string, patch: IssuePatch) => {
    const next = await issuesApi.update(wsId, id, patch)
    if (!mounted.current) return
    // Discard reads started before this authoritative write completed.
    requestEpochRef.current += 1
    setData((current) => {
      if (!current) return current
      const updated = { ...current, workspaces: current.workspaces.map((workspace) => workspace.wsId !== wsId ? workspace : {
        ...workspace, issues: workspace.issues.map((issue) => issue.id === id ? { ...issue, ...next.issue } : issue),
      }) }
      resourceCache.set(ISSUES_SNAPSHOT_CACHE_KEY, updated)
      return updated
    })
  }, [])

  return {
    updateIssue,
    data,
    error,
    loading: data === null && error === null,
    requestEpoch,
    successEpoch,
  }
}
