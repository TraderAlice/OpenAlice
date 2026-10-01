// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { StrictMode } from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { VersionInfo } from '../../../ui/src/api/types'

const mocks = vi.hoisted(() => ({
  projectSetup: null as { setup: { phase: 'complete'; pending: string[]; errors?: Record<string, string> }; error: string | null } | null,
  getVersion: vi.fn(), currentVersion: vi.fn(), checkVersion: vi.fn(),
  workspaces: [] as { id: string; template?: string; upgradeAvailable?: { to: string } }[],
  backendUnavailable: false,
  backendRecoveryGeneration: 0,
  refreshWorkspaces: vi.fn(async () => undefined),
}))
vi.mock('../../../ui/src/hooks/useAgentLaunchConfig', () => ({ useAgentLaunchPreferences: () => ({ loaded: true, recentChatWorkspaceId: 'chat' }) }))
vi.mock('../../../ui/src/hooks/useProjectWorkspaceSetup', async importOriginal => ({ ...await importOriginal<any>(), useSharedProjectWorkspaceSetup: () => mocks.projectSetup }))
vi.mock('../../../ui/src/hooks/useRelayConnection', () => ({ useRelayConnection: () => ({ refresh: async () => undefined }) }))
vi.mock('../../../ui/src/api', () => ({ api: { version: {
  get: mocks.getVersion, current: mocks.currentVersion, check: mocks.checkVersion,
} } }))
vi.mock('../../../ui/src/auth/AuthContext', () => ({
  useBackendRecoverySignal: () => ({ backendUnavailable: mocks.backendUnavailable, backendRecoveryGeneration: mocks.backendRecoveryGeneration }),
}))
vi.mock('../../../ui/src/contexts/workspaces-context', () => ({
  useWorkspaces: () => ({ workspaces: mocks.workspaces, hasLoaded: true, refresh: mocks.refreshWorkspaces, autoQuantDefaultWorkspaceId: 'aq', autoQuantPreferenceLoaded: true, autoPredictionDefaultWorkspaceId: 'ap', autoPredictionPreferenceLoaded: true }),
}))

import { UpdateLifecycleProvider, useUpdateLifecycle } from '../../../ui/src/hooks/useUpdateLifecycle'
import { useWorkspacePlan } from '../../../ui/src/lib/updates/useWorkspacePlan'

const version: VersionInfo = {
  current: '0.94.1-beta', channel: 'beta', updateAuthority: 'cli', latest: '0.95.0-beta', hasUpdate: true,
  releaseUrl: 'https://example.test/release', releaseNotes: null, publishedAt: null, error: null,
}
const preferences = { autoCheckApp: true, autoUpdateAutoQuant: true, autoUpdateAutoPrediction: true }
const wrapper = ({ children }: { children: ReactNode }) => <UpdateLifecycleProvider>{children}</UpdateLifecycleProvider>
const workspacePreview = {
  workspaceId: 'chat', template: 'chat', strategy: 'managed-context' as const,
  fromVersion: '1', toVersion: '3', planDigest: 'shared-plan', source: 'recorded-baseline' as const,
  blocked: false, blockers: [], activity: { busy: false, sessions: [], headless: [] },
  files: [], summary: { ready: 0, preserved: 0, conflicts: 0, unchanged: 0 },
}

beforeEach(() => {
  mocks.workspaces = []
  mocks.projectSetup = null
  mocks.backendUnavailable = false
  mocks.backendRecoveryGeneration = 0
  mocks.getVersion.mockResolvedValue(version)
  mocks.currentVersion.mockResolvedValue({ ...version, latest: null, hasUpdate: false })
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => setTimeout(() => callback(0), 0))
  vi.stubGlobal('cancelAnimationFrame', (handle: number) => clearTimeout(handle))
})
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.unstubAllGlobals() })

