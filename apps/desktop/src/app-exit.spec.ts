import { describe, expect, it, vi } from 'vitest'

import { exitDesktopProcess } from './app-exit.js'

describe('exitDesktopProcess', () => {
  it('requests Electron exit and arms an unrefed hard-exit fallback', () => {
    const appExit = vi.fn()
    const processExit = vi.fn(() => undefined as never)
    const unref = vi.fn()
    let fallback: (() => void) | undefined
    const schedule = vi.fn((callback: () => void, delayMs: number) => {
      fallback = callback
      expect(delayMs).toBe(250)
      return { unref }
    })

    exitDesktopProcess(7, { appExit, processExit, fallbackMs: 250, schedule })

    expect(appExit).toHaveBeenCalledWith(7)
    expect(unref).toHaveBeenCalledOnce()
    expect(processExit).not.toHaveBeenCalled()

    fallback?.()
    expect(processExit).toHaveBeenCalledWith(7)
  })
})
