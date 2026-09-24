// @vitest-environment jsdom

import { cleanup, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { VersionInfo } from '../api/types'

const mocks = vi.hoisted(() => ({
  getVersion: vi.fn(), currentVersion: vi.fn(), checkVersion: vi.fn(),
  workspaces: [] as { id: string; upgradeAvailable?: { to: string } }[],
  backendUnavailable: false,
  backendRecoveryGeneration: 0,
  refreshWorkspaces: vi.fn(async () => undefined),
}))
vi.mock('../api', () => ({ api: { version: {
  get: mocks.getVersion, current: mocks.currentVersion, check: mocks.checkVersion,
} } }))
vi.mock('../auth/AuthContext', () => ({
  useBackendRecoverySignal: () => ({ backendUnavailable: mocks.backendUnavailable, backendRecoveryGeneration: mocks.backendRecoveryGeneration }),
}))
vi.mock('../contexts/workspaces-context', () => ({
  useWorkspaces: () => ({ workspaces: mocks.workspaces, refresh: mocks.refreshWorkspaces }),
}))

import { UpdateLifecycleProvider, useUpdateLifecycle } from './useUpdateLifecycle'

const version: VersionInfo = {
  current: '0.94.1-beta', channel: 'beta', updateAuthority: 'cli', latest: '0.95.0-beta', hasUpdate: true,
  releaseUrl: 'https://example.test/release', releaseNotes: null, publishedAt: null, error: null,
}
const preferences = { autoCheckApp: true, autoUpdateAutoQuant: true, autoUpdateAutoPrediction: true }
const wrapper = ({ children }: { children: ReactNode }) => <UpdateLifecycleProvider>{children}</UpdateLifecycleProvider>

beforeEach(() => {
  mocks.workspaces = []
  mocks.backendUnavailable = false
  mocks.backendRecoveryGeneration = 0
  mocks.getVersion.mockResolvedValue(version)
  mocks.currentVersion.mockResolvedValue({ ...version, latest: null, hasUpdate: false })
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => setTimeout(() => callback(0), 0))
  vi.stubGlobal('cancelAnimationFrame', (handle: number) => clearTimeout(handle))
})
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.unstubAllGlobals() })

it('starts after paint, selects distinct app and Workspace updates, and activates the backend', async () => {
  mocks.workspaces = [{ id: 'aq', upgradeAvailable: { to: 'v1.2.3' } }]
  const fetchMock = vi.fn(async (input: string) => input === '/api/updates/activate'
    ? { ok: true }
    : { ok: true, json: async () => ({ preferences, workspaces: [{ workspaceId: 'aq', template: 'auto-quant-v2', phase: 'blocked', checkedAt: null, toVersion: 'v1.2.3' }] }) })
  vi.stubGlobal('fetch', fetchMock)
  const { result } = renderHook(useUpdateLifecycle, { wrapper })
  expect(result.current.preferences).toBeNull()
  await waitFor(() => expect(result.current.availableCount).toBeGreaterThanOrEqual(2))
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
  mocks.workspaces = [{ id: 'aq', upgradeAvailable: { to: 'v1.2.3' } }]
  mocks.getVersion.mockResolvedValue({ ...version, hasUpdate: false, latest: null })
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({
    preferences, workspaces: [{ workspaceId: 'aq', template: 'auto-quant-v2', phase: 'updated', checkedAt: null, toVersion: 'v1.2.3' }],
  }) })))
  const { result } = renderHook(useUpdateLifecycle, { wrapper })
  await waitFor(() => expect(mocks.refreshWorkspaces).toHaveBeenCalledOnce())
  expect(result.current.availableCount).toBe(0)
})

it('exposes status loading failures without inventing an update', async () => {
  vi.stubGlobal('fetch', vi.fn(async (input: string) => input === '/api/updates/activate'
    ? { ok: true }
    : { ok: false, status: 503 }))
  const { result } = renderHook(useUpdateLifecycle, { wrapper })
  await waitFor(() => expect(result.current.error).toContain('HTTP 503'))
  expect(result.current.preferences).toBeNull()
  expect(result.current.availableCount).toBe(0)
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
