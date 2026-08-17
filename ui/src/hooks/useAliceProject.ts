import { useCallback, useEffect, useState } from 'react'

import { api, type AliceProject } from '../api'

export interface AliceProjectSnapshot {
  readonly project: AliceProject | null
  readonly loading: boolean
  readonly error: string | null
  refresh(): Promise<void>
}

async function loadAliceProject(): Promise<AliceProject> {
  if (window.openAlice?.runtime) {
    return (await window.openAlice.runtime.info()).aliceProject
  }
  return (await api.aliceProject.get()).project
}

/**
 * Domain read boundary for the top-level runtime that owns the current UI.
 * Browser HTTP and Electron IPC stay behind this hook so presentation code
 * never needs transport branching or direct backend reads.
 */
export function useAliceProject(): AliceProjectSnapshot {
  const [project, setProject] = useState<AliceProject | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setProject(await loadAliceProject())
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    let active = true
    setLoading(true)
    setError(null)
    void loadAliceProject()
      .then((next) => {
        if (active) setProject(next)
      })
      .catch((cause) => {
        if (active) setError(cause instanceof Error ? cause.message : String(cause))
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => { active = false }
  }, [])

  return { project, loading, error, refresh }
}
