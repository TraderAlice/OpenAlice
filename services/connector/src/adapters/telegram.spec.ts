import { describe, expect, it } from 'vitest'
import { withTimeout } from './telegram.js'

describe('Telegram startup timeout', () => {
  it('rejects an external startup operation that does not settle in time', async () => {
    await expect(withTimeout(
      () => new Promise<void>(() => undefined),
      10,
      'Telegram API did not become ready within 10 seconds',
    )).rejects.toThrow('Telegram API did not become ready within 10 seconds')
  })

  it('returns a successful startup result before the timeout', async () => {
    await expect(withTimeout(async () => 'ready', 100, 'timed out')).resolves.toBe('ready')
  })
})
