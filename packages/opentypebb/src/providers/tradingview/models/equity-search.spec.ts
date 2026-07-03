import { describe, expect, it } from 'vitest'
import { TradingViewEquitySearchFetcher } from './equity-search.js'

describe('TradingViewEquitySearchFetcher', () => {
  it('keeps global listings as TradingView-qualified symbols', () => {
    const query = TradingViewEquitySearchFetcher.transformQuery({ query: '0700' })
    const out = TradingViewEquitySearchFetcher.transformData(query, [
      {
        symbol: 'AAPL',
        description: 'Apple Inc.',
        exchange: 'NASDAQ',
        source_id: 'NASDAQ',
        provider_id: 'ice',
        country: 'US',
      },
      {
        symbol: 'AAPL',
        description: 'Apple Inc. CDR',
        exchange: 'TSX',
        prefix: 'TSX',
        country: 'CA',
      },
      {
        symbol: 'AAPL',
        description: 'Apple Inc. CEDEAR',
        exchange: 'BYMA',
        prefix: 'BCBA',
        country: 'AR',
      },
      {
        symbol: '0700',
        description: 'Tencent Holdings Limited',
        exchange: 'HKEX',
        source_id: 'HKEX',
        prefix: 'HKEX',
        provider_id: 'ice',
        country: 'HK',
        type: 'stock',
      },
    ])

    expect(out).toEqual([
      {
        symbol: 'NASDAQ:AAPL',
        name: 'Apple Inc.',
        aliases: ['AAPL'],
        exchange: 'NASDAQ',
        listed_exchange: 'NASDAQ',
        provider_id: 'ice',
        country: 'US',
        type: null,
        coverage: 'tradingview_global',
        volume_quality: 'exchange_dependent',
      },
      {
        symbol: 'TSX:AAPL',
        name: 'Apple Inc. CDR',
        aliases: ['AAPL'],
        exchange: 'TSX',
        listed_exchange: 'TSX',
        provider_id: null,
        country: 'CA',
        type: null,
        coverage: 'tradingview_global',
        volume_quality: 'exchange_dependent',
      },
      {
        symbol: 'BCBA:AAPL',
        name: 'Apple Inc. CEDEAR',
        aliases: ['AAPL'],
        exchange: 'BYMA',
        listed_exchange: 'BYMA',
        provider_id: null,
        country: 'AR',
        type: null,
        coverage: 'tradingview_global',
        volume_quality: 'exchange_dependent',
      },
      {
        symbol: 'HKEX:0700',
        name: 'Tencent Holdings Limited',
        aliases: ['0700'],
        exchange: 'HKEX',
        listed_exchange: 'HKEX',
        provider_id: 'ice',
        country: 'HK',
        type: 'stock',
        coverage: 'tradingview_global',
        volume_quality: 'exchange_dependent',
      },
    ])
  })
})
