// @vitest-environment jsdom

import { useEffect } from 'react'
import { act, cleanup, render, renderHook, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { monitorRelayGeneration, useRelayConnection } from './useRelayConnection'

const status = { schemaVersion: 1 as const, generation: 0, target: { machine: 'local', project: '@electron-current' }, switching: false }
const fleet = { machines: [{ key: 'local', displayName: 'This computer', connection: 'local', projects: [], issue: null }] }

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  delete (window as { openAlice?: Window['openAlice'] }).openAlice
})

describe('useRelayConnection transport', () => {
  it('waits for selection completion before reloading and reloads each old renderer once', () => {
    const reload = vi.fn()
    const dispatchEvent = vi.fn()
    vi.stubGlobal('window', { location: { reload }, dispatchEvent })
    const close = vi.fn()
    let events!: { onmessage: ((message: { data: string }) => void) | null }
    vi.stubGlobal('EventSource', class {
      onmessage = null
      close = close
      constructor() { events = this }
    })
    monitorRelayGeneration(status)
    const next = { ...status, generation: 1 }
    events.onmessage?.({ data: JSON.stringify({ ...next, switching: true }) })
    expect(reload).not.toHaveBeenCalled()
    events.onmessage?.({ data: JSON.stringify(next) })
    events.onmessage?.({ data: JSON.stringify(next) })
    expect(reload).toHaveBeenCalledOnce()
    expect(close).toHaveBeenCalledOnce()
    expect(dispatchEvent).not.toHaveBeenCalled()
  })

  it('refreshes the committed Default without letting an older inventory overwrite it', async () => {
    let finish!: (value: typeof fleet) => void
    const pendingFleet = new Promise<typeof fleet>(resolve => { finish = resolve })
    const saved = { target: { machine: 'cloud', project: 'main' }, error: null }
    const bridge = { status: vi.fn().mockResolvedValue({ ...status, switching: true }), fleet: vi.fn(() => pendingFleet),
      startupTarget: vi.fn().mockResolvedValueOnce({ target: null, error: 'Legacy startup choices conflict' }).mockResolvedValue(saved) }
    Object.defineProperty(window, 'openAlice', { value: { desktopConnection: bridge }, configurable: true })
    const { result } = renderHook(() => useRelayConnection(status))
    let refresh!: Promise<void>
    act(() => { refresh = result.current.refresh() })
    await act(async () => { window.dispatchEvent(new CustomEvent('openalice:relay-settled', { detail: status })) })
    expect(result.current.startup).toEqual(saved)
    expect(result.current.status?.switching).toBe(false)
    await act(async () => { finish(fleet); await refresh })
    expect(result.current.startup).toEqual(saved)
    expect(result.current.status?.switching).toBe(false)
  })

  it('does not invalidate a child inventory refresh during provider mounting', async () => {
    const bridge = { status: vi.fn().mockResolvedValue(status), fleet: vi.fn().mockResolvedValue(fleet),
      startupTarget: vi.fn().mockResolvedValue({ target: null, error: null }) }
    Object.defineProperty(window, 'openAlice', { value: { desktopConnection: bridge }, configurable: true })
    function Child({ connection }: { connection: ReturnType<typeof useRelayConnection> }) {
      useEffect(() => { void connection.refresh() }, [connection.refresh])
      return <output>{connection.loading ? 'checking' : connection.fleet.length}</output>
    }
    function Provider() { return <Child connection={useRelayConnection(status)} /> }
    render(<Provider />)
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('1'))
  })
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

  it('ignores a late inventory response after a newer refresh completes', async () => {
    let finish!: (value: { machines: typeof fleet.machines }) => void
    const old = new Promise<{ machines: typeof fleet.machines }>(resolve => { finish = resolve })
    let calls = 0
    const bridge = {
      status: vi.fn().mockResolvedValue(status), startupTarget: vi.fn().mockResolvedValue({ target: null, error: null }),
      fleet: vi.fn(() => ++calls === 1 ? old : Promise.resolve(fleet)),
    }
    Object.defineProperty(window, 'openAlice', { value: { desktopConnection: bridge }, configurable: true })
    const { result } = renderHook(() => useRelayConnection(status))
    let first!: Promise<void>
    act(() => { first = result.current.refresh() })
    await act(async () => { await result.current.refresh() })
    await act(async () => { finish({ machines: [] }); await first })
    expect(result.current.fleet).toEqual(fleet.machines)
    expect(result.current.loading).toBe(false)
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
    const bridge = { status: vi.fn().mockResolvedValue(status), fleet: vi.fn().mockResolvedValue(fleet), startupTarget: vi.fn().mockResolvedValue({ target: null, error: null }), connect: vi.fn().mockResolvedValue(status), returnIntegrated: vi.fn() }
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

  it('retains client control IPC in a separated Electron window without project runtime IPC', async () => {
    const bridge = { status: vi.fn().mockResolvedValue(status), fleet: vi.fn().mockResolvedValue(fleet), startupTarget: vi.fn().mockResolvedValue({ target: { machine: 'cloud', project: 'main' }, error: null }), connect: vi.fn(), returnIntegrated: vi.fn() }
    Object.defineProperty(window, 'openAlice', { value: { desktopConnection: bridge }, configurable: true })
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    const { result } = renderHook(() => useRelayConnection())
    await act(async () => { await result.current.refresh() })
    expect(result.current.fleet).toEqual(fleet.machines)
    expect(result.current.startup?.target).toEqual({ machine: 'cloud', project: 'main' })
    expect(fetch).not.toHaveBeenCalled()
    expect(window.openAlice?.runtime).toBeUndefined()
  })
})
