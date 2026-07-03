import { describe, expect, it, vi } from 'vitest'
import { aggregateSymbolSearch, type MarketSearchDeps } from './aggregate-search.js'

function deps(over: Partial<MarketSearchDeps> = {}): MarketSearchDeps {
  return {
    symbolIndex: { search: () => [] } as never,
    equityVendors: ['yfinance'],
    assetProviders: { crypto: 'yfinance', currency: 'yfinance' },
    equityClient: { search: vi.fn(async () => []) } as never,
    cryptoClient: { search: vi.fn(async () => []) } as never,
    currencyClient: { search: vi.fn(async () => []) } as never,
    commodityCatalog: { search: () => [] } as never,
    ...over,
  }
}

describe('aggregateSymbolSearch', () => {
  it('uses configured crypto and currency providers and preserves sourceId', async () => {
    const cryptoSearch = vi.fn(async () => [{ symbol: 'BINANCE:BTCUSDT', name: 'Bitcoin / TetherUS' }])
    const currencySearch = vi.fn(async () => [{ symbol: 'FX:USDJPY', name: 'U.S. Dollar / Japanese Yen' }])

    const out = await aggregateSymbolSearch(deps({
      assetProviders: { crypto: 'tradingview', currency: 'tradingview' },
      cryptoClient: { search: cryptoSearch } as never,
      currencyClient: { search: currencySearch } as never,
    }), 'USD')

    expect(cryptoSearch).toHaveBeenCalledWith({ query: 'USD', provider: 'tradingview' })
    expect(currencySearch).toHaveBeenCalledWith({ query: 'USD', provider: 'tradingview' })
    expect(out).toEqual([
      expect.objectContaining({ symbol: 'BINANCE:BTCUSDT', assetClass: 'crypto', sourceId: 'tradingview' }),
      expect.objectContaining({ symbol: 'FX:USDJPY', assetClass: 'currency', sourceId: 'tradingview' }),
    ])
  })
})
