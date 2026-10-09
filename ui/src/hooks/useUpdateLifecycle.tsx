import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import type { UpdatePlan, UpdateOperation, ClientUpdatePreferences, ClientUpdateSnapshot } from '@traderalice/update-lifecycle'
import { useDiscoverySnapshot } from '../lib/updates/useDiscoverySnapshot'
import type { VersionInfo } from '../api/types'
import { api } from '../api'
import { projectSetupFailures, useSharedProjectWorkspaceSetup } from './useProjectWorkspaceSetup'
import { useProjectUpdateWorkspaces, type ProjectUpdateWorkspace } from './useProjectUpdateWorkspaces'
import { useMachineControls } from './useMachineControls'
import { useBackendRecoverySignal } from '../auth/AuthContext'
import { useWorkspaces } from '../contexts/workspaces-context'
import { WorkspacePlanStore } from '../lib/updates/workspacePlans'
import { selectWorkspaceUpdateGuidance, type UpdateGuidance } from '../lib/updates/guidance'

export interface UpdatePreferences {
  autoCheckApp: boolean
  autoUpdateAutoQuant: boolean
  autoUpdateAutoPrediction: boolean
}
export interface WorkspaceUpdateState {
  workspaceId: string
  template: 'chat' | 'auto-quant-v2' | 'auto-prediction'
  phase: 'checking' | 'available' | 'applying' | 'current' | 'updated' | 'blocked' | 'failed'
  checkedAt: string | null
  fromVersion?: string
  toVersion?: string
  verified?: boolean
  reason?: string
  failureStage?: 'check' | 'review' | 'apply'
}
export type NativeStatus = import('@traderalice/update-lifecycle').NativeUpdaterStatus

interface UpdateResponse { preferences: UpdatePreferences; workspaces: WorkspaceUpdateState[] }

export interface UpdateLifecycle {
  projectWorkspaces: ProjectUpdateWorkspace[]
  operation: UpdateOperation | null
  review(selection: { client: boolean; backend: boolean; projectUnits: string[] }): Promise<UpdatePlan>
  approve(plan: UpdatePlan): Promise<void>
  abandon(): Promise<void>
  resume(): Promise<void>
  client: ClientUpdateSnapshot | null
  clientError: string | null
  saveClientPreferences(next: ClientUpdatePreferences): Promise<void>
  machines: ReturnType<typeof useMachineControls>
  preferences: UpdatePreferences | null
  versionInfo: VersionInfo | null
  nativeStatus: NativeStatus | null
  nativeReady: Extract<NativeStatus, { phase: 'downloaded' }> | null
  nativeInstalling: boolean
  nativeError: string | null
  installClient(): Promise<void>
  openClientRelease(version?: string): Promise<void>
  workspacePlans: WorkspacePlanStore
  workspaceStates: WorkspaceUpdateState[]
  checking: boolean
  error: string | null
  versionError: string | null
  updatesUnsupported: boolean
  availableCount: number
  guidance: UpdateGuidance
  refresh(): Promise<void>
  savePreferences(next: UpdatePreferences): Promise<void>
}

