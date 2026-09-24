import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useMachineManagement } from './useMachineManagement'

const relay = vi.hoisted(() => ({ refresh: vi.fn(async () => undefined) }))
vi.mock('./useRelayConnection', () => ({ useRelayConnection: () => ({ refresh: relay.refresh, status: { schemaVersion: 1, target: null }, fleet: [], loading: false, busy: false, error: null }) }))

const preview = {
  id: 'plan-1', mode: 'upgrade', machine: { key: 'cloud', label: 'Cloud', sshTarget: 'alice@example.com' },
  platform: 'Linux x64', installedVersion: '0.93.1', targetVersion: '0.94.1', runtime: 'running',
  actions: ['update remote OpenAlice CLI'], blocker: null, deferredUpdate: false, expiresAt: '2026-09-24T10:00:00Z',
}

describe('useMachineManagement', () => {
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
    const { result } = renderHook(() => useMachineManagement())
    await act(async () => { await result.current.probe({ mode: 'upgrade', machineKey: 'cloud' }) })
    expect(result.current.plan?.id).toBe('plan-1')
    expect(relay.refresh).not.toHaveBeenCalled()
    expect(fetch).toHaveBeenCalledWith('/relay/v1/machines/plan', expect.objectContaining({ method: 'POST' }))
    await act(async () => { await result.current.apply() })
    expect(result.current.plan).toBeNull()
    expect(relay.refresh).toHaveBeenCalledOnce()
    expect(fetch).toHaveBeenCalledWith('/relay/v1/machines/apply', expect.objectContaining({ body: JSON.stringify({ id: 'plan-1' }) }))
  })

  it('exposes a probe error without retaining an older approval', async () => {
    vi.mocked(fetch).mockImplementation(async (path) => path === '/relay/v1/machines/operation'
      ? { ok: true, json: async () => null } as Response
      : { ok: false, status: 502, json: async () => ({ error: 'SSH host is unreachable' }) } as Response)
    const { result } = renderHook(() => useMachineManagement())
    await act(async () => { await expect(result.current.probe({ mode: 'add', label: 'Cloud', sshTarget: 'alice@example.com' })).rejects.toThrow('SSH host is unreachable') })
    expect(result.current.probing).toBe(false)
    expect(result.current.plan).toBeNull()
    expect(result.current.operationError).toBe('SSH host is unreachable')
  })
})
