import { describe, expect, it } from 'vitest'
import { withStartupDeadline } from './startup.js'

describe('withStartupDeadline', () => {
  it('preserves an immediate SDK failure', async () => {
    const failure = new Error('invalid credential')
    await expect(withStartupDeadline('Telegram', 50, async () => { throw failure }))
      .rejects.toBe(failure)
  })

  it('bounds an SDK promise even when it ignores AbortSignal', async () => {
    await expect(withStartupDeadline('Telegram', 5, async () => new Promise(() => undefined)))
      .rejects.toThrow('Telegram startup timed out after 1 seconds')
  })
})
