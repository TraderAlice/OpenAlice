import { describe, expect, it, vi } from 'vitest'
import type { BarService, OhlcvBar } from '@/domain/market-data/bars/index'
import type { EquityClientLike, IndexClientLike } from '@/domain/market-data/client/types'
import { createUsEquityScreenerTools } from './us-equity-screener.js'

const BARS = 280
const d = (i: number) => new Date(Date.UTC(2025, 0, 1) + i * 86400000).toISOString().slice(0, 10)
const ctx = { toolCallId: 't', messages: [] as never, abortSignal: undefined as never }

function history(drift: number, lastDrop = 0): OhlcvBar[] {
  return Array.from({ length: BARS }, (_, i) => {
    let close = 100 * (1 + drift * i)
    if (lastDrop && i >= BARS - 5) close *= 1 - lastDrop * ((i - (BARS - 6)) / 5)
    return { date: d(i), open: close, high: close * 1.01, low: close * 0.99, close, volume: 2_000_000 }
  })
}

const histories: Record<string, OhlcvBar[]> = {
  SPY: history(0.0008),
  QQQ: history(0.001),
  LEAD: history(0.0024),
  QUAL: history(0.0011),
  PULL: history(0.0019, 0.12),
}

const barService = {
  searchBarSources: async () => [],
  getBars: async (ref: { symbol?: string }) => ({
    bars: histories[ref.symbol ?? ''] ?? [],
    meta: { symbol: ref.symbol ?? '', from: d(0), to: d(BARS - 1), bars: histories[ref.symbol ?? '']?.length ?? 0 },
  }),
} as unknown as BarService

const equityClient = {
  getProfile: vi.fn(async ({ symbol }: { symbol: string }) => [{
    symbol,
    name: `${symbol} Inc`,
    sector: symbol === 'QUAL' ? 'Health Care' : 'Technology',
  }]),
  getKeyMetrics: vi.fn(async ({ symbol }: { symbol: string }) => [{
    symbol,
    market_cap: 100e9,
    // Yahoo-shaped keys (price_to_earnings / gross_profit_margin) — the tool
    // must accept these, not only FMP's pe_ratio / ratios endpoint.
    price_to_earnings: symbol === 'QUAL' ? 20 : 30,
    price_to_book: 5,
    ev_to_ebitda: 15,
    return_on_equity: symbol === 'QUAL' ? 0.45 : 0.25,
    return_on_invested_capital: symbol === 'QUAL' ? 0.3 : 0.18,
    debt_to_equity: 0.4,
    gross_profit_margin: symbol === 'QUAL' ? 0.8 : 0.6,
    operating_profit_margin: symbol === 'QUAL' ? 0.35 : 0.25,
    free_cash_flow_yield: symbol === 'QUAL' ? 0.06 : 0.03,
  }]),
  getFinancialRatios: vi.fn(async () => []),
} as unknown as EquityClientLike

const indexClient = {
  getConstituents: vi.fn(async () => [
    { symbol: 'LEAD', name: 'Leader' },
    { symbol: 'QUAL', name: 'Quality' },
    { symbol: 'PULL', name: 'Pullback' },
  ]),
} as unknown as IndexClientLike

describe('US equity screener tools', () => {
  it('exposes the three requested read-only screeners', () => {
    const tools = createUsEquityScreenerTools(equityClient, barService, indexClient)
    expect(Object.keys(tools).sort()).toEqual([
      'usFactorRank',
      'usMeanReversionPool',
      'usRelativeStrengthPool',
    ])
  })

  it('usRelativeStrengthPool returns trend leaders with reasons and risks', async () => {
    const tools = createUsEquityScreenerTools(equityClient, barService, indexClient)
    const result = await tools.usRelativeStrengthPool.execute!({ universe: 'sp500_nasdaq100', limit: 2 }, ctx) as { top: Array<{ symbol: string; reasons: string[]; risks: string[] }> }
    expect(result.top[0].symbol).toBe('LEAD')
    expect(result.top[0].reasons.length).toBeGreaterThan(0)
    expect(result.top[0].risks).toEqual(expect.any(Array))
  })

  it('usFactorRank returns explicit factor sub-scores', async () => {
    const tools = createUsEquityScreenerTools(equityClient, barService, indexClient)
    const result = await tools.usFactorRank.execute!({ universe: 'sp500_nasdaq100', limit: 3 }, ctx) as { top: Array<{ scores: Record<string, number> }> }
    expect(result.top[0].scores).toEqual(expect.objectContaining({
      momentum: expect.any(Number),
      quality: expect.any(Number),
      value: expect.any(Number),
      volatility: expect.any(Number),
    }))
  })

  it('usMeanReversionPool includes market-health gating', async () => {
    const tools = createUsEquityScreenerTools(equityClient, barService, indexClient)
    const result = await tools.usMeanReversionPool.execute!({ universe: 'sp500_nasdaq100', limit: 3 }, ctx) as { marketHealth: { enabled: boolean }; top: Array<{ symbol: string }> }
    expect(result.marketHealth.enabled).toBe(true)
    expect(result.top[0].symbol).toBe('PULL')
  })

  it('normalizeDebtToEquity converts Yahoo percent-scale values', async () => {
    const { normalizeDebtToEquity } = await import('./us-equity-screener.js')
    expect(normalizeDebtToEquity(79.548)).toBeCloseTo(0.79548)
    expect(normalizeDebtToEquity(0.8)).toBeCloseTo(0.8)
    expect(normalizeDebtToEquity(null)).toBeNull()
  })

  it('reads Yahoo-shaped key-metrics fields (price_to_earnings / gross_profit_margin)', async () => {
    const tools = createUsEquityScreenerTools(equityClient, barService, indexClient)
    const result = await tools.usFactorRank.execute!({ universe: 'sp500_nasdaq100', limit: 3 }, ctx) as {
      top: Array<{ symbol: string; metrics: Record<string, number | null>; risks: string[] }>
    }
    const lead = result.top.find((r) => r.symbol === 'LEAD')
    expect(lead?.metrics.pe_ratio).toBe(30)
    expect(lead?.metrics.gross_margin).toBe(0.6)
    expect(lead?.risks ?? []).not.toContain('missing fundamentals')
  })

  it('falls back to index constituent names when profile name is missing', async () => {
    const thinEquity = {
      ...equityClient,
      getProfile: vi.fn(async ({ symbol }: { symbol: string }) => [{ symbol, sector: 'Energy' }]),
      getKeyMetrics: vi.fn(async () => [{ symbol: 'TRGP', debt_to_equity: 58.5 }]),
      getFinancialRatios: vi.fn(async () => []),
    } as unknown as EquityClientLike
    const namedIndex = {
      getConstituents: vi.fn(async () => [
        { symbol: 'LEAD', name: 'Leader' },
        { symbol: 'QUAL', name: 'Quality' },
        { symbol: 'PULL', name: 'Pullback' },
      ]),
    } as unknown as IndexClientLike
    const tools = createUsEquityScreenerTools(thinEquity, barService, namedIndex)
    const result = await tools.usRelativeStrengthPool.execute!({ universe: 'sp500_nasdaq100', limit: 3 }, ctx) as {
      top: Array<{ symbol: string; name: string | null; metrics: Record<string, number | null>; risks: string[] }>
    }
    expect(result.top.every((r) => typeof r.name === 'string' && r.name.length > 0)).toBe(true)
    const lead = result.top.find((r) => r.symbol === 'LEAD')
    expect(lead?.metrics.debt_to_equity).toBeCloseTo(0.585)
    expect(lead?.risks ?? []).not.toContain('high leverage')
  })
})