const Context = createContext<UpdateLifecycle | null>(null)
const POLL_MS = 60_000


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
  const machines = useMachineControls()
  const projectSetup = useSharedProjectWorkspaceSetup()
  const [operation, setOperation] = useState<UpdateOperation | null>(null)
  const readOperation = useCallback(async () => {
    try { setOperation(await coordination('operation') as UpdateOperation | null) } catch { /* Unsupported older local host. */ }
  }, [])
  useEffect(() => {
    void readOperation()
    const timer = window.setInterval(() => { void readOperation() }, operation && operation.phase !== 'succeeded' ? 1500 : POLL_MS)
    return () => window.clearInterval(timer)
  }, [readOperation, operation?.phase])
  const abandon = useCallback(async () => { await coordination('abandon'); await readOperation() }, [readOperation])
  const review = useCallback((selection: { client: boolean; backend: boolean; projectUnits: string[] }) => coordination('review', selection) as Promise<UpdatePlan>, [])
  const resume = useCallback(async () => { await coordination('resume'); await readOperation() }, [readOperation])
  const approve = useCallback(async (plan: UpdatePlan) => { setOperation(await coordination('approve', { plan, fingerprint: plan.fingerprint }) as UpdateOperation); await resume() }, [resume])
  const clientDiscovery = useDiscoverySnapshot<ClientUpdateSnapshot | null>('client-host')
  const { value: client, error: clientTransportError, check: checkClient, clear: clearClient } = clientDiscovery
  const refreshClient = useCallback(async (force = false) => {
    // Join a passive read first; a user check must not be swallowed by it.
    await checkClient(() => readClientUpdates('status'))
    if (force) await checkClient(() => readClientUpdates('check'))
  }, [checkClient])
  useEffect(() => {
    let active = true
    let second = 0
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => {
        if (!active) return
        void readClientUpdates('activate').then(() => { if (active) void refreshClient() }).catch(() => undefined)
      })
    })
    void refreshClient()
    const timer = setInterval(() => { void refreshClient() }, POLL_MS)
    return () => { active = false; cancelAnimationFrame(first); cancelAnimationFrame(second); clearInterval(timer) }
  }, [refreshClient])
  useEffect(() => {
    if (!client?.discovery.checking) return
    const timer = setInterval(() => { void refreshClient() }, 700)
    return () => clearInterval(timer)
  }, [client?.discovery.checking, refreshClient])
  const saveClientPreferences = useCallback(async (next: ClientUpdatePreferences) => {
    const saved = await readClientUpdates('preferences', next)
    if (!saved) throw new Error('This host does not support client update preferences')
    clearClient() // Retire any status read started before the policy write.
    await checkClient(async () => saved)
  }, [checkClient, clearClient])
  const { hasLoaded, refresh: refreshWorkspaces } = useWorkspaces()
  const projectWorkspaces = useProjectUpdateWorkspaces()
  const workspaces = useMemo(() => projectWorkspaces.flatMap(item => item.workspace ? [item.workspace] : []), [projectWorkspaces])
  const { backendUnavailable, backendRecoveryGeneration } = useBackendRecoverySignal()
  const workspacePlans = useMemo(() => new WorkspacePlanStore(!backendUnavailable), [backendRecoveryGeneration, backendUnavailable])
  const planRevision = useSyncExternalStore(workspacePlans.subscribe, workspacePlans.getSnapshot, workspacePlans.getSnapshot)
  useEffect(() => { if (!backendUnavailable) workspacePlans.activate(); return workspacePlans.retire }, [workspacePlans, backendUnavailable])
  useEffect(() => { workspacePlans.reconcile(workspaces, hasLoaded) }, [workspacePlans, workspaces, hasLoaded])
  const [preferences, setPreferences] = useState<UpdatePreferences | null>(null)
  const discovery = useDiscoverySnapshot<VersionInfo>(`${backendRecoveryGeneration}:${backendUnavailable}`)
  const { value: versionInfo, error: versionError, check: checkVersion, clear: clearVersion } = discovery
  const [nativeStatus, setNativeStatus] = useState<NativeStatus | null>(null)
  const [nativeReady, setNativeReady] = useState<Extract<NativeStatus, { phase: 'downloaded' }> | null>(null)
  const [nativeInstalling, setNativeInstalling] = useState(false)
  const [nativeError, setNativeError] = useState<string | null>(null)
  const nativeInstallFlight = useRef<Promise<void> | null>(null)
  const [workspaceStates, setWorkspaceStates] = useState<WorkspaceUpdateState[]>([])
  const [checking, setChecking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [updatesUnsupported, setUpdatesUnsupported] = useState(false)
  // A connection generation owns every project response, not only /version.
  // Native updater state remains local and is deliberately outside this scope.
  const scope = useMemo(() => ({ active: true }), [backendRecoveryGeneration, backendUnavailable])
  const currentScope = useRef(scope)
  currentScope.current = scope
  const isCurrent = useCallback(() => scope.active && currentScope.current === scope, [scope])
  useEffect(() => {
    scope.active = true
    return () => { scope.active = false }
  }, [scope])
  const updatesSupported = useRef<boolean | null>(null)
  const observedWorkspaceUpdates = useRef(new Set<string>())

  const load = useCallback(async (force = false) => {
    if (backendUnavailable || !isCurrent()) return
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
      if (!isCurrent()) return
      updatesSupported.current = true
      setUpdatesUnsupported(false)
      setPreferences(snapshot.preferences)
      setWorkspaceStates(snapshot.workspaces)
      workspacePlans.observe(snapshot.workspaces)
      if (force) workspacePlans.invalidateReviews()
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
      if (!isCurrent()) return
      const unsupported = cause instanceof UnsupportedUpdatesError
      updatesSupported.current = unsupported ? false : updatesSupported.current
      setUpdatesUnsupported(unsupported)
      if (unsupported) {
        setPreferences(null)
        setWorkspaceStates([])
      }
      setError(unsupported ? null : cause instanceof Error ? cause.message : String(cause))
    }
    // Version identity is independent of the newer Workspace update API.
    // Keep it visible when an older remote Runtime cannot serve /api/updates.
    try {
      await checkVersion(() => force ? api.version.check() : snapshot?.preferences.autoCheckApp === false ? api.version.current() : api.version.get())
    } catch (cause) {
      // Discovery retains the last observation alongside its error.
    }
    finally { if (force && isCurrent()) setChecking(false) }
  }, [backendUnavailable, refreshWorkspaces, checkVersion, isCurrent, workspacePlans])

  const defaultSelection = JSON.stringify(workspaces.map(workspace => workspace.id))
  const previousDefaults = useRef(defaultSelection)
  useEffect(() => {
    if (!hasLoaded) return
    if (previousDefaults.current !== defaultSelection) {
      previousDefaults.current = defaultSelection
      void load(true)
    }
  }, [defaultSelection, hasLoaded, load])

  useEffect(() => {
    if (operation?.phase === 'succeeded') void load(true)
  }, [operation?.id, operation?.phase, load])

  useEffect(() => {
    setChecking(false)
    setError(null)
    updatesSupported.current = null
    observedWorkspaceUpdates.current.clear()
    setPreferences(null)
    setWorkspaceStates([])
    setUpdatesUnsupported(false)
    if (backendUnavailable) {
      clearVersion()
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
  }, [backendRecoveryGeneration, backendUnavailable, load, clearVersion])

  useEffect(() => {
    const updater = window.openAlice?.updater
    if (!updater) return
    let active = true
    let receivedEvent = false
    const accept = (status: NativeStatus | null) => {
      setNativeStatus(status)
      if (status?.phase === 'downloaded') setNativeReady(status)
      else if (status?.phase !== 'installing') setNativeReady(null)
      if (status?.phase === 'installing') setNativeInstalling(true)
      if (status?.phase === 'error') {
        setNativeError(status.message)
        setNativeInstalling(false)
        nativeInstallFlight.current = null
      } else setNativeError(null)
    }
    const unsubscribe = updater.onStatus((status) => {
      receivedEvent = true
      if (active) { accept(status); void refreshClient() }
    })
    void updater.getStatus().then((status) => {
      if (active && !receivedEvent) accept(status)
    }).catch(() => undefined)
    return () => { active = false; unsubscribe() }
  }, [refreshClient])

  const installClient = useCallback((): Promise<void> => {
    if (nativeInstallFlight.current) return nativeInstallFlight.current
    const updater = window.openAlice?.updater
    if (!updater || !nativeReady) return Promise.reject(new Error('No downloaded client update is ready'))
    setNativeInstalling(true)
    setNativeError(null)
    const flight = Promise.resolve().then(async () => {
      const plan = await review({ client: true, backend: false, projectUnits: [] })
      if (plan.proposals.find(proposal => proposal.unit.id === 'client')?.unit.desired?.version !== nativeReady.version) {
        throw new Error('The downloaded update changed; review the current release before installing')
      }
      await approve(plan)
    }).catch((cause: unknown) => {
      nativeInstallFlight.current = null
      setNativeInstalling(false)
      setNativeError(cause instanceof Error ? cause.message : String(cause))
      throw cause
    })
    nativeInstallFlight.current = flight
    return flight
  }, [nativeReady, review, approve])

  const openClientRelease = useCallback(async (version?: string) => {
    const updater = window.openAlice?.updater
    if (updater) await updater.openRelease(version)
    else window.open(version
      ? `https://github.com/TraderAlice/OpenAlice/releases/tag/v${encodeURIComponent(version)}`
      : 'https://github.com/TraderAlice/OpenAlice/releases', '_blank', 'noopener,noreferrer')
  }, [])

  const savePreferences = useCallback(async (next: UpdatePreferences) => {
    if (backendUnavailable || !isCurrent()) throw new Error('The update target changed; retry on the current backend')
    const response = await fetch('/api/preferences/updates', {
      method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(next),
    })
    if (!response.ok) throw new Error(`Could not save update preferences: HTTP ${response.status}`)
    const saved = await response.json() as UpdatePreferences
    if (!isCurrent()) return
    setPreferences(saved)
    await load()

  }, [load, isCurrent, backendUnavailable])

  useEffect(() => { machines.clearPlan() }, [backendRecoveryGeneration, backendUnavailable, machines.clearPlan])
  useEffect(() => {
    const target = machines.status?.target
    if (!backendUnavailable && !versionError && !versionInfo?.error && versionInfo?.hasUpdate && target && target.machine !== 'local' && !machines.applying && machines.operation?.phase !== 'running') {
      void machines.probe({ mode: 'upgrade', machineKey: target.machine, projectKey: target.project }, { force: true }).catch(() => undefined)
    }
  }, [versionInfo, versionError, backendUnavailable, machines.status?.target?.machine, machines.status?.target?.project, machines.probe])

  const guidance = useMemo<UpdateGuidance>(() => {
    const app = !clientTransportError && !client?.discovery.error && !nativeError && (client?.discovery.value?.status === 'available'
      || ['available', 'downloaded'].includes(nativeStatus?.phase ?? ''))
    const backend = !versionError && !versionInfo?.error && Boolean(versionInfo?.hasUpdate)
    const project = selectWorkspaceUpdateGuidance(workspaces, workspaceStates, preferences)
    return {
      app, backend, ...project,
      availableCount: Number(app) + Number(backend) + Number(project.workspaceIds.length > 0),
      needsAttentionCount: Number(project.needsAttentionWorkspaceIds.length > 0) + Number(client?.discovery.value?.status === 'blocked') + Number(versionInfo?.decision?.status === 'blocked'),
      setupCount: projectSetupFailures(projectSetup?.setup ?? null, projectSetup?.error ?? null).length,
    }
  }, [client, clientTransportError, nativeError, nativeStatus, versionInfo, versionError, workspaceStates, workspaces, preferences, projectSetup, workspacePlans, planRevision])
  const availableCount = guidance.availableCount

  const value = useMemo<UpdateLifecycle>(() => ({
    projectWorkspaces, operation, review, approve, resume, abandon,
    client, clientError: clientTransportError ?? client?.discovery.error ?? null, saveClientPreferences,
    machines, preferences, versionInfo, nativeStatus, nativeReady, nativeInstalling, nativeError, installClient, openClientRelease, workspacePlans, workspaceStates, checking: checking || clientDiscovery.checking || Boolean(client?.discovery.checking), error, versionError, updatesUnsupported, availableCount, guidance,
    refresh: async () => { await Promise.all([load(true), refreshClient(true)]) }, savePreferences,
  }), [projectWorkspaces, operation, review, approve, resume, abandon, client, clientTransportError, saveClientPreferences, clientDiscovery.checking, refreshClient, machines, preferences, versionInfo, nativeStatus, nativeReady, nativeInstalling, nativeError, installClient, openClientRelease, workspaceStates, checking, error, versionError, updatesUnsupported, availableCount, guidance, load, savePreferences, workspacePlans, planRevision])
  return <Context.Provider value={value}>{children}</Context.Provider>
}