it('uses checks for status and only generates a plan when explicitly reviewed', async () => {
  mocks.workspaces = [{ id: 'chat', template: 'chat', upgradeAvailable: { to: '9' } }, { id: 'old-chat', template: 'chat', upgradeAvailable: { to: '9' } }, { id: 'aq', template: 'auto-quant-v2' }]
  let reads = 0
  let current = false
  vi.stubGlobal('fetch', vi.fn(async (path: string) => {
    if (path === '/api/workspaces/chat/template-upgrade') {
      reads++
      return { ok: true, json: async () => ({ plan: workspacePreview }) }
    }
    if (path.includes('/source-upgrade')) throw new Error('Current source must not request a plan')
    return { ok: true, json: async () => ({ preferences, workspaces: [
      { workspaceId: 'chat', template: 'chat', phase: current ? 'current' : 'available', fromVersion: current ? '3' : '1', ...(current ? {} : { toVersion: '3' }) },
      { workspaceId: 'aq', template: 'auto-quant-v2', phase: 'current', fromVersion: '1.0.0' },
    ] }) }
  }))
  const { result } = renderHook(useUpdateLifecycle, { wrapper })
  await waitFor(() => expect(result.current.guidance.workspaceIds).toEqual(['chat']))
  expect(reads).toBe(0)
  const request = { workspaceId: 'chat', kind: 'template' as const, targetVersion: '3' }
  await act(async () => { await result.current.workspacePlans.ensure(request) })
  expect(reads).toBe(1)
  expect(result.current.workspacePlans.peek(request)?.toVersion).toBe('3')
  current = true
  await act(async () => { await result.current.refresh() })
  await waitFor(() => expect(result.current.guidance.workspaceIds).toEqual([]))
  expect(result.current.workspacePlans.peek(request)).toBeNull()
  expect(reads).toBe(1)
  expect(vi.mocked(fetch).mock.calls.some(([path]) => String(path).includes('old-chat') || String(path).includes('/source-upgrade'))).toBe(false)
})

it('does not revive a plan across backend A → B → A or disconnected reads', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ preferences, workspaces: [] }) })))
  const { result, rerender } = renderHook(useUpdateLifecycle, { wrapper })
  const request = { workspaceId: 'chat', kind: 'template' as const }
  const first = result.current.workspacePlans
  await act(async () => { await first.replace(request, workspacePreview) })
  mocks.backendRecoveryGeneration++
  rerender()
  expect(first.isActive()).toBe(false)
  expect(result.current.workspacePlans.peek(request)).toBeNull()
  mocks.backendRecoveryGeneration++
  rerender()
  expect(result.current.workspacePlans).not.toBe(first)
  expect(result.current.workspacePlans.peek(request)).toBeNull()
  mocks.backendUnavailable = true
  rerender()
  await act(async () => { await result.current.workspacePlans.ensure(request) })
  expect(vi.mocked(fetch).mock.calls.some(([path]) => String(path).includes('/workspaces/'))).toBe(false)
})

it('loads a non-candidate review after StrictMode retires the first mount flight', async () => {
  let reads = 0
  vi.stubGlobal('fetch', vi.fn(async (path: string) => {
    if (path === '/api/workspaces/chat/template-upgrade') {
      reads++
      return { ok: true, json: async () => ({ plan: workspacePreview }) }
    }
    return { ok: true, json: async () => ({ preferences, workspaces: [] }) }
  }))
  const strictWrapper = ({ children }: { children: ReactNode }) => <StrictMode><UpdateLifecycleProvider>{children}</UpdateLifecycleProvider></StrictMode>
  const { result } = renderHook(() => useWorkspacePlan({ workspaceId: 'chat', kind: 'template' }), { wrapper: strictWrapper })
  await waitFor(() => expect(result.current.plan?.planDigest).toBe('shared-plan'))
  expect(reads).toBe(1)
})

