import { describe, expect, it, vi } from 'vitest'

import { createPrefetchScheduler } from './prefetch-scheduler'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('createPrefetchScheduler', () => {
  it('caps concurrent low-priority tasks and drains queued work in order', async () => {
    const scheduler = createPrefetchScheduler({ maxConcurrent: 2, isHidden: () => false })
    const started: string[] = []
    const d1 = deferred<string>()
    const d2 = deferred<string>()
    const d3 = deferred<string>()

    const p1 = scheduler.schedule('k1', () => { started.push('k1'); return d1.promise }, 'low')
    const p2 = scheduler.schedule('k2', () => { started.push('k2'); return d2.promise }, 'low')
    const p3 = scheduler.schedule('k3', () => { started.push('k3'); return d3.promise }, 'low')

    await vi.waitFor(() => expect(started).toEqual(['k1', 'k2']))
    expect(scheduler.stats()).toEqual({ activeHigh: 0, activeLow: 2, queuedLow: 1 })

    d1.resolve('v1')
    expect(await p1).toBe('v1')
    await vi.waitFor(() => expect(started).toEqual(['k1', 'k2', 'k3']))

    d2.resolve('v2')
    d3.resolve('v3')
    expect(await Promise.all([p2, p3])).toEqual(['v2', 'v3'])
    scheduler.dispose()
  })

  it('preempts queued low tasks when a high-priority task is active and promotes matching keys', async () => {
    const scheduler = createPrefetchScheduler({ maxConcurrent: 1, isHidden: () => false })
    const events: string[] = []
    const highGate = deferred<string>()
    const lowGate = deferred<string>()

    const pHigh = scheduler.schedule('user-click', () => {
      events.push('high')
      return highGate.promise
    }, 'high')

    const pLow = scheduler.schedule('bg-1', () => {
      events.push('bg-1')
      return lowGate.promise
    }, 'low')

    const pPromotedLow = scheduler.schedule('bg-promote', () => {
      events.push('bg-promote:low')
      return Promise.resolve('from-low')
    }, 'low')

    // Promote queued `bg-promote` to high while another high task is running.
    const pPromotedHigh = scheduler.schedule('bg-promote', () => {
      events.push('bg-promote:high')
      return Promise.resolve('from-high')
    }, 'high')

    expect(pPromotedHigh).toBe(pPromotedLow)
    expect(await pPromotedHigh).toBe('from-high')
    // bg-1 must still wait until pHigh settles.
    expect(events).toEqual(['high', 'bg-promote:high'])

    highGate.resolve('clicked')
    expect(await pHigh).toBe('clicked')
    await vi.waitFor(() => expect(events).toContain('bg-1'))
    lowGate.resolve('bg-done')
    expect(await pLow).toBe('bg-done')
    scheduler.dispose()
  })

  it('pauses low-priority tasks while hidden and runs them once visible again', async () => {
    let hidden = true
    const scheduler = createPrefetchScheduler({ maxConcurrent: 2, isHidden: () => hidden })
    const run = vi.fn(async () => 'ok')

    const p = scheduler.schedule('hidden-task', run, 'low')
    await new Promise((r) => setTimeout(r, 20))
    expect(run).not.toHaveBeenCalled()

    hidden = false
    if (typeof document !== 'undefined') {
      document.dispatchEvent(new Event('visibilitychange'))
    } else {
      // Node-only fallback: scheduling another task triggers drain.
      void scheduler.schedule('nudge', async () => 'nudge', 'low')
    }

    expect(await p).toBe('ok')
    expect(run).toHaveBeenCalledTimes(1)
    scheduler.dispose()
  })
})
