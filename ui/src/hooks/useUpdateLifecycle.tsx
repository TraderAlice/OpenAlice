import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { VersionInfo } from '../api/types'
import { api } from '../api'
import { useBackendRecoverySignal } from '../auth/AuthContext'
import { useWorkspaces } from '../contexts/workspaces-context'

export interface UpdatePreferences {
  autoCheckApp: boolean
  autoUpdateAutoQuant: boolean
  autoUpdateAutoPrediction: boolean
}
export interface WorkspaceUpdateState {
  workspaceId: string
  template: 'auto-quant-v2' | 'auto-prediction'
  phase: 'checking' | 'current' | 'updated' | 'blocked' | 'failed' | 'disabled'
  checkedAt: string | null
  fromVersion?: string
  toVersion?: string
  verified?: boolean
  reason?: string
}
type NativeStatus =
  | { phase: 'available'; version?: string; releaseUrl?: string }
  | { phase: 'downloading'; version?: string; percent?: number }
  | { phase: 'downloaded'; version: string; releaseUrl: string }
  | { phase: 'installing'; version: string; stage: 'preparing' | 'stopping-services' | 'releasing-runtime' | 'handing-off' }
  | { phase: 'error'; message: string }
interface UpdateResponse { preferences: UpdatePreferences; workspaces: WorkspaceUpdateState[] }

export interface UpdateLifecycle {
  preferences: UpdatePreferences | null
  versionInfo: VersionInfo | null
  nativeStatus: NativeStatus | null
  workspaceStates: WorkspaceUpdateState[]
  checking: boolean
  error: string | null
  versionError: string | null
  updatesUnsupported: boolean
  availableCount: number
  refresh(): Promise<void>
  savePreferences(next: UpdatePreferences): Promise<void>
}

const Context = createContext<UpdateLifecycle | null>(null)
const POLL_MS = 60_000
const CLIENT_VERSION = typeof __OPENALICE_UI_VERSION__ === 'string' ? __OPENALICE_UI_VERSION__ : 'development'

function newerRelease(latest: string | null | undefined, current: string): boolean {
  const parse = (version: string) => /^v?(\d+)\.(\d+)\.(\d+)(?:-(.+))?$/.exec(version)
  const a = latest && parse(latest)
  const b = parse(current)
  if (!a || !b) return false
  for (let index = 1; index <= 3; index += 1) {
    const difference = Number(a[index]) - Number(b[index])
    if (difference) return difference > 0
  }
  if (!a[4]) return Boolean(b[4])
  if (!b[4]) return false
  return a[4].localeCompare(b[4], undefined, { numeric: true }) > 0
}

async function getUpdates(): Promise<UpdateResponse> {
  const response = await fetch('/api/updates')
  // Pre-update-lifecycle Runtimes serve their SPA for unknown /api routes.
  // That fallback is HTTP 200 text/html, so response.ok alone is insufficient.
  if (response.status === 404 || response.status === 405 || response.headers?.get('content-type')?.includes('text/html')) {
    throw new UnsupportedUpdatesError()
  }
  if (!response.ok) throw new Error(`Update status failed: HTTP ${response.status}`)
  return response.json() as Promise<UpdateResponse>
}

class UnsupportedUpdatesError extends Error {}

