import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ReactNode } from 'react'
import { UpdateLifecycleProvider, useUpdateLifecycle } from './useUpdateLifecycle'
vi.mock('../contexts/workspaces-context', () => ({ useWorkspaces: () => ({ workspaces: [], refresh: relay.refresh }) }))
vi.mock('../auth/AuthContext', () => ({ useBackendRecoverySignal: () => ({ backendUnavailable: true, backendRecoveryGeneration: 0 }) }))
const wrapper = ({ children }: { children: ReactNode }) => <UpdateLifecycleProvider>{children}</UpdateLifecycleProvider>

const relay = vi.hoisted(() => ({ refresh: vi.fn(async () => undefined) }))
vi.mock('./useRelayConnection', () => ({ useRelayConnection: () => ({ refresh: relay.refresh, status: { schemaVersion: 1, target: null }, fleet: [], loading: false, busy: false, error: null }) }))

const preview = {
  id: 'plan-1', mode: 'upgrade', machine: { key: 'cloud', label: 'Cloud', sshTarget: 'alice@example.com' },
  platform: 'Linux x64', installedVersion: '0.93.1', targetVersion: '0.94.1', runtime: 'running',
  actions: ['update remote OpenAlice CLI'], blocker: null, deferredUpdate: false, expiresAt: '2026-09-24T10:00:00Z',
}

