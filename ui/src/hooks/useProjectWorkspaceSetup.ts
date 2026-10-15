import { createContext, createElement, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { useWorkspaces } from '../contexts/workspaces-context'
import { fetchJson } from '../api/client'
import { useBackendRecoverySignal } from '../auth/AuthContext'

export type ProjectWorkspaceSetup = { pending: string[]; errors?: Record<string, string>; phase?: 'idle' | 'preparing' | 'complete' }
export function projectSetupFailures(setup: ProjectWorkspaceSetup | null, error: string | null) {
  if (error) return [{ kind: 'status', reason: error }]
  if (!setup || setup.phase === 'preparing' || setup.phase === 'idle') return []
  return setup.pending.flatMap(kind => setup.errors?.[kind] ? [{ kind, reason: setup.errors[kind] }] : [])
}

function useSetupState(enabled = true) {
  const { backendUnavailable, backendRecoveryGeneration } = useBackendRecoverySignal()
  const [setup, setSetup] = useState<ProjectWorkspaceSetup | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const generation = useRef(0)
  const readFlight = useRef<Promise<ProjectWorkspaceSetup | null> | null>(null)
  const retryFlight = useRef<Promise<ProjectWorkspaceSetup | null> | null>(null)
  const load = useCallback((retry = false): Promise<ProjectWorkspaceSetup | null> => {
    if (!enabled || backendUnavailable) return Promise.resolve(null)
    if (retryFlight.current) return retryFlight.current
    if (!retry && readFlight.current) return readFlight.current
    const request = ++generation.current
    if (retry) setBusy(true)
    const flight = Promise.resolve().then(async () => {
      try {
        const result = await fetchJson<ProjectWorkspaceSetup>(`/api/workspaces/project-setup${retry ? '/retry' : ''}`, retry ? { method: 'POST' } : undefined)
        if (request === generation.current) { setSetup(result); setError(null) }
        return result
      } catch (cause) {
        if (request === generation.current) setError(cause instanceof Error ? cause.message : String(cause))
        return null
      } finally {
        if (retryFlight.current === flight) { retryFlight.current = null; setBusy(false) }
        if (readFlight.current === flight) readFlight.current = null
      }
    })
    if (retry) retryFlight.current = flight
    else readFlight.current = flight
    return flight
  }, [enabled, backendUnavailable, backendRecoveryGeneration])
  useEffect(() => {
    setSetup(null); setError(null); setBusy(false)
    void load()
    return () => { ++generation.current; readFlight.current = null; retryFlight.current = null }
  }, [load])
  useEffect(() => {
    if (!enabled || backendUnavailable || (setup?.phase === 'complete' && !error)) return
    const timer = window.setInterval(() => { void load() }, 1500)
    return () => window.clearInterval(timer)
  }, [enabled, backendUnavailable, load, setup?.phase, error])
  return { setup, error, busy, retry: useCallback(() => load(true), [load]) }
}
const Context = createContext<ReturnType<typeof useSetupState> | null>(null)
export function ProjectWorkspaceSetupProvider({ children }: { children: ReactNode }) {
  const state = useSetupState()
  const { refresh, refreshAutoQuantPreference, refreshAutoPredictionPreference } = useWorkspaces()
  useEffect(() => {
    if (state.setup?.phase !== 'complete') return
    void Promise.all([refresh(), refreshAutoQuantPreference(), refreshAutoPredictionPreference?.()]).catch(() => undefined)
  }, [state.setup, refresh, refreshAutoQuantPreference, refreshAutoPredictionPreference])
  return createElement(Context.Provider, { value: state }, children)
}
/** Optional selection lets the update owner consume setup without owning its transport. */
export const useSharedProjectWorkspaceSetup = () => useContext(Context)
export function useProjectWorkspaceSetup() {
  const shared = useSharedProjectWorkspaceSetup()
  const local = useSetupState(!shared)
  return shared ?? local
}
