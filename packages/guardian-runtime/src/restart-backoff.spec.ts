import { describe, expect, it, vi } from 'vitest'
import { RestartBackoff } from './restart-backoff.js'

describe('RestartBackoff', () => {
  it('retries forever with capped backoff and resets after recovery', async () => {
    vi.useFakeTimers()
    try {
      const delays: number[] = []
      let attempts = 0
      const backoff = new RestartBackoff({
        baseDelayMs: 10,
        maxDelayMs: 20,
        jitterRatio: 0,
        onScheduled: (delay) => delays.push(delay),
      })
      const recover = vi.fn(async () => {
        attempts += 1
        return attempts === 3
      })

      backoff.schedule(recover)
      await vi.advanceTimersByTimeAsync(50)

      expect(recover).toHaveBeenCalledTimes(3)
      expect(delays).toEqual([10, 20, 20])

      backoff.schedule(async () => true)
      await vi.advanceTimersByTimeAsync(10)
      expect(delays.at(-1)).toBe(10)
      backoff.stop()
    } finally {
      vi.useRealTimers()
    }
  })

  it('cancels a pending recovery on stop', async () => {
    vi.useFakeTimers()
    try {
      const recover = vi.fn(async () => true)
      const backoff = new RestartBackoff({ baseDelayMs: 10, jitterRatio: 0 })
      backoff.schedule(recover)
      backoff.stop()
      await vi.advanceTimersByTimeAsync(20)
      expect(recover).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })
})