describe('shared lifecycle Machine controls', () => {
  beforeEach(() => {
    relay.refresh.mockClear()
    vi.stubGlobal('fetch', vi.fn())
    Object.defineProperty(window, 'openAlice', { value: undefined, configurable: true })
  })

  it('keeps the read-only preview until the explicit apply and refreshes the fleet afterward', async () => {
    vi.mocked(fetch).mockImplementation(async (path) => {
      if (path === '/relay/v1/machines/operation') return { ok: true, json: async () => null } as Response
      if (path === '/relay/v1/machines/plan') return { ok: true, json: async () => preview } as Response
      return { ok: true, json: async () => ({ machineKey: 'cloud' }) } as Response
    })
    const { result } = renderHook(() => useUpdateLifecycle().machines, { wrapper })
    await act(async () => { await result.current.probe({ mode: 'upgrade', machineKey: 'cloud' }) })
    expect(result.current.plan?.id).toBe('plan-1')
    expect(relay.refresh).not.toHaveBeenCalled()
    expect(fetch).toHaveBeenCalledWith('/relay/v1/machines/plan', expect.objectContaining({ method: 'POST' }))
    await act(async () => { await result.current.apply() })
    expect(result.current.plan).toBeNull()
    expect(relay.refresh).toHaveBeenCalledOnce()
    expect(fetch).toHaveBeenCalledWith('/relay/v1/machines/apply', expect.objectContaining({ body: JSON.stringify({ id: 'plan-1' }) }))
  })

  it('shares one approved mutation between two mounted consumers', async () => {
    let finish!: () => void
    const pending = new Promise<void>((resolve) => { finish = resolve })
    vi.mocked(fetch).mockImplementation(async (path) => {
      if (path === '/relay/v1/machines/operation') return { ok: true, json: async () => null } as Response
      if (path === '/relay/v1/machines/plan') return { ok: true, json: async () => preview } as Response
      await pending
      return { ok: true, json: async () => ({ machineKey: 'cloud' }) } as Response
    })
    const { result } = renderHook(() => [useUpdateLifecycle().machines, useUpdateLifecycle().machines], { wrapper })
    await act(async () => { await result.current[0].probe({ mode: 'upgrade', machineKey: 'cloud' }) })
    let first!: Promise<{ machineKey: string }>
    await act(async () => {
      first = result.current[0].apply()
      expect(result.current[1].apply()).toBe(first)
      await expect(result.current[1].probe({ mode: 'upgrade', machineKey: 'other' })).rejects.toThrow('Wait')
    })
    expect(vi.mocked(fetch).mock.calls.filter(([url]) => url === '/relay/v1/machines/apply')).toHaveLength(1)
    await act(async () => { finish(); await first })
    expect(result.current[1].plan).toBeNull()
  })

  it('does not restore a dismissed plan when its probe finishes late', async () => {
    let finish!: (value: Response) => void
    const pending = new Promise<Response>((resolve) => { finish = resolve })
    vi.mocked(fetch).mockImplementation(async (path) => path === '/relay/v1/machines/operation'
      ? { ok: true, json: async () => null } as Response : pending)
    const { result } = renderHook(() => useUpdateLifecycle().machines, { wrapper })
    let probe!: Promise<unknown>
    act(() => { probe = result.current.probe({ mode: 'upgrade', machineKey: 'cloud' }) })
    act(() => { result.current.clearPlan() })
    await act(async () => {
      finish({ ok: true, json: async () => preview } as Response)
      await expect(probe).rejects.toThrow('superseded')
    })
    expect(result.current.plan).toBeNull()
    expect(result.current.probing).toBe(false)
    expect(result.current.operationError).toBeNull()
  })

  it('requires a fresh reviewed plan after an application fails', async () => {
    vi.mocked(fetch).mockImplementation(async path => {
      if (path === '/relay/v1/machines/operation') return { ok: true, json: async () => null } as Response
      if (path === '/relay/v1/machines/plan') return { ok: true, json: async () => preview } as Response
      return { ok: false, status: 502, json: async () => ({ error: 'Remote connection dropped' }) } as Response
    })
    const { result } = renderHook(() => useUpdateLifecycle().machines, { wrapper })
    await act(async () => { await result.current.probe({ mode: 'upgrade', machineKey: 'cloud' }) })
    await act(async () => { await expect(result.current.apply()).rejects.toThrow('dropped') })
    expect(result.current.plan).toBeNull()
    expect(result.current.operationError).toContain('dropped')
    await expect(result.current.apply()).rejects.toThrow('reviewed')
    expect(vi.mocked(fetch).mock.calls.filter(([path]) => path === '/relay/v1/machines/apply')).toHaveLength(1)
  })

  it('exposes a probe error without retaining an older approval', async () => {
    vi.mocked(fetch).mockImplementation(async (path) => path === '/relay/v1/machines/operation'
      ? { ok: true, json: async () => null } as Response
      : { ok: false, status: 502, json: async () => ({ error: 'SSH host is unreachable' }) } as Response)
    const { result } = renderHook(() => useUpdateLifecycle().machines, { wrapper })
    await act(async () => { await expect(result.current.probe({ mode: 'add', label: 'Cloud', sshTarget: 'alice@example.com' })).rejects.toThrow('SSH host is unreachable') })
    expect(result.current.probing).toBe(false)
    expect(result.current.plan).toBeNull()
    expect(result.current.operationError).toBe('SSH host is unreachable')
  })

  it('joins concurrent reviews and reuses the same plan until an explicit refresh', async () => {
    let finish!: (value: Response) => void
    const pending = new Promise<Response>(resolve => { finish = resolve })
    vi.mocked(fetch).mockImplementation(async path => path === '/relay/v1/machines/operation'
      ? { ok: true, json: async () => null } as Response : pending)
    const { result } = renderHook(() => useUpdateLifecycle().machines, { wrapper })
    let first!: Promise<unknown>
    const input = { mode: 'upgrade' as const, machineKey: 'cloud', projectKey: 'desk' }
    act(() => {
      first = result.current.probe(input)
      expect(result.current.probe(input, { force: true })).toBe(first)
    })
    await act(async () => { finish({ ok: true, json: async () => preview } as Response); await first })
    await act(async () => { expect(await result.current.probe(input)).toBe(preview) })
    expect(vi.mocked(fetch).mock.calls.filter(([path]) => path === '/relay/v1/machines/plan')).toHaveLength(1)
    await act(async () => { await result.current.probe(input, { force: true }) })
    expect(vi.mocked(fetch).mock.calls.filter(([path]) => path === '/relay/v1/machines/plan')).toHaveLength(2)
  })

  it('retains failed-refresh evidence but blocks approval until a successful fresh review', async () => {
    let fail = false
    vi.mocked(fetch).mockImplementation(async path => path === '/relay/v1/machines/operation'
      ? { ok: true, json: async () => null } as Response
      : fail ? { ok: false, status: 502, json: async () => ({ error: 'probe offline' }) } as Response
        : { ok: true, json: async () => preview } as Response)
    const { result } = renderHook(() => useUpdateLifecycle().machines, { wrapper })
    const input = { mode: 'upgrade' as const, machineKey: 'cloud' }
    await act(async () => { await result.current.probe(input) })
    fail = true
    await act(async () => { await expect(result.current.probe(input, { force: true })).rejects.toThrow('offline') })
    expect(result.current.plan).toBe(preview)
    expect(result.current.operationError).toBe('probe offline')
    await expect(result.current.apply()).rejects.toThrow('reviewed')
    await act(async () => { await result.current.probe(input) })
    expect(result.current.operationError).toBe('probe offline')
    expect(vi.mocked(fetch).mock.calls.filter(([path]) => path === '/relay/v1/machines/plan')).toHaveLength(2)
    fail = false
    await act(async () => { await result.current.probe(input, { force: true }) })
    expect(result.current.operationError).toBeNull()
  })

  it('does not reuse a plan for another project on the same machine', async () => {
    vi.mocked(fetch).mockImplementation(async path => path === '/relay/v1/machines/operation'
      ? { ok: true, json: async () => null } as Response : { ok: true, json: async () => preview } as Response)
    const { result } = renderHook(() => useUpdateLifecycle().machines, { wrapper })
    await act(async () => { await result.current.probe({ mode: 'upgrade', machineKey: 'cloud', projectKey: 'one' }) })
    await act(async () => { await result.current.probe({ mode: 'upgrade', machineKey: 'cloud', projectKey: 'two' }) })
    expect(vi.mocked(fetch).mock.calls.filter(([path]) => path === '/relay/v1/machines/plan')).toHaveLength(2)
  })

  it('blocks an approval synchronously when a refresh starts before React commits', async () => {
    vi.mocked(fetch).mockImplementation(async path => path === '/relay/v1/machines/operation'
      ? { ok: true, json: async () => null } as Response : { ok: true, json: async () => preview } as Response)
    const { result } = renderHook(() => useUpdateLifecycle().machines, { wrapper })
    const input = { mode: 'upgrade' as const, machineKey: 'cloud' }
    await act(async () => { await result.current.probe(input) })
    const previousApply = result.current.apply
    await act(async () => {
      const refresh = result.current.probe(input, { force: true })
      await expect(previousApply()).rejects.toThrow('reviewed')
      await refresh
    })
    expect(vi.mocked(fetch).mock.calls.some(([path]) => path === '/relay/v1/machines/apply')).toBe(false)
  })

  it('recovers failed operation-status discovery through an explicit fresh review', async () => {
    let offline = true
    vi.mocked(fetch).mockImplementation(async path => path === '/relay/v1/machines/operation'
      ? offline ? { ok: false, status: 503 } as Response : { ok: true, json: async () => null } as Response
      : { ok: true, json: async () => preview } as Response)
    const { result } = renderHook(() => useUpdateLifecycle().machines, { wrapper })
    await waitFor(() => expect(result.current.operationError).toContain('503'))
    offline = false
    await act(async () => { await result.current.probe({ mode: 'upgrade', machineKey: 'cloud' }, { force: true }) })
    await waitFor(() => expect(result.current.operationError).toBeNull())
    expect(result.current.plan).toBe(preview)
  })
})
