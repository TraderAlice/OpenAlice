import { describe, it, expect, vi, beforeEach } from 'vitest'
import { FxService } from './fx-service.js'
import type { CurrencyClientLike } from '../market-data/client/types.js'

function makeMockClient(snapshots: Array<{ base_currency: string; counter_currency: string; last_rate: number }> = []): CurrencyClientLike {
  return {
    search: vi.fn().mockResolvedValue([]),
    getHistorical: vi.fn().mockResolvedValue([]),
    getSnapshots: vi.fn().mockResolvedValue(snapshots),
  }
}

describe('FxService', () => {
  let client: CurrencyClientLike

  beforeEach(() => {
    client = makeMockClient([{ base_currency: 'HKD', counter_currency: 'USD', last_rate: 0.1282 }])
  })

  // ==================== USD passthrough ====================

  it('returns rate 1 for USD without calling client', async () => {
    const fx = new FxService(client)
    const rate = await fx.getRate('USD')
    expect(rate.rate).toBe(1)
    expect(rate.source).toBe('live')
    expect(client.getSnapshots).not.toHaveBeenCalled()
  })

  // ==================== Live rate fetch ====================

  it('fetches live rate from currency client', async () => {
    const fx = new FxService(client)
    const rate = await fx.getRate('HKD')
    expect(rate.rate).toBe(0.1282)
    expect(rate.source).toBe('live')
    expect(rate.stale).toBeUndefined()
    expect(client.getSnapshots).toHaveBeenCalledWith({
      base: 'HKD',
      counter_currencies: 'USD',
      provider: 'yfinance',
    })
  })

  // ==================== Cache hit ====================

  it('returns cached rate on second call (no re-fetch)', async () => {
    const fx = new FxService(client)
    await fx.getRate('HKD')
    await fx.getRate('HKD')
    expect(client.getSnapshots).toHaveBeenCalledTimes(1)
  })

  // ==================== Cache expiry → refresh ====================

  it('re-fetches after TTL expires', async () => {
    const fx = new FxService(client, 100) // 100ms TTL
    await fx.getRate('HKD')
    await new Promise(r => setTimeout(r, 150))
    await fx.getRate('HKD')
    expect(client.getSnapshots).toHaveBeenCalledTimes(2)
  })

  // ==================== Stale cache fallback ====================

  it('returns stale cached rate when refresh fails', async () => {
    const fx = new FxService(client, 100)
    // First call succeeds → populates live cache
    const fresh = await fx.getRate('HKD')
    expect(fresh.source).toBe('live')

    // Expire cache, then make client fail
    await new Promise(r => setTimeout(r, 150))
    client.getSnapshots = vi.fn().mockRejectedValue(new Error('network down'))

    const stale = await fx.getRate('HKD')
    expect(stale.rate).toBe(0.1282)
    expect(stale.source).toBe('cached')
    expect(stale.stale).toBe(true)
  })

  // ==================== Default table fallback ====================

  it('falls back to default table when client fails and no cache', async () => {
    const failClient = makeMockClient()
    failClient.getSnapshots = vi.fn().mockRejectedValue(new Error('network timeout'))
    const fx = new FxService(failClient)

    const rate = await fx.getRate('HKD')
    expect(rate.source).toBe('default')
    expect(rate.rate).toBe(0.128)
    expect(rate.updatedAt).toBe('2026-04-08')
  })

  it('falls back to default when snapshot has no matching counter currency', async () => {
    const emptyClient = makeMockClient([])
    const fx = new FxService(emptyClient)

    const rate = await fx.getRate('EUR')
    expect(rate.source).toBe('default')
    expect(rate.rate).toBe(1.08)
  })

  // ==================== No client (offline mode) ====================

  it('works without currencyClient — pure default table', async () => {
    const fx = new FxService() // no client
    const rate = await fx.getRate('GBP')
    expect(rate.rate).toBe(1.27)
    expect(rate.source).toBe('default')
  })

  // ==================== Unknown currency ====================

  it('returns 1:1 for unknown currency with default source', async () => {
    const fx = new FxService()
    const rate = await fx.getRate('XYZ')
    expect(rate.source).toBe('default')
    expect(rate.rate).toBe(1)
  })

  // ==================== Default warn deduplication ====================

  it('warns only once per currency for default rate usage', async () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const fx = new FxService() // no client
    await fx.getRate('HKD')
    await fx.getRate('HKD')
    await fx.getRate('HKD')
    const hkdWarns = spy.mock.calls.filter(c => String(c[0]).includes('HKD'))
    expect(hkdWarns).toHaveLength(1)
    spy.mockRestore()
  })

  // ==================== convertToUsd ====================

  it('converts amount to USD using live rate — no warning', async () => {
    const fx = new FxService(client)
    const result = await fx.convertToUsd('80000', 'HKD')
    expect(Number(result.usd)).toBeCloseTo(80000 * 0.1282, 2)
    expect(result.fxWarning).toBeUndefined()
  })

  it('returns fxWarning only when using default rate', async () => {
    const fx = new FxService() // no client → default table
    const result = await fx.convertToUsd('80000', 'HKD')
    expect(Number(result.usd)).toBeCloseTo(80000 * 0.128, 2)
    expect(result.fxWarning).toMatch(/HKD.*default/)
  })

  it('no fxWarning for stale cached rate', async () => {
    const fx = new FxService(client, 100)
    await fx.getRate('HKD') // populate cache
    await new Promise(r => setTimeout(r, 150))
    client.getSnapshots = vi.fn().mockRejectedValue(new Error('down'))

    const result = await fx.convertToUsd('80000', 'HKD')
    expect(result.fxWarning).toBeUndefined()
  })

  it('returns zero without warning for zero amount', async () => {
    const fx = new FxService(client)
    const result = await fx.convertToUsd('0', 'HKD')
    expect(result.usd).toBe('0')
    expect(result.fxWarning).toBeUndefined()
  })

  // ==================== Case insensitivity ====================

  it('normalizes currency codes to uppercase', async () => {
    const fx = new FxService(client)
    const rate = await fx.getRate('hkd')
    expect(rate.rate).toBe(0.1282)
  })
})
