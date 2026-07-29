import { EventEmitter } from 'node:events'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { createTerminalSession } from './tui-session.mjs'

afterEach(() => {
  vi.useRealTimers()
})

describe('terminal session cleanup', () => {
  it('absorbs a delayed Windows SIGINT after a raw Ctrl+C byte, then removes listeners', async () => {
    vi.useFakeTimers()
    const input = new FakeInput()
    const output = new FakeOutput()
    const signalSource = new EventEmitter()
    const renderer = {
      enter: vi.fn(),
      render: vi.fn(),
      invalidate: vi.fn(),
      close: vi.fn(),
    }
    const session = createTerminalSession({
      input,
      output,
      signalSource,
      renderer,
      platform: 'win32',
      render: () => ['fixture'],
      onInput: (data, controls) => {
        if (data[0] === 0x03) controls.finish('ctrl-c')
      },
    })

    input.emit('data', Buffer.from([0x03]))
    await expect(session.waitForExit()).resolves.toEqual({ reason: 'ctrl-c' })
    expect(input.isRaw).toBe(false)
    expect(renderer.close).toHaveBeenCalledOnce()
    expect(signalSource.listenerCount('SIGINT')).toBe(1)

    expect(() => signalSource.emit('SIGINT')).not.toThrow()
    await vi.advanceTimersByTimeAsync(100)
    expect(signalSource.listenerCount('SIGINT')).toBe(0)
    expect(signalSource.listenerCount('SIGTERM')).toBe(0)
  })
})

class FakeInput extends EventEmitter {
  isTTY = true
  isRaw = false
  readableFlowing = false

  setRawMode(enabled) {
    this.isRaw = enabled
  }

  pause() {}

  resume() {}
}

class FakeOutput extends EventEmitter {
  isTTY = true
  columns = 80
  rows = 24

  write() {
    return true
  }
}