export function UpdateLifecycleProvider({ children }: { children: ReactNode }) {
  const { workspaces, refresh: refreshWorkspaces } = useWorkspaces()
  const { backendUnavailable, backendRecoveryGeneration } = useBackendRecoverySignal()
  const [preferences, setPreferences] = useState<UpdatePreferences | null>(null)
  const [versionInfo, setVersionInfo] = useState<VersionInfo | null>(null)
  const [nativeStatus, setNativeStatus] = useState<NativeStatus | null>(null)
  const [workspaceStates, setWorkspaceStates] = useState<WorkspaceUpdateState[]>([])
  const [checking, setChecking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [versionError, setVersionError] = useState<string | null>(null)
  const [updatesUnsupported, setUpdatesUnsupported] = useState(false)
  const updatesSupported = useRef<boolean | null>(null)
  const nativeAutoChecked = useRef(false)
  const observedWorkspaceUpdates = useRef(new Set<string>())

  const load = useCallback(async (force = false) => {
    if (backendUnavailable) return
    if (force) setChecking(true)
    let snapshot: UpdateResponse | null = null
    try {
      // Once an older Runtime is identified, avoid POSTing a check endpoint it
      // cannot implement. GET remains a cheap capability probe after upgrades.
      const response = force && updatesSupported.current !== false
        ? await fetch('/api/updates/check', { method: 'POST' })
        : null
      if (response && (response.status === 404 || response.status === 405 || response.headers?.get('content-type')?.includes('text/html'))) {
        throw new UnsupportedUpdatesError()
      }
      if (response && !response.ok) throw new Error(`Update check failed: HTTP ${response.status}`)
      snapshot = response ? await response.json() as UpdateResponse : await getUpdates()
      updatesSupported.current = true
      setUpdatesUnsupported(false)
      setPreferences(snapshot.preferences)
      setWorkspaceStates(snapshot.workspaces)
      let refreshedWorkspace = false
      for (const state of snapshot.workspaces) {
        if (state.phase !== 'updated') continue
        const key = `${state.workspaceId}:${state.toVersion}`
        if (observedWorkspaceUpdates.current.has(key)) continue
        observedWorkspaceUpdates.current.add(key)
        refreshedWorkspace = true
      }
      if (refreshedWorkspace) void refreshWorkspaces().catch(() => undefined)
      setError(null)
    } catch (cause) {
      const unsupported = cause instanceof UnsupportedUpdatesError
      updatesSupported.current = unsupported ? false : updatesSupported.current
      setUpdatesUnsupported(unsupported)
      setPreferences(null)
      setWorkspaceStates([])
      setError(unsupported ? null : cause instanceof Error ? cause.message : String(cause))
    }
    // Version identity is independent of the newer Workspace update API.
    // Keep it visible when an older remote Runtime cannot serve /api/updates.
    try {
      const next = force ? await api.version.check() : snapshot?.preferences.autoCheckApp === false ? await api.version.current() : await api.version.get()
      setVersionInfo(next)
      setVersionError(null)
      if (force) await window.openAlice?.updater?.checkForUpdates().catch(() => undefined)
      else if (!nativeAutoChecked.current && window.openAlice?.updater && snapshot?.preferences.autoCheckApp !== false) {
        nativeAutoChecked.current = true
        void window.openAlice.updater.checkForUpdates().catch(() => undefined)
      }
    } catch (cause) {
      setVersionError(cause instanceof Error ? cause.message : String(cause))
    }
    finally { if (force) setChecking(false) }
  }, [backendUnavailable, refreshWorkspaces])

  useEffect(() => {
    if (backendUnavailable) {
      setPreferences(null)
      setVersionInfo(null)
      setWorkspaceStates([])
      setVersionError(null)
      setUpdatesUnsupported(false)
      updatesSupported.current = null
      return
    }
    let active = true
    let timer: number | undefined
    // Two frames let the shell paint before the backend begins cloning or
    // checking source releases. Activation is idempotent across tabs.
    const first = window.requestAnimationFrame(() => {
      const second = window.requestAnimationFrame(() => {
        if (!active) return
        void fetch('/api/updates/activate', { method: 'POST' }).catch(() => undefined)
        void load()
        timer = window.setInterval(() => { void load() }, POLL_MS)
      })
      cancelSecond = () => window.cancelAnimationFrame(second)
    })
    let cancelSecond: (() => void) | undefined
    return () => {
      active = false
      window.cancelAnimationFrame(first)
      cancelSecond?.()
      if (timer !== undefined) window.clearInterval(timer)
    }
  }, [backendRecoveryGeneration, backendUnavailable, load])

  useEffect(() => {
    const updater = window.openAlice?.updater
    if (!updater) return
    void updater.getStatus().then((status) => setNativeStatus(status)).catch(() => undefined)
    return updater.onStatus((status) => setNativeStatus(status))
  }, [])

  const savePreferences = useCallback(async (next: UpdatePreferences) => {
    const enabledWorkspaceUpdates = Boolean(
      (next.autoUpdateAutoQuant && !preferences?.autoUpdateAutoQuant)
      || (next.autoUpdateAutoPrediction && !preferences?.autoUpdateAutoPrediction),
    )
    const response = await fetch('/api/preferences/updates', {
      method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(next),
    })
    if (!response.ok) throw new Error(`Could not save update preferences: HTTP ${response.status}`)
    setPreferences(await response.json() as UpdatePreferences)
    await load()
    if (enabledWorkspaceUpdates) {
      void fetch('/api/updates/check', { method: 'POST' }).then(() => load()).catch(() => undefined)
    }
  }, [load, preferences])

  const availableCount = useMemo(() => {
    const candidates = new Set<string>()
    if (preferences?.autoCheckApp && versionInfo?.hasUpdate) candidates.add('backend')
    if (preferences?.autoCheckApp && newerRelease(versionInfo?.latest, CLIENT_VERSION)) candidates.add('client')
    if (preferences?.autoCheckApp && ['available', 'downloaded'].includes(nativeStatus?.phase ?? '')) candidates.add('client')
    for (const workspace of workspaces) {
      const completed = workspaceStates.find((state) => state.workspaceId === workspace.id
        && state.phase === 'updated' && state.toVersion === workspace.upgradeAvailable?.to)
      if (workspace.upgradeAvailable && !completed) candidates.add(workspace.id)
    }
    for (const state of workspaceStates) {
      if (state.toVersion && ['blocked', 'failed'].includes(state.phase)) candidates.add(state.workspaceId)
    }
    return candidates.size
  }, [nativeStatus, preferences, versionInfo, workspaceStates, workspaces])

  const value = useMemo<UpdateLifecycle>(() => ({
    preferences, versionInfo, nativeStatus, workspaceStates, checking, error, versionError, updatesUnsupported, availableCount,
    refresh: () => load(true), savePreferences,
  }), [preferences, versionInfo, nativeStatus, workspaceStates, checking, error, versionError, updatesUnsupported, availableCount, load, savePreferences])
  return <Context.Provider value={value}>{children}</Context.Provider>
}

export function useUpdateLifecycle(): UpdateLifecycle {
  const value = useContext(Context)
  if (!value) throw new Error('UpdateLifecycleProvider is missing')
  return value
}

/** For shared chrome rendered in isolated component previews. */
export function useOptionalUpdateLifecycle(): UpdateLifecycle | null {
  return useContext(Context)
}
