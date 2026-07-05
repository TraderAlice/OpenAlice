/**
 * UTAManagerSDK.resolve tier filtering (issue #390).
 *
 * `tradingOnly` drops keyless 'data'-tier sources (binance-readonly etc.) from
 * the no-source aggregate so a region-blocked public-data account can't blank
 * a user's portfolio. An explicit source still resolves a data-tier account.
 */
import { describe, it, expect } from 'vitest'
import { UTAManagerSDK } from './UTAManagerSDK.js'
import type { UTATier } from '@traderalice/uta-protocol'

const summary = (id: string, tier: UTATier) => ({
  id, label: id, capabilities: {},
  health: { status: 'healthy', reach: 'connected', tier, consecutiveFailures: 0, recovering: false, connecting: false },
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