it('starts after paint, selects distinct app and Workspace updates, and activates the backend', async () => {
  mocks.workspaces = [{ id: 'aq', template: 'auto-quant-v2', upgradeAvailable: { to: 'v1.2.3' } }]
  const fetchMock = vi.fn(async (input: string) => input === '/api/updates/activate'
    ? { ok: true }
    : { ok: true, json: async () => ({ preferences, workspaces: [{ workspaceId: 'aq', template: 'auto-quant-v2', phase: 'blocked', checkedAt: null, toVersion: 'v1.2.3' }] }) })
  vi.stubGlobal('fetch', fetchMock)
  const { result } = renderHook(useUpdateLifecycle, { wrapper })
  expect(result.current.preferences).toBeNull()
  await waitFor(() => expect(result.current.preferences).toEqual(preferences))
  expect(result.current.availableCount).toBe(1)
  expect(result.current.guidance.workspaceIds).toEqual([])
  expect(fetchMock).toHaveBeenCalledWith('/api/updates/activate', { method: 'POST' })
  expect(mocks.getVersion).toHaveBeenCalledOnce()
})

it('keeps backend identity without automatic release discovery when app checks are disabled', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({
    preferences: { ...preferences, autoCheckApp: false }, workspaces: [],
  }) })))
  const { result } = renderHook(useUpdateLifecycle, { wrapper })
  await waitFor(() => expect(result.current.versionInfo?.current).toBe(version.current))
  expect(mocks.currentVersion).toHaveBeenCalledOnce()
  expect(mocks.getVersion).not.toHaveBeenCalled()
  expect(result.current.availableCount).toBe(0)
})

it('clears an already-applied Workspace update from the badge and refreshes its inventory', async () => {
  mocks.workspaces = [{ id: 'aq', template: 'auto-quant-v2', upgradeAvailable: { to: 'v1.2.3' } }]
  mocks.getVersion.mockResolvedValue({ ...version, hasUpdate: false, latest: null })
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({
    preferences, workspaces: [{ workspaceId: 'aq', template: 'auto-quant-v2', phase: 'updated', checkedAt: null, toVersion: 'v1.2.3' }],
  }) })))
  const { result } = renderHook(useUpdateLifecycle, { wrapper })
  await waitFor(() => expect(mocks.refreshWorkspaces).toHaveBeenCalledOnce())
  expect(result.current.availableCount).toBe(0)
})

it('retains independent version discovery when project status fails', async () => {
  vi.stubGlobal('fetch', vi.fn(async (input: string) => input === '/api/updates/activate'
    ? { ok: true }
    : { ok: false, status: 503 }))
  const { result } = renderHook(useUpdateLifecycle, { wrapper })
  await waitFor(() => expect(result.current.error).toContain('HTTP 503'))
  expect(result.current.preferences).toBeNull()
  await waitFor(() => expect(result.current.versionInfo).toEqual(version))
  expect(result.current.availableCount).toBe(1)
})

it('keeps version identity when an older backend serves HTML for the updates API', async () => {
  const fetchMock = vi.fn(async (input: string) => input === '/api/updates/activate'
    ? { ok: true }
    : { ok: true, status: 200, headers: new Headers({ 'content-type': 'text/html; charset=utf-8' }), json: async () => { throw new SyntaxError('HTML is not JSON') } })
  vi.stubGlobal('fetch', fetchMock)
  const { result } = renderHook(useUpdateLifecycle, { wrapper })
  await waitFor(() => expect(result.current.versionInfo?.current).toBe(version.current))
  expect(result.current.updatesUnsupported).toBe(true)
  expect(result.current.error).toBeNull()
  expect(result.current.versionError).toBeNull()
  expect(result.current.preferences).toBeNull()
  await result.current.refresh()
  expect(fetchMock).not.toHaveBeenCalledWith('/api/updates/check', { method: 'POST' })
  expect(mocks.checkVersion).toHaveBeenCalledOnce()
})

