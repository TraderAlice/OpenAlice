import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ChildProcess } from 'node:child_process'

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn(), on: vi.fn() } }))
vi.mock('./keyboard-input-source.js', () => ({ readKeyboardInputSourceId: vi.fn() }))

import { cancelOpenAliceWebRequests, fetchAliceWebRequest } from './ipc.js'

afterEach(() => cancelOpenAliceWebRequests('test cleanup'))

describe('Electron Alice IPC during a connection switch', () => {
  it('rejects a request when the child IPC channel closes during send', async () => {
    const child = {
      connected: true,
      send: vi.fn((_message, callback: (error: Error) => void) => {
        callback(new Error('IPC channel closed'))
        return false
      }),
    } as unknown as ChildProcess

    await expect(fetchAliceWebRequest(new Request('app://openalice/api/health'), child))
      .rejects.toThrow('IPC channel closed')
  })

  it('cancels in-flight requests before the local Alice child is retired', async () => {
    const child = {
      connected: true,
      send: vi.fn(() => true),
    } as unknown as ChildProcess
    const request = fetchAliceWebRequest(new Request('app://openalice/api/workspaces'), child)
    const result = expect(request).rejects.toThrow('changing its backend connection')

    cancelOpenAliceWebRequests('The desktop window is changing its backend connection.')
    await result
  })
})
