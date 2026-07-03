import { describe, expect, it } from 'vitest'
import { TradingViewEquityHistoricalFetcher } from './equity-historical.js'
import type { TradingViewBar } from '../utils/websocket.js'

describe('TradingViewEquityHistoricalFetcher', () => {
  it('accepts every bar interval advertised by the bar service', () => {
    for (const interval of ['1m', '5m', '15m', '30m', '1h', '4h', '1d', '1w']) {
      expect(TradingViewEquityHistoricalFetcher.transformQuery({ symbol: 'AAPL', interval })).toMatchObject({
        symbol: 'AAPL',
        interval,
      })
    }
  })

  it('rejects invalid date inputs before they can produce NaN websocket ranges', () => {
    expect(() => TradingViewEquityHistoricalFetcher.transformQuery({
      symbol: 'AAPL',
      interval: '1m',
      start_date: '2026-07-02',
      end_date: 'invalid-date',
    })).toThrow()

    expect(() => TradingViewEquityHistoricalFetcher.transformQuery({
      symbol: 'AAPL',
      interval: '1m',
      start_date: '2026-02-31',
    })).toThrow()
  })

  it('maps TradingView bars to equity historical rows in UTC', () => {
    const query = TradingViewEquityHistoricalFetcher.transformQuery({
      symbol: 'AAPL',
      interval: '1m',
      start_date: '2026-07-02',
      end_date: '2026-07-02',
    })
    const raw: TradingViewBar[] = [
      { time: 1782999000, open: 294.12, high: 297.1, low: 293.7, close: 297.035, volume: 44022 },
      { time: 1782998940, open: 293, high: 294, low: 292, close: 293.5, volume: null },
    ]

    const out = TradingViewEquityHistoricalFetcher.transformData(query, raw)

    expect(out).toEqual([
      {
        date: '2026-07-02 13:29:00',
        open: 293,
        high: 294,
        low: 292,
        close: 293.5,
        volume: null,
        vwap: null,
        symbol: 'AAPL',
        provider: 'tradingview',
        coverage: 'cboe_one',
        volume_quality: 'partial_market',
      },
      {
        date: '2026-07-02 13:30:00',
        open: 294.12,
        high: 297.1,
        low: 293.7,
        close: 297.035,
        volume: 44022,
        vwap: null,
        symbol: 'AAPL',
        provider: 'tradingview',
        coverage: 'cboe_one',
        volume_quality: 'partial_market',
      },
    ])
  })

  it('filters rows outside the requested date window', () => {
    const query = TradingViewEquityHistoricalFetcher.transformQuery({
      symbol: 'AAPL',
      interval: '1m',
      start_date: '2026-07-02',
      end_date: '2026-07-02',
    })
    const raw: TradingViewBar[] = [
      { time: 1782912600, open: 1, high: 1, low: 1, close: 1, volume: 1 },
      { time: 1782999000, open: 2, high: 2, low: 2, close: 2, volume: 2 },
    ]

    const out = TradingViewEquityHistoricalFetcher.transformData(query, raw)

    expect(out).toHaveLength(1)
    expect(out[0]!.date).toBe('2026-07-02 13:30:00')
  })
})