it('drops the previous backend identity while disconnected and loads the recovered backend', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ preferences, workspaces: [] }) })))
  const { result, rerender } = renderHook(useUpdateLifecycle, { wrapper })
  await waitFor(() => expect(result.current.versionInfo?.current).toBe('0.94.1-beta'))
  mocks.backendUnavailable = true
  rerender()
  await waitFor(() => expect(result.current.versionInfo).toBeNull())
  mocks.getVersion.mockResolvedValue({ ...version, current: '0.95.0-beta' })
  mocks.backendUnavailable = false
  mocks.backendRecoveryGeneration += 1
  rerender()
  await waitFor(() => expect(result.current.versionInfo?.current).toBe('0.95.0-beta'))
})

it('ignores an old backend project response after switching targets', async () => {
  let finish!: (value: unknown) => void
  let reads = 0
  vi.stubGlobal('fetch', vi.fn(async (input: string) => {
    if (input.startsWith('/relay/')) return { ok: true, json: async () => null }
    if (input === '/api/updates/activate') return { ok: true }
    reads++
    if (reads === 1) return new Promise(resolve => { finish = resolve })
    return { ok: true, json: async () => ({ preferences: { ...preferences, autoCheckApp: false }, workspaces: [] }) }
  }))
  const { result, rerender } = renderHook(useUpdateLifecycle, { wrapper })
  await waitFor(() => expect(reads).toBe(1))
  mocks.backendRecoveryGeneration++
  rerender()
  await waitFor(() => expect(result.current.preferences?.autoCheckApp).toBe(false))
  finish({ ok: true, json: async () => ({ preferences, workspaces: [{ workspaceId: 'old', phase: 'updated', toVersion: '9.0.0' }] }) })
  await new Promise(resolve => setTimeout(resolve, 0))
  expect(result.current.preferences?.autoCheckApp).toBe(false)
  expect(result.current.workspaceStates).toEqual([])
  expect(mocks.refreshWorkspaces).not.toHaveBeenCalled()
  expect(mocks.getVersion).not.toHaveBeenCalled()
})

it('preserves known project and version observations when a refresh fails', async () => {
  const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ preferences, workspaces: [] }) }))
  vi.stubGlobal('fetch', fetchMock)
  const { result } = renderHook(useUpdateLifecycle, { wrapper })
  await waitFor(() => expect(result.current.versionInfo).toEqual(version))
  fetchMock.mockRejectedValue(new Error('project offline'))
  mocks.checkVersion.mockRejectedValueOnce(new Error('version offline'))
  await result.current.refresh()
  await waitFor(() => expect(result.current.versionError).toBe('version offline'))
  expect(result.current.versionInfo).toEqual(version)
  expect(result.current.preferences).toEqual(preferences)
  expect(result.current.error).toBe('project offline')
})

it('does not replace a native status event with an older initial snapshot', async () => {
  let finish!: (value: unknown) => void
  let onStatus!: (status: unknown) => void
  const unsubscribe = vi.fn()
  const original = Object.getOwnPropertyDescriptor(window, 'openAlice')
  Object.defineProperty(window, 'openAlice', { configurable: true, value: { updater: {
    getStatus: () => new Promise(resolve => { finish = resolve }),
    onStatus: (listener: typeof onStatus) => { onStatus = listener; return unsubscribe },
  } } })
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ preferences, workspaces: [] }) })))
  try {
    const { result, unmount } = renderHook(useUpdateLifecycle, { wrapper })
    onStatus({ phase: 'downloaded', version: '1.0.0', releaseUrl: 'https://example.test/release' })
    await waitFor(() => expect(result.current.nativeStatus?.phase).toBe('downloaded'))
    finish({ phase: 'available', version: '0.99.0' })
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(result.current.nativeStatus?.phase).toBe('downloaded')
    unmount()
    expect(unsubscribe).toHaveBeenCalledOnce()
  } finally {
    if (original) Object.defineProperty(window, 'openAlice', original)
    else Reflect.deleteProperty(window, 'openAlice')
  }
})

