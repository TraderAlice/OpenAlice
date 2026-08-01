import { EventEmitter } from 'node:events'
import type { ChildProcess } from 'node:child_process'

import { describe, expect, it } from 'vitest'

import { childIsRunning, stopChild } from './child-shutdown.js'

class FakeChild extends EventEmitter {
  exitCode: number | null = null
  signalCode: NodeJS.Signals | null = null
  killed = false

  finish(signal: NodeJS.Signals): void {
    this.signalCode = signal
    this.emit('exit', null, signal)
  }
}

describe('desktop child shutdown', () => {
  it('treats a signalled-but-still-alive child as running', () => {
    const child = new FakeChild()
    child.killed = true

    expect(childIsRunning(child as unknown as ChildProcess)).toBe(true)
  })

  it('does not force a child that exits during the SIGTERM grace period', async () => {
    const child = new FakeChild()
    const signals: NodeJS.Signals[] = []

    await stopChild(child as unknown as ChildProcess, {
      graceMs: 20,
      sendSignal: (signal) => {
        signals.push(signal)
        queueMicrotask(() => child.finish(signal))
      },
    })

    expect(signals).toEqual(['SIGTERM'])
  })

  it('forces a child that accepted SIGTERM but did not exit', async () => {
    const child = new FakeChild()
    const signals: NodeJS.Signals[] = []
    let forced = false

    await stopChild(child as unknown as ChildProcess, {
      graceMs: 1,
      sendSignal: (signal) => {
        signals.push(signal)
        child.killed = true
        if (signal === 'SIGKILL') queueMicrotask(() => child.finish(signal))
      },
      onForce: () => { forced = true },
    })

    expect(signals).toEqual(['SIGTERM', 'SIGKILL'])
    expect(forced).toBe(true)
  })
})
