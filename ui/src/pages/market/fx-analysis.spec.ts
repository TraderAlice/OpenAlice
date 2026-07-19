import { describe, expect, it } from 'vitest'

import type { HistoricalBar } from '../../api/market'
import {
  buildIndicativeForwardCurve,
  calculateFxScenario,
  computeFxPriceStats,
  parseFxPair,
  resolveFxCountry,
} from './fx-analysis'

function dailyBars(days: number): HistoricalBar[] {
  return Array.from({ length: days }, (_, index) => {
    const close = 1 + index * 0.001
    return {
      date: new Date(Date.UTC(2026, 0, index + 1)).toISOString().slice(0, 10),
      open: close - 0.0005,
      high: close + 0.001,
      low: close - 0.001,
      close,
      volume: null,
    }
  })
}

describe('FX market analysis', () => {
  it('parses common FX vendor symbols and applies the JPY pip convention', () => {
    expect(parseFxPair('EURUSD=X')).toEqual({ symbol: 'EURUSD', base: 'EUR', quote: 'USD', pipSize: 0.0001 })
    expect(parseFxPair('USD/JPY')).toEqual({ symbol: 'USDJPY', base: 'USD', quote: 'JPY', pipSize: 0.01 })
    expect(parseFxPair('USD.USD')).toBeNull()
  })

  it('marks the macro proxies that are not exact currency-area aggregates', () => {
    expect(resolveFxCountry('EUR')?.proxy).toBe('Germany proxy')
    expect(resolveFxCountry('CNH')?.proxy).toBe('onshore macro proxy')
  })

  it('derives horizon returns, realized volatility and range position from displayed bars', () => {
    const stats = computeFxPriceStats(dailyBars(120))!
    expect(stats.spot).toBeCloseTo(1.119)
    expect(stats.oneWeekReturn).toBeGreaterThan(0)
    expect(stats.oneMonthReturn).toBeGreaterThan(stats.oneWeekReturn!)
    expect(stats.threeMonthReturn).toBeGreaterThan(stats.oneMonthReturn!)
    expect(stats.realizedVol20).not.toBeNull()
    expect(stats.rangePosition).toBeGreaterThan(90)
  })

  it('projects indicative forward points from the two short-rate proxies', () => {
    const curve = buildIndicativeForwardCurve(1.08, 2, 4, 0.0001)
    expect(curve).toHaveLength(4)
    expect(curve[0].outright).toBeGreaterThan(1.08)
    expect(curve[3].points).toBeGreaterThan(curve[0].points)
  })

  it('calculates manual long and short exposure P&L without an account connection', () => {
    const pair = parseFxPair('EURUSD')!
    const long = calculateFxScenario({ pair, spot: 1.08, notionalBase: 1_000_000, movePips: 25, side: 'long' })!
    const short = calculateFxScenario({ pair, spot: 1.08, notionalBase: 1_000_000, movePips: 25, side: 'short' })!
    expect(long.quotePnl).toBe(2_500)
    expect(short.quotePnl).toBe(-2_500)
    expect(long.shockedSpot).toBeCloseTo(1.0825)
  })
})
