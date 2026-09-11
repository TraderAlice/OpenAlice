import { useCallback, useEffect, useState } from 'react'
import { fetchJson } from '../api/client'
export interface AliceHarnessConfig {
  skills?: Record<string, boolean>
  schemaVersion: 1
  cli: Record<string, { enabled?: boolean; groups?: Record<string, boolean> }>
}
export interface AliceHarnessStatus {
  managedSkillNames: string[]
  skillDefaults: Record<string, boolean>
  appliedVersion: string | null
  availableVersion: string
  config: AliceHarnessConfig
  commands: Record<string, string[]>
}
export function useAliceHarness(wsId: string) {
  const [data, setData] = useState<AliceHarnessStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [revision, setRevision] = useState(0)
  const refresh = useCallback(() => setRevision((value) => value + 1), [])
  useEffect(() => {
    const controller = new AbortController()
    setData(null)
    setError(null)
    void fetchJson<AliceHarnessStatus>(`/api/workspaces/${encodeURIComponent(wsId)}/alice-harness`, { signal: controller.signal })
      .then((value) => { if (!controller.signal.aborted) setData(value) })
      .catch((err) => { if (!controller.signal.aborted) setError((err as Error).message) })
    return () => controller.abort()
  }, [wsId, revision])
  const save = async (config: AliceHarnessConfig) => {
    await fetchJson(`/api/workspaces/${encodeURIComponent(wsId)}/alice-harness/config`, {
      method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(config),
    })
    refresh()
  }
  return { data, error, refresh, save }
}
