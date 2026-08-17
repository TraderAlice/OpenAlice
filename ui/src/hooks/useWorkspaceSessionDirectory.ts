import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import {
  getWorkspaceSessionDirectory,
  type WorkspaceSessionDirectory,
} from '../components/workspace/api'

const POLL_MS = 3000

export interface WorkspaceSessionDirectorySnapshot {
  readonly directory: WorkspaceSessionDirectory | null
  readonly loading: boolean
  readonly error: string | null
  refresh(): Promise<void>
}

export interface WorkspaceSessionDirectoriesSnapshot {
  readonly directories: ReadonlyMap<string, WorkspaceSessionDirectory>
  readonly loading: boolean
  readonly error: string | null
  refresh(): Promise<void>
}

function sortedIds(workspaceIds: readonly string[]): string[] {
  return [...new Set(workspaceIds.filter(Boolean))].sort()
}

/**
 * Domain read for one Workspace Session Directory (`GET /resumes`).
 * Presentation components consume this hook instead of fetching Directory
 * rows from a feature file.
 */
export function useWorkspaceSessionDirectory(
  workspaceId: string | null,
): WorkspaceSessionDirectorySnapshot {
  const snapshot = useWorkspaceSessionDirectories(workspaceId ? [workspaceId] : [])
  return useMemo(() => ({
    directory: workspaceId ? snapshot.directories.get(workspaceId) ?? null : null,
    loading: snapshot.loading,
    error: snapshot.error,
    refresh: snapshot.refresh,
  }), [snapshot, workspaceId])
}

/**
 * Directory snapshots for the desks currently visible in Ask Alice / Quant.
 * Polls with the Workspace list so occupancy locks stay live.
 */
export function useWorkspaceSessionDirectories(
  workspaceIds: readonly string[],
): WorkspaceSessionDirectoriesSnapshot {
  const ids = useMemo(() => sortedIds(workspaceIds), [workspaceIds])
  const idsKey = ids.join('|')
  const [directories, setDirectories] = useState<ReadonlyMap<string, WorkspaceSessionDirectory>>(
    () => new Map(),
  )
  const [error, setError] = useState<string | null>(null)
  const mounted = useRef(true)
  const directoriesRef = useRef(directories)
  directoriesRef.current = directories

  const refresh = useCallback(async () => {
    const requested = idsKey.length === 0 ? [] : idsKey.split('|')
    if (requested.length === 0) {
      if (mounted.current) {
        setDirectories(new Map())
        setError(null)
      }
      return
    }

    const results = await Promise.allSettled(
      requested.map(async (workspaceId) => {
        const directory = await getWorkspaceSessionDirectory(workspaceId)
        return { workspaceId, directory }
      }),
    )
    if (!mounted.current) return

    const next = new Map(directoriesRef.current)
    const failures: string[] = []
    for (const key of next.keys()) {
      if (!requested.includes(key)) next.delete(key)
    }
    for (const result of results) {
      if (result.status === 'fulfilled') {
        next.set(result.value.workspaceId, result.value.directory)
      } else {
        failures.push(result.reason instanceof Error ? result.reason.message : String(result.reason))
      }
    }
    const missing = requested.filter((workspaceId) => !next.has(workspaceId))
    setDirectories(next)
    setError(missing.length === requested.length
      ? failures[0] ?? 'Failed to load Workspace Sessions'
      : null)
  }, [idsKey])

  useEffect(() => {
    mounted.current = true
    void refresh()
    const timer = setInterval(() => void refresh(), POLL_MS)
    return () => {
      mounted.current = false
      clearInterval(timer)
    }
  }, [refresh])

  const loading = ids.some((workspaceId) => !directories.has(workspaceId)) && error === null

  return useMemo(
    () => ({ directories, loading, error, refresh }),
    [directories, error, loading, refresh],
  )
}
