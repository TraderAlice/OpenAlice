// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { useRelayConnection } from './useRelayConnection'

const status = { schemaVersion: 1 as const, generation: 0, target: { machine: 'local', project: '@electron-current' }, switching: false }
const fleet = { machines: [{ key: 'local', displayName: 'This computer', connection: 'local', projects: [], issue: null }] }

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  delete (window as { openAlice?: Window['openAlice'] }).openAlice
})

describe('useRelayConnection transport', () => {
  it('loads the selected target and inventory together', async () => {
    const fetchMock = vi.fn(async (url: string) => new Response(JSON.stringify(url.endsWith('/status')
      ? { schemaVersion: 1, generation: 3, target: { machine: 'local', project: 'default' }, switching: false }
      : { schemaVersion: 1, machines: [{ key: 'local', displayName: 'This computer', projects: [], connection: 'local', issue: null }] }), { status: 200, headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)
    const { result } = renderHook(() => useRelayConnection())
    await act(async () => { await result.current.refresh() })
    await waitFor(() => expect(result.current.status?.generation).toBe(3))
    expect(result.current.fleet.map((machine) => machine.key)).toEqual(['local'])
    expect(result.current.loading).toBe(false)
    expect(result.current.error).toBeNull()
  })

  it('reports inventory failures while keeping the last confirmed target', async () => {
    const fetchMock = vi.fn(async (url: string) => url.endsWith('/status')
      ? new Response(JSON.stringify({ schemaVersion: 1, generation: 1, target: { machine: 'local', project: 'default' }, switching: false }), { status: 200 })
      : new Response(JSON.stringify({ error: 'SSH discovery unavailable' }), { status: 502 }))
    vi.stubGlobal('fetch', fetchMock)
    const { result } = renderHook(() => useRelayConnection())
    await waitFor(() => expect(result.current.status?.generation).toBe(1))
    await act(async () => { await result.current.refresh() })
    expect(result.current.status?.target?.project).toBe('default')
    expect(result.current.fleet).toEqual([])
    expect(result.current.error).toBe('SSH discovery unavailable')
  })

  it('uses Electron controls while integrated, without issuing relay HTTP requests', async () => {
    const bridge = { status: vi.fn().mockResolvedValue(status), fleet: vi.fn().mockResolvedValue(fleet), connect: vi.fn().mockResolvedValue(status), returnIntegrated: vi.fn() }
    Object.defineProperty(window, 'openAlice', { value: { runtime: { info: vi.fn() }, desktopConnection: bridge }, configurable: true })
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    const { result } = renderHook(() => useRelayConnection())

    await act(async () => { await result.current.refresh() })
    expect(result.current.fleet).toEqual(fleet.machines)
    await act(async () => { await result.current.connect('railway-linux', 'main-cloud') })
    expect(bridge.connect).toHaveBeenCalledWith('railway-linux', 'main-cloud')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('uses relay HTTP in a separated Electron window', async () => {
    const bridge = { status: vi.fn(), fleet: vi.fn(), connect: vi.fn(), returnIntegrated: vi.fn() }
    Object.defineProperty(window, 'openAlice', { value: { desktopConnection: bridge }, configurable: true })
    const fetch = vi.fn().mockImplementation(async (path: string) => ({
      ok: true,
      json: async () => path.endsWith('/status') ? status : fleet,
    }))
    vi.stubGlobal('fetch', fetch)
    const { result } = renderHook(() => useRelayConnection())

    await act(async () => { await result.current.refresh() })
    await waitFor(() => expect(result.current.fleet).toEqual(fleet.machines))
    expect(fetch).toHaveBeenCalledWith('/relay/v1/fleet', expect.objectContaining({ cache: 'no-store' }))
    expect(bridge.fleet).not.toHaveBeenCalled()
  })
})
