import { describe, expect, it } from 'vitest'
import { EmptyDataError } from '../../../core/provider/utils/errors.js'
import {
  fetchTradingViewHistoricalBars,
  transformTradingViewHistoricalData,
  type TradingViewHistoricalFetchQuery,
} from './historical-fetcher.js'
import type { TradingViewBar } from './websocket.js'

describe('TradingView historical fetcher helpers', () => {
  it('builds websocket requests from the shared historical query contract', async () => {
    const requests: unknown[] = []
    const fetchBars = async (request: unknown) => {
      requests.push(request)
      return [] as TradingViewBar[]
    }
    const query: TradingViewHistoricalFetchQuery = {
      symbol: 'AAPL',
      interval: '1m',
      start_date: null,
      end_date: '2026-07-02',
      count: 250,
    }

    await fetchTradingViewHistoricalBars(query, {
      session: 'extended',
      fetchBars,
    })

    expect(requests).toEqual([{
      symbol: 'AAPL',
      interval: '1',
      range: 250,
      to: 1783036799,
      session: 'extended',
    }])
  })

  it('sorts, maps, filters, and parses TradingView bars in one place', () => {
    const query: TradingViewHistoricalFetchQuery = {
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

    const out = transformTradingViewHistoricalData(query, bars, {
      emptyDataMessage: 'empty',
      mapBar: ({ date, bar }) => ({
        date,
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
        volume: bar.volume,
        symbol: query.symbol,
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
      },
      {
        date: '2026-07-02 13:30:00',
        open: 3,
        high: 3,
        low: 3,
        close: 3,
        volume: 3,
        symbol: 'AAPL',
      },
    ])
  })

  it('throws the asset-specific empty-data message after date-window filtering', () => {
    const query: TradingViewHistoricalFetchQuery = {
      symbol: 'AAPL',
      interval: '1m',
      start_date: '2026-07-02',
      end_date: '2026-07-02',
    }
    const bars: TradingViewBar[] = [
      { time: 1782912600, open: 1, high: 1, low: 1, close: 1, volume: 1 },
    ]

    expect(() => transformTradingViewHistoricalData(query, bars, {
      emptyDataMessage: 'No rows for this asset.',
      mapBar: ({ date, bar }) => ({ date, open: bar.open }),
      parse: (row) => row,
    })).toThrow(EmptyDataError)
  })
})