export function useUpdateLifecycle(options: { optional: true }): UpdateLifecycle | null
export function useUpdateLifecycle(): UpdateLifecycle
export function useUpdateLifecycle(options?: { optional: true }): UpdateLifecycle | null {
  const value = useContext(Context)
  if (!value && !options?.optional) throw new Error('UpdateLifecycleProvider is missing')
  return value
}

/** Local authority only. A legacy/direct host is explicitly unsupported; backend
 * /api/version must never be repurposed as the renderer/relay release feed. */
async function readClientUpdates(action: 'status' | 'check' | 'activate' | 'preferences', input?: ClientUpdatePreferences): Promise<ClientUpdateSnapshot | null> {
  const bridge = window.openAlice?.clientUpdates
  if (bridge) {
    if (action === 'status') return bridge.status()
    if (action === 'check') return bridge.check()
    if (action === 'preferences') return bridge.savePreferences(input!)
    await bridge.activate()
    return bridge.status()
  }
  if (window.openAlice?.updater) return null
  const suffix = action === 'status' ? '' : `/${action}`
  const response = await fetch(`/relay/v1/updates${suffix}`, {
    method: action === 'status' ? 'GET' : action === 'preferences' ? 'PUT' : 'POST',
    ...(input ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) } : {}),
    cache: 'no-store',
  })
  if (response.status === 404 || response.status === 405 || response.headers?.get('content-type')?.includes('text/html')) return null
  if (!response.ok) throw new Error(`Client update ${action} failed: HTTP ${response.status}`)
  if (action === 'activate') return null
  const value = await response.json() as ClientUpdateSnapshot
  if (!value || !['cli', 'desktop'].includes(value.kind) || typeof value.currentVersion !== 'string'
    || typeof value.preferences?.autoCheck !== 'boolean' || typeof value.discovery?.checking !== 'boolean') {
    throw new Error('Invalid client update status from local host')
  }
  return value
}

async function coordination(action: 'operation' | 'review' | 'approve' | 'resume' | 'abandon', body?: unknown): Promise<unknown> {
  const bridge = window.openAlice?.clientUpdates
  if (bridge?.operation) {
    if (action === 'operation') return bridge.operation()
    if (action === 'abandon') return bridge.abandon()
    if (action === 'resume') return bridge.resume()
    if (action === 'review') return bridge.review(body as Parameters<typeof bridge.review>[0])
    const input = body as { plan: UpdatePlan; fingerprint: string }
    return bridge.approve(input.plan, input.fingerprint)
  }
  const response = await fetch(`/relay/v1/updates/${action}`, { method: action === 'operation' ? 'GET' : 'POST', headers: { 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) })
  if (response.status === 404 || response.headers?.get('content-type')?.includes('text/html')) throw new Error('This host does not support coordinated updates')
  if (!response.ok) { const failure = await response.json().catch(() => null) as { error?: string } | null; throw new Error(failure?.error ?? `Update command failed: HTTP ${response.status}`) }
  return response.json()
}
