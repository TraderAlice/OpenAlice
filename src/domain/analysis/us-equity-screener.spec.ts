import { describe, expect, it } from 'vitest'
import type { OhlcvBar } from '@/domain/market-data/bars/types'
import {
  computeMarketHealth,
  computeUsFactorRank,
  computeUsMeanReversionPool,
  computeUsRelativeStrengthPool,
  type SymbolDataset,
  type UsEquityFundamentals,
} from './us-equity-screener'

const BARS = 280
const d = (i: number) => new Date(Date.UTC(2025, 0, 1) + i * 86400000).toISOString().slice(0, 10)

function history(opts: {
  start?: number
  drift?: number
  lastDrop?: number
  volatilityWave?: number
  volume?: number
}): OhlcvBar[] {
  const start = opts.start ?? 100
  const drift = opts.drift ?? 0
  const wave = opts.volatilityWave ?? 0
  return Array.from({ length: BARS }, (_, i) => {
    let close = start * (1 + drift * i)
    if (wave) close += Math.sin(i / 3) * wave
    if (opts.lastDrop && i >= BARS - 5) close *= 1 - opts.lastDrop * ((i - (BARS - 6)) / 5)
    return {
      date: d(i),
      open: close * 0.995,
      high: close * 1.01,
      low: close * 0.99,
      close,
      volume: opts.volume ?? 1_000_000,
    }
  })
}

function f(symbol: string, overrides: Partial<UsEquityFundamentals> = {}): UsEquityFundamentals {
  return {
    symbol,
    name: `${symbol} Inc`,
    sector: 'Technology',
    marketCap: 100e9,
    peRatio: 25,
    priceToBook: 6,
    evToEbitda: 18,
    roe: 0.22,
    roic: 0.16,
    grossMargin: 0.62,
    operatingMargin: 0.28,
    debtToEquity: 0.6,
    revenueGrowth: 0.08,
    epsGrowth: 0.1,
    freeCashFlowYield: 0.035,
    ...overrides,
  }
}

const benchmarks = {
  SPY: history({ drift: 0.0008, volume: 70_000_000 }),
  QQQ: history({ drift: 0.001, volume: 50_000_000 }),
}

function datasets(): SymbolDataset[] {
  return [
    {
      symbol: 'LEAD',
      name: 'Leader',
      history: history({ drift: 0.0023, volume: 3_000_000 }),
      fundamentals: f('LEAD', { roe: 0.38, roic: 0.28, grossMargin: 0.78, peRatio: 32 }),
    },
    {
      symbol: 'QUAL',
      name: 'Quality',
      history: history({ drift: 0.0011, volume: 2_000_000 }),
      fundamentals: f('QUAL', { roe: 0.45, roic: 0.32, grossMargin: 0.82, debtToEquity: 0.1, peRatio: 21 }),
    },
    {
      symbol: 'VALUE',
      name: 'Value',
      history: history({ drift: 0.0009, volume: 2_000_000 }),
      fundamentals: f('VALUE', { peRatio: 9, priceToBook: 1.2, evToEbitda: 7, freeCashFlowYield: 0.08 }),
    },
    {
      symbol: 'PULL',
      name: 'Pullback',
      history: history({ drift: 0.0019, lastDrop: 0.12, volume: 2_000_000 }),
      fundamentals: f('PULL', { roe: 0.3, roic: 0.22 }),
    },
    {
      symbol: 'LAG',
      name: 'Laggard',
      history: history({ drift: -0.0002, volume: 500_000 }),
      fundamentals: f('LAG', { roe: 0.05, debtToEquity: 4, peRatio: 80 }),
    },
  ]
}

describe('US equity systematic screens', () => {
  it('relative-strength pool ranks the trend leader first with reasons and risks', () => {
    const result = computeUsRelativeStrengthPool(datasets(), benchmarks, { top: 3 })
    expect(result.top).toHaveLength(3)
    expect(result.top[0].symbol).toBe('LEAD')
    expect(result.top[0].reasons).toContain('outperforming SPY over 6M')
    expect(result.top[0].scores.momentum).toBeGreaterThan(result.top[1].scores.momentum - 1)
  })

  it('factor rank exposes momentum, quality, value, and volatility sub-scores', () => {
    const result = computeUsFactorRank(datasets(), benchmarks, { top: 5 })
    const row = result.top.find((r) => r.symbol === 'QUAL')!
    expect(row.scores).toEqual(expect.objectContaining({
      momentum: expect.any(Number),
      quality: expect.any(Number),
      value: expect.any(Number),
      volatility: expect.any(Number),
    }))
    expect(row.scores.quality).toBeGreaterThan(70)
    expect(result.top.find((r) => r.symbol === 'VALUE')!.scores.value).toBeGreaterThan(70)
  })

  it('mean-reversion pool emits pullbacks only when SPY and QQQ are healthy', () => {
    const result = computeUsMeanReversionPool(datasets(), benchmarks, { top: 3 })
    expect(result.marketHealth.enabled).toBe(true)
    expect(result.top[0].symbol).toBe('PULL')
    expect(result.top[0].scores.pullback).toBeGreaterThan(65)
    expect(result.top[0].reasons).toContain('long-term uptrend intact')
  })

  it('mean-reversion pool gates off when broad market trend is unhealthy', () => {
    const badBenchmarks = {
      SPY: history({ drift: -0.001, volume: 70_000_000 }),
      QQQ: history({ drift: -0.001, volume: 50_000_000 }),
    }
    const result = computeUsMeanReversionPool(datasets(), badBenchmarks, { top: 3 })
    expect(result.marketHealth.enabled).toBe(false)
    expect(result.top).toHaveLength(0)
  })

  it('market health reports insufficient data explicitly', () => {
    const health = computeMarketHealth({ SPY: [], QQQ: [] })
    expect(health.enabled).toBe(false)
    expect(health.label).toBe('insufficient-data')
  })
})
