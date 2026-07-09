import { describe, expect, it } from 'vitest'
import { EmptyDataError } from '../../core/provider/utils/errors.js'
import {
  buildTradingViewHistoricalRequest,
  describeTradingViewFeed,
  fetchTradingViewHistoricalBars,
  mapTradingViewHistoricalBars,
  mapTradingViewSearchRows,
  supportsTradingViewInternalIntrabar,
  type TradingViewHistoricalQuery,
} from './domain.js'
import type { TradingViewBar } from './utils/websocket.js'

describe('TradingView domain', () => {
  it('describes anonymous feed semantics in one place', () => {
    expect(describeTradingViewFeed('equity')).toMatchObject({
      provider: 'tradingview',
      capability: 'delayed',
      coverage: 'cboe_one',
      volumeQuality: 'partial_market',
      isAnonymous: true,
      isFreshnessExchangeDependent: true,
      supportsInternal3mIntrabars: true,
    })
    expect(describeTradingViewFeed('crypto')).toMatchObject({
      provider: 'tradingview',
      capability: 'delayed',
      coverage: 'tradingview_global',
      volumeQuality: 'exchange_dependent',
    })
    expect(supportsTradingViewInternalIntrabar('tradingview', '3m')).toBe(true)
    expect(supportsTradingViewInternalIntrabar('yfinance', '3m')).toBe(false)
    expect(supportsTradingViewInternalIntrabar('tradingview', '5m')).toBe(false)
  })

  it('builds websocket requests from the historical query contract', async () => {
    const query: TradingViewHistoricalQuery = {
      symbol: 'AAPL',
      interval: '1m',
      start_date: null,
      end_date: '2026-07-02',
      count: 250,
    }

    expect(buildTradingViewHistoricalRequest(query, { session: 'extended' })).toEqual({
      symbol: 'AAPL',
      interval: '1',
      range: 250,
      to: 1783036799,
      session: 'extended',
    })

    const requests: unknown[] = []
    await fetchTradingViewHistoricalBars(query, {
      session: 'extended',
      fetchBars: async (request) => {
        requests.push(request)
        return [] as TradingViewBar[]
      },
    })
    expect(requests).toEqual([{
      symbol: 'AAPL',
      interval: '1',
      range: 250,
      to: 1783036799,
      session: 'extended',
    }])
  })

  it('sorts, maps, filters, and parses TradingView bars through one interface', () => {
    const query: TradingViewHistoricalQuery = {
      symbol: 'AAPL',
      interval: '1m',
      start_date: '2026-07-02',
      end_date: '2026-07-02',
    }
    const bars: TradingViewBar[] = [
      { time: 1782912600, open: 1, high: 1, low: 1, close: 1, volume: 1 },
      { time: 1782999000, open: 3, high: 3, low: 3, close: 3, volume: 3 },
      { time: 1782998940, open: 2, high: 2, low: 2, close: 2, volume: null },
    ]

    const out = mapTradingViewHistoricalBars(query, bars, {
      assetKind: 'equity',
      emptyDataMessage: 'empty',
      mapBar: ({ date, bar, semantics }) => ({
        date,
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
        volume: bar.volume,
        symbol: query.symbol,
        provider: semantics.provider,
        coverage: semantics.coverage,
      }),
      parse: (row) => row,
    })

    expect(out).toEqual([
      {
        date: '2026-07-02 13:29:00',
        open: 2,
        high: 2,
        low: 2,
        close: 2,
        volume: null,
        symbol: 'AAPL',
        provider: 'tradingview',
        coverage: 'cboe_one',
      },
      {
        date: '2026-07-02 13:30:00',
        open: 3,
        high: 3,
        low: 3,
        close: 3,
        volume: 3,
        symbol: 'AAPL',
        provider: 'tradingview',
        coverage: 'cboe_one',
      },
    ])
  })

  it('throws the asset-specific empty-data message after date-window filtering', () => {
    const query: TradingViewHistoricalQuery = {
      symbol: 'AAPL',
      interval: '1m',
      start_date: '2026-07-02',
      end_date: '2026-07-02',
    }

    expect(() => mapTradingViewHistoricalBars(query, [
      { time: 1782912600, open: 1, high: 1, low: 1, close: 1, volume: 1 },
    ], {
      assetKind: 'equity',
      emptyDataMessage: 'No rows for this asset.',
      mapBar: ({ date, bar }) => ({ date, open: bar.open }),
      parse: (row) => row,
    })).toThrow(EmptyDataError)
  })

  it('maps search rows to TradingView-qualified symbols and feed metadata', () => {
    expect(mapTradingViewSearchRows([
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
    ], 'equity')).toEqual([
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

    expect(mapTradingViewSearchRows([
      {
        symbol: 'BTCUSDT',
        description: 'Bitcoin / TetherUS',
        exchange: 'BINANCE',
        source_id: 'BINANCE',
        prefix: 'BINANCE',
        provider_id: 'crypto',
        type: 'spot',
      },
    ], 'crypto')).toEqual([
      {
        symbol: 'BINANCE:BTCUSDT',
        name: 'Bitcoin / TetherUS',
        aliases: ['BTCUSDT'],
        exchange: 'BINANCE',
        listed_exchange: 'BINANCE',
        provider_id: 'crypto',
        country: undefined,
        type: 'spot',
        coverage: undefined,
        volume_quality: undefined,
      },
    ])
  })
})