it('two consumers share the native subscription and a single install handoff', async () => {
  let finish!: () => void
  const updater = {
    getStatus: vi.fn(async () => ({ phase: 'downloaded', version: '1.0.0', releaseUrl: 'https://example.test/release' })),
    onStatus: vi.fn(() => () => undefined),
    installAndRestart: vi.fn(() => new Promise<void>(resolve => { finish = resolve })),
  }
  const original = Object.getOwnPropertyDescriptor(window, 'openAlice')
  Object.defineProperty(window, 'openAlice', { configurable: true, value: { updater } })
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ preferences, workspaces: [] }) })))
  try {
    const { result } = renderHook(() => ({ first: useUpdateLifecycle(), second: useUpdateLifecycle() }), { wrapper })
    await waitFor(() => expect(result.current.first.nativeReady?.version).toBe('1.0.0'))
    let pending!: Promise<void>
    act(() => {
      pending = result.current.first.installClient()
      expect(result.current.second.installClient()).toBe(pending)
    })
    await act(async () => { await Promise.resolve() })
    expect(updater.installAndRestart).toHaveBeenCalledOnce()
    expect(updater.onStatus).toHaveBeenCalledOnce()
    await act(async () => { finish(); await pending })
    await act(async () => { await result.current.second.installClient() })
    expect(updater.installAndRestart).toHaveBeenCalledOnce()
    expect(result.current.first.nativeInstalling).toBe(true)
  } finally {
    if (original) Object.defineProperty(window, 'openAlice', original)
    else Reflect.deleteProperty(window, 'openAlice')
  }
})

it('retains local client policy across backend switches and checks while the backend is offline', async () => {
  const snapshot = { kind: 'cli', currentVersion: '0.94.1', preferences: { autoCheck: false },
    discovery: { value: { status: 'available', latestVersion: '0.95.0', currentVersion: '0.94.1', channel: 'stable' }, checking: false, error: null, checkedAt: 1, succeededAt: 1 } }
  const requests = vi.fn(async (input: string) => {
    if (input.startsWith('/relay/v1/updates')) return { ok: true, json: async () => snapshot }
    return { ok: true, json: async () => ({ preferences, workspaces: [] }) }
  })
  vi.stubGlobal('fetch', requests)
  const { result, rerender } = renderHook(useUpdateLifecycle, { wrapper })
  await waitFor(() => expect(result.current.client?.preferences.autoCheck).toBe(false))
  mocks.backendUnavailable = true
  mocks.backendRecoveryGeneration++
  rerender()
  await act(async () => { await result.current.refresh() })
  expect(result.current.client?.preferences.autoCheck).toBe(false)
  expect(result.current.client?.currentVersion).toBe('0.94.1')
  expect(requests).toHaveBeenCalledWith('/relay/v1/updates/check', expect.objectContaining({ method: 'POST' }))
  expect(result.current.versionInfo).toBeNull()
})

it('projects setup recovery independently of update candidates and clears it after recovery', async () => {
  mocks.getVersion.mockResolvedValue({ ...version, hasUpdate: false, latest: null })
  mocks.projectSetup = { setup: { phase: 'complete', pending: ['auto-quant'], errors: { 'auto-quant': 'clone failed' } }, error: null }
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ preferences, workspaces: [] }) })))
  const { result, rerender } = renderHook(useUpdateLifecycle, { wrapper })
  await waitFor(() => expect(result.current.preferences).toEqual(preferences))
  expect(result.current.guidance.setupCount).toBe(1)
  expect(result.current.guidance.availableCount).toBe(0)
  expect(result.current.guidance.needsAttentionCount).toBe(0)
  mocks.projectSetup = { setup: { phase: 'complete', pending: [] }, error: null }
  rerender()
  expect(result.current.guidance.setupCount).toBe(0)
})
