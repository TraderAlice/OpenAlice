import { describe, expect, it, vi } from 'vitest'

import { aggregateSymbolSearch, type MarketSearchDeps } from './aggregate-search.js'

function deps(): MarketSearchDeps {
  return {
    symbolIndex: {
      search: vi.fn(() => [
        { symbol: 'UNRELATED1', name: 'Unrelated One', source: 'sec' },
        { symbol: 'UNRELATED2', name: 'Unrelated Two', source: 'sec' },
        { symbol: 'UNRELATED3', name: 'Unrelated Three', source: 'sec' },
      ]),
    } as never,
    equityVendors: ['yfinance'],
    equityClient: { search: vi.fn(async () => []) } as never,
    cryptoClient: { search: vi.fn(async () => []) } as never,
    currencyClient: {
      search: vi.fn(async () => [
        { symbol: 'EURUSD', name: 'Euro / U.S. Dollar' },
        { symbol: 'EURUSDX', name: 'Euro Index' },
      ]),
    } as never,
    commodityCatalog: { search: vi.fn(() => []) } as never,
  }
}

describe('aggregateSymbolSearch limits', () => {
  it('ranks the full union, then enforces one global result limit', async () => {
    const searchDeps = deps()
    const results = await aggregateSymbolSearch(searchDeps, 'EURUSD', 2)

    expect(results).toHaveLength(2)
    expect(results[0]).toMatchObject({ symbol: 'EURUSD', assetClass: 'currency' })
    expect(searchDeps.symbolIndex.search).toHaveBeenCalledWith('EURUSD', 2)
    expect(searchDeps.commodityCatalog.search).toHaveBeenCalledWith('EURUSD', 2)
  })

  it('keeps native equity results in their provider namespace', async () => {
    const searchDeps = deps()
    searchDeps.nativeEquitySources = [{
      sourceId: 'tushare',
      search: async () => [{ symbol: '600519.SH', name: '贵州茅台', assetClass: 'equity' }],
    }]
    const results = await aggregateSymbolSearch(searchDeps, '贵州茅台', 5)
    expect(results[0]).toMatchObject({
      symbol: '600519.SH', name: '贵州茅台', assetClass: 'equity', sourceId: 'tushare',
    })
  })
})
