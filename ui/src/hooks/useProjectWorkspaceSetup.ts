import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchJson } from '../api/client'

type Setup = { pending: string[]; errors?: Record<string, string>; phase?: 'idle' | 'preparing' | 'complete' }
export function useProjectWorkspaceSetup() {
  const [setup, setSetup] = useState<Setup | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const generation = useRef(0)
  const load = useCallback(async (retry = false) => {
    const request = ++generation.current
    if (retry) { setBusy(true); setError(null) }
    try {
      const result = await fetchJson<Setup>(`/api/workspaces/project-setup${retry ? '/retry' : ''}`, retry ? { method: 'POST' } : undefined)
      if (request === generation.current) setSetup(result)
      return result
    } catch (cause) {
      if (request === generation.current) setError(cause instanceof Error ? cause.message : String(cause))
      return null
    } finally {
      if (retry && request === generation.current) setBusy(false)
    }
  }, [])
  useEffect(() => { void load(); return () => { ++generation.current } }, [load])
  useEffect(() => {
    if (setup?.phase === 'complete') return
    const timer = window.setInterval(() => { void load() }, 1500)
    return () => window.clearInterval(timer)
  }, [load, setup?.phase])
  return { setup, error, busy, retry: () => load(true) }
}
