import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ChildProcess } from 'node:child_process'

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn(), on: vi.fn() } }))
vi.mock('./keyboard-input-source.js', () => ({ readKeyboardInputSourceId: vi.fn() }))

import { cancelOpenAliceWebRequests, closeOpenAliceWebSource, fetchAliceWebRequest, handleOpenAliceIpcMessage } from './ipc.js'

function source() {
  const send = vi.fn((_message: unknown, _callback: (error: Error | null) => void) => true)
  return { child: { connected: true, send } as unknown as ChildProcess, send }
}

afterEach(() => {
  cancelOpenAliceWebRequests('test cleanup')
  vi.useRealTimers()
})

describe('Alice web IPC request lifecycle', () => {
  it('retires one source before kill, tolerating late replies and send failures', async () => {
    vi.useFakeTimers()
    const a = source()
    const b = source()
    const retiring = fetchAliceWebRequest(new Request('app://openalice/api/a'), a.child)
    const active = fetchAliceWebRequest(new Request('app://openalice/api/b'), b.child)
    closeOpenAliceWebSource(a.child)
    closeOpenAliceWebSource(a.child)
    a.send.mock.calls[0][1](new Error('write EPIPE'))
    const aId = (a.send.mock.calls[0][0] as { id: string }).id
    handleOpenAliceIpcMessage({ type: 'openalice:web:response', id: aId, status: 200 })
    expect((await retiring).status).toBe(503)
    expect((await fetchAliceWebRequest(new Request('app://openalice/late'), a.child)).status).toBe(503)
    expect(a.send).toHaveBeenCalledTimes(1)
    const bId = (b.send.mock.calls[0][0] as { id: string }).id
    handleOpenAliceIpcMessage({ type: 'openalice:web:response', id: bId, status: 200, body: 'ok' })
    expect(await (await active).text()).toBe('ok')
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each(['retire', 'abort'] as const)('cancels during body reading without later dispatch: %s', async action => {
    const { child, send } = source()
    const controller = new AbortController()
    const request = new Request('app://openalice/api/write', { method: 'POST', body: 'input', signal: controller.signal })
    let finish!: (value: ArrayBuffer) => void
    vi.spyOn(request, 'arrayBuffer').mockReturnValue(new Promise(resolve => { finish = resolve }))
    const response = fetchAliceWebRequest(request, child)
    if (action === 'retire') closeOpenAliceWebSource(child)
    else controller.abort()
    expect((await response).status).toBe(503)
    finish(new ArrayBuffer(0))
    await Promise.resolve()
    expect(send).not.toHaveBeenCalled()
  })

  it('cancels an in-flight request and detaches its abort listener', async () => {
    vi.useFakeTimers()
    const { child, send } = source()
    const controller = new AbortController()
    const request = new Request('app://openalice/api/read', { signal: controller.signal })
    const remove = vi.spyOn(request.signal, 'removeEventListener')
    const response = fetchAliceWebRequest(request, child)
    controller.abort()
    expect((await response).status).toBe(503)
    send.mock.calls[0][1](new Error('write EPIPE'))
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function))
    expect(vi.getTimerCount()).toBe(0)
    expect((await fetchAliceWebRequest(request, child)).status).toBe(503)
    expect(send).toHaveBeenCalledTimes(1)
  })

  it.each(['callback', 'throw'] as const)('preserves unexpected send failures: %s', async mode => {
    const { child, send } = source()
    const error = new Error('write EPIPE')
    send.mockImplementation((_message, callback) => {
      if (mode === 'throw') throw error
      callback(error)
      return false
    })
    await expect(fetchAliceWebRequest(new Request('app://openalice/api/read'), child)).rejects.toBe(error)
  })

  it('preserves timeouts for a live source', async () => {
    vi.useFakeTimers()
    const { child } = source()
    const response = fetchAliceWebRequest(new Request('app://openalice/api/read'), child, 10)
    const assertion = expect(response).rejects.toThrow('Alice IPC request timed out')
    await vi.advanceTimersByTimeAsync(10)
    await assertion
    expect(vi.getTimerCount()).toBe(0)
  })
})
