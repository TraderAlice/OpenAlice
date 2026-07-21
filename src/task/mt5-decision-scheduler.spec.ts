import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createJmbMt5DecisionScheduler } from './mt5-decision-scheduler.js'

describe('JMB MT5 decision scheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.clearAllTimers()
    vi.useRealTimers()
  })

  it('runs one catch-up cycle before arming the five-minute pump', async () => {
    const runCycle = vi.fn(async () => [])
    const scheduler = createJmbMt5DecisionScheduler({ runCycle })

    await scheduler.start()

    expect(runCycle).toHaveBeenCalledTimes(1)
    scheduler.stop()
  })

  it('does not overlap a slow cycle', async () => {
    let release!: () => void
    const slowCycle = new Promise<void>((resolve) => { release = resolve })
    const runCycle = vi.fn()
      .mockResolvedValueOnce([])
      .mockImplementation(() => slowCycle)
    const scheduler = createJmbMt5DecisionScheduler({ runCycle, every: '5m' })

    await scheduler.start()
    await vi.advanceTimersByTimeAsync(15 * 60_000)

    expect(runCycle).toHaveBeenCalledTimes(2)

    release()
    await slowCycle
    await vi.advanceTimersByTimeAsync(0)
    scheduler.stop()
    expect(vi.getTimerCount()).toBe(0)
  })
})
