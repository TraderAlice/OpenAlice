/**
 * UTAManagerSDK.resolve tier filtering (issue #390).
 *
 * `tradingOnly` drops keyless 'data'-tier sources (binance-readonly etc.) from
 * the no-source aggregate so a region-blocked public-data account can't blank
 * a user's portfolio. An explicit source still resolves a data-tier account.
 */
import { describe, it, expect } from 'vitest'
import { UTAManagerSDK } from './UTAManagerSDK.js'
import type { UTATier, UTASummary } from '@traderalice/uta-protocol'

const summary = (id: string, tier: UTATier, over: Partial<UTASummary> = {}): UTASummary => ({
  id,
  label: id,
  asVendor: true,
  capabilities: { supportedSecTypes: [], supportedOrderTypes: [] },
  health: { status: 'healthy', reach: 'connected', tier, consecutiveFailures: 0, recovering: false, connecting: false, disabled: false },
  ...over,
})

function fakeClient(utas: unknown[]) {
  return {
    get: async (path: string) => {
      if (path === '/api/trading/uta') return { utas }
      throw new Error(`unexpected GET ${path}`)
    },
  } as never
}

const UTAS = [
  summary('alpaca-paper', 'trading'),
  summary('ibkr', 'account'),
  summary('binance-readonly', 'data'),
  summary('okx-readonly', 'data'),
]

describe('UTAManagerSDK.resolve — tier filter (#390)', () => {
  it('includes every account by default (back-compat, no opts)', async () => {
    const m = new UTAManagerSDK({ client: fakeClient(UTAS) })
    const ids = (await m.resolve()).map((u) => u.id).sort()
    expect(ids).toEqual(['alpaca-paper', 'binance-readonly', 'ibkr', 'okx-readonly'])
  })

  it('drops data-tier sources when tradingOnly + no source', async () => {
    const m = new UTAManagerSDK({ client: fakeClient(UTAS) })
    const ids = (await m.resolve(undefined, { tradingOnly: true })).map((u) => u.id).sort()
    expect(ids).toEqual(['alpaca-paper', 'ibkr'])
  })

  it('still resolves an explicit data-tier source even with tradingOnly', async () => {
    const m = new UTAManagerSDK({ client: fakeClient(UTAS) })
    const ids = (await m.resolve('binance-readonly', { tradingOnly: true })).map((u) => u.id)
    expect(ids).toEqual(['binance-readonly'])
  })

  it('does not filter on an explicit source even when it matches a prefix', async () => {
    const m = new UTAManagerSDK({ client: fakeClient(UTAS) })
    const ids = (await m.resolve('alpaca', { tradingOnly: true })).map((u) => u.id)
    expect(ids).toEqual(['alpaca-paper'])
  })
})

describe('UTAManagerSDK — data-source participation', () => {
  it('excludes disabled UTA vendors from bar capability discovery', async () => {
    const m = new UTAManagerSDK({
      client: fakeClient([
        summary('alpaca-paper', 'trading', {
          capabilities: { supportedSecTypes: [], supportedOrderTypes: [], historicalBars: { supported: true, quality: 'iex' } },
        }),
        summary('bybit-paper', 'trading', {
          asVendor: false,
          capabilities: { supportedSecTypes: [], supportedOrderTypes: [], historicalBars: { supported: true, quality: 'realtime' } },
        }),
      ]),
    })

    await expect(m.getBarCapabilities()).resolves.toEqual({ 'alpaca-paper': 'iex' })
  })
})

describe('UTAManagerSDK — unavailable carrier', () => {
  it('degrades local reads without touching the UTA HTTP client', async () => {
    const disabledReason = 'UTA disabled by OPENALICE_LITE_MODE'
    const client = {
      get: async (path: string) => {
        throw new Error(`unexpected GET ${path}`)
      },
    } as never
    const m = new UTAManagerSDK({ client, unavailableReason: disabledReason })

    await expect(m.listUTAs()).resolves.toEqual([])
    await expect(m.resolve()).resolves.toEqual([])
    await expect(m.getBarCapabilities()).resolves.toEqual({})
    await expect(m.getFxRates()).resolves.toEqual([])
    await expect(m.searchContracts('BTC')).resolves.toEqual([])
    await expect(m.reconnectUTA('alpaca-paper')).resolves.toEqual({ success: false, error: disabledReason })
    await expect(m.removeUTA('alpaca-paper')).resolves.toBeUndefined()
    await expect(m.getAggregatedEquity()).rejects.toThrow(disabledReason)
    await expect(m.getContractDetails('alpaca-paper', {} as never)).rejects.toThrow(disabledReason)
  })
})
