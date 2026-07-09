/**
 * US equity systematic screens.
 *
 * Pure compute layer for three read-only agent tools:
 * - relative-strength leaders
 * - multi-factor rank
 * - healthy-market pullback / mean-reversion candidates
 */

import type { OhlcvBar } from '@/domain/market-data/bars/types.js'
import { BBANDS, RSI } from './indicator/functions/technical.js'

export type UsEquityUniverse = 'sp500' | 'nasdaq100' | 'sp500_nasdaq100' | 'custom'

export interface UsEquityFundamentals {
  symbol: string
  name?: string | null
  sector?: string | null
  marketCap?: number | null
  peRatio?: number | null
  priceToBook?: number | null
  evToEbitda?: number | null
  roe?: number | null
  roic?: number | null
  grossMargin?: number | null
  operatingMargin?: number | null
  debtToEquity?: number | null
  revenueGrowth?: number | null
  epsGrowth?: number | null
  freeCashFlowYield?: number | null
}

export interface SymbolDataset {
  symbol: string
  name?: string | null
  history: OhlcvBar[]
  fundamentals?: UsEquityFundamentals
}

export interface MarketHealth {
  enabled: boolean
  label: 'healthy' | 'caution' | 'unhealthy' | 'insufficient-data'
  reasons: string[]
  spy: {
    close: number | null
    sma50: number | null
    sma200: number | null
    rsi14: number | null
  }
  qqq: {
    close: number | null
    sma50: number | null
    sma200: number | null
    rsi14: number | null
  }
}

export interface ScoredEquityRow {
  symbol: string
  name: string | null
  sector: string | null
  price: number | null
  scores: {
    total: number
    momentum: number
    quality: number
    value: number
    volatility: number
    pullback?: number
  }
  metrics: Record<string, number | null>
  reasons: string[]
  risks: string[]
  bars: number
}

export interface UsRelativeStrengthPoolResult {
  asOf: string
  universe: UsEquityUniverse
  benchmark: string
  top: ScoredEquityRow[]
  methodology: string
}

export interface UsFactorRankResult {
  asOf: string
  universe: UsEquityUniverse
  top: ScoredEquityRow[]
  methodology: string
}

export interface UsMeanReversionPoolResult {
  asOf: string
  universe: UsEquityUniverse
  marketHealth: MarketHealth
  top: ScoredEquityRow[]
  methodology: string
}

const MIN_BARS = 210
const DEFAULT_TOP = 20

function sortAsc(history: OhlcvBar[]): OhlcvBar[] {
  return [...history]
    .filter((b) => typeof b.date === 'string' && Number.isFinite(b.close))
    .sort((a, b) => a.date.localeCompare(b.date))
}

function closes(history: OhlcvBar[]): number[] {
  return sortAsc(history).map((b) => b.close)
}

function volumes(history: OhlcvBar[]): number[] {
  return sortAsc(history).map((b) => b.volume ?? 0)
}

function latest(history: OhlcvBar[]): OhlcvBar | null {
  const s = sortAsc(history)
  return s.length > 0 ? s[s.length - 1] : null
}

function ret(xs: number[], days: number): number | null {
  if (xs.length < days + 1) return null
  const prior = xs[xs.length - 1 - days]
  const last = xs[xs.length - 1]
  if (!Number.isFinite(prior) || prior === 0 || !Number.isFinite(last)) return null
  return last / prior - 1
}

function sma(xs: number[], n: number): number | null {
  if (xs.length < n) return null
  const slice = xs.slice(-n)
  return slice.reduce((a, b) => a + b, 0) / n
}

function maxDrawdown(xs: number[], n: number): number | null {
  if (xs.length < 2) return null
  const slice = xs.slice(-Math.min(n, xs.length))
  let peak = slice[0]
  let worst = 0
  for (const x of slice) {
    peak = Math.max(peak, x)
    if (peak > 0) worst = Math.min(worst, x / peak - 1)
  }
  return worst
}

function stdev(xs: number[]): number | null {
  if (xs.length < 2) return null
  const m = xs.reduce((a, b) => a + b, 0) / xs.length
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / xs.length)
}

function realizedVol(xs: number[], n: number): number | null {
  if (xs.length < n + 1) return null
  const slice = xs.slice(-n - 1)
  const returns: number[] = []
  for (let i = 1; i < slice.length; i++) returns.push(slice[i] / slice[i - 1] - 1)
  const sd = stdev(returns)
  return sd === null ? null : sd * Math.sqrt(252)
}

function rsiSafe(xs: number[], n: number): number | null {
  try {
    return RSI(xs, n)
  } catch {
    return null
  }
}

function bbandsSafe(xs: number[], n: number, mult: number): { upper: number; middle: number; lower: number } | null {
  try {
    return BBANDS(xs, n, mult)
  } catch {
    return null
  }
}

function averageDollarVolume(history: OhlcvBar[], n: number): number | null {
  const s = sortAsc(history)
  if (s.length < n) return null
  const slice = s.slice(-n)
  const avg = slice.reduce((sum, b) => sum + b.close * (b.volume ?? 0), 0) / n
  return Number.isFinite(avg) ? avg : null
}

function pctRank(value: number | null, values: Array<number | null>, opts: { higherIsBetter?: boolean } = {}): number {
  if (value === null || !Number.isFinite(value)) return 50
  const clean = values.filter((v): v is number => v !== null && Number.isFinite(v))
  if (clean.length <= 1) return 50
  const sorted = [...clean].sort((a, b) => a - b)
  const countBelow = sorted.filter((x) => x < value).length
  const countEqual = sorted.filter((x) => x === value).length
  const rank = (countBelow + (countEqual - 1) / 2) / (sorted.length - 1)
  const pct = rank * 100
  return opts.higherIsBetter === false ? 100 - pct : pct
}

function round(n: number | null | undefined, places = 4): number | null {
  if (n == null || !Number.isFinite(n)) return null
  return parseFloat(n.toFixed(places))
}

function scoreRound(n: number): number {
  return parseFloat(Math.max(0, Math.min(100, n)).toFixed(1))
}

interface BaseMetrics {
  symbol: string
  name: string | null
  sector: string | null
  price: number | null
  bars: number
  r1m: number | null
  r3m: number | null
  r6m: number | null
  r12m: number | null
  momentum12_1: number | null
  rsVsSpy6m: number | null
  sma50: number | null
  sma200: number | null
  pctAboveSma200: number | null
  vol63: number | null
  maxDd63: number | null
  avgDollarVolume20: number | null
  rsi2: number | null
  rsi5: number | null
  bbPct: number | null
  fiveDayReturn: number | null
  marketCap: number | null
  peRatio: number | null
  priceToBook: number | null
  evToEbitda: number | null
  roe: number | null
  roic: number | null
  grossMargin: number | null
  operatingMargin: number | null
  debtToEquity: number | null
  revenueGrowth: number | null
  epsGrowth: number | null
  freeCashFlowYield: number | null
}

function baseMetrics(row: SymbolDataset, spyReturn6m: number | null): BaseMetrics {
  const h = sortAsc(row.history)
  const c = closes(h)
  const l = latest(h)
  const r1m = ret(c, 21)
  const r3m = ret(c, 63)
  const r6m = ret(c, 126)
  const r12m = ret(c, 252)
  const sma50 = sma(c, 50)
  const sma200 = sma(c, 200)
  const bb = bbandsSafe(c, 20, 2)
  const price = l?.close ?? null
  const f = row.fundamentals
  return {
    symbol: row.symbol,
    name: row.name ?? f?.name ?? null,
    sector: f?.sector ?? null,
    price,
    bars: h.length,
    r1m,
    r3m,
    r6m,
    r12m,
    momentum12_1: r12m !== null && r1m !== null ? r12m - r1m : null,
    rsVsSpy6m: r6m !== null && spyReturn6m !== null ? r6m - spyReturn6m : null,
    sma50,
    sma200,
    pctAboveSma200: price !== null && sma200 !== null ? price / sma200 - 1 : null,
    vol63: realizedVol(c, 63),
    maxDd63: maxDrawdown(c, 63),
    avgDollarVolume20: averageDollarVolume(h, 20),
    rsi2: rsiSafe(c, 2),
    rsi5: rsiSafe(c, 5),
    bbPct: price !== null && bb && bb.upper !== bb.lower ? (price - bb.lower) / (bb.upper - bb.lower) : null,
    fiveDayReturn: ret(c, 5),
    marketCap: f?.marketCap ?? null,
    peRatio: f?.peRatio ?? null,
    priceToBook: f?.priceToBook ?? null,
    evToEbitda: f?.evToEbitda ?? null,
    roe: f?.roe ?? null,
    roic: f?.roic ?? null,
    grossMargin: f?.grossMargin ?? null,
    operatingMargin: f?.operatingMargin ?? null,
    debtToEquity: f?.debtToEquity ?? null,
    revenueGrowth: f?.revenueGrowth ?? null,
    epsGrowth: f?.epsGrowth ?? null,
    freeCashFlowYield: f?.freeCashFlowYield ?? null,
  }
}

function metricMap(m: BaseMetrics): Record<string, number | null> {
  return {
    return_1m: round(m.r1m),
    return_3m: round(m.r3m),
    return_6m: round(m.r6m),
    return_12m: round(m.r12m),
    momentum_12_1: round(m.momentum12_1),
    rel_strength_vs_spy_6m: round(m.rsVsSpy6m),
    sma50: round(m.sma50, 2),
    sma200: round(m.sma200, 2),
    pct_above_sma200: round(m.pctAboveSma200),
    realized_vol_63d: round(m.vol63),
    max_drawdown_63d: round(m.maxDd63),
    avg_dollar_volume_20d: round(m.avgDollarVolume20, 0),
    rsi2: round(m.rsi2, 1),
    rsi5: round(m.rsi5, 1),
    bollinger_position_20d: round(m.bbPct, 3),
    return_5d: round(m.fiveDayReturn),
    market_cap: round(m.marketCap, 0),
    pe_ratio: round(m.peRatio, 2),
    price_to_book: round(m.priceToBook, 2),
    ev_to_ebitda: round(m.evToEbitda, 2),
    roe: round(m.roe),
    roic: round(m.roic),
    gross_margin: round(m.grossMargin),
    operating_margin: round(m.operatingMargin),
    debt_to_equity: round(m.debtToEquity),
    revenue_growth: round(m.revenueGrowth),
    eps_growth: round(m.epsGrowth),
    free_cash_flow_yield: round(m.freeCashFlowYield),
  }
}

function riskFlags(m: BaseMetrics, opts: { requireTrend?: boolean } = {}): string[] {
  const risks: string[] = []
  if (m.bars < MIN_BARS) risks.push(`short history (${m.bars} bars)`)
  if ((m.avgDollarVolume20 ?? 0) < 50_000_000) risks.push('thin dollar volume')
  if (m.price !== null && m.price < 10) risks.push('low share price')
  if (opts.requireTrend && (m.price === null || m.sma200 === null || m.price < m.sma200)) risks.push('below 200d trend')
  if (m.vol63 !== null && m.vol63 > 0.7) risks.push('high realized volatility')
  if (m.maxDd63 !== null && m.maxDd63 < -0.25) risks.push('deep recent drawdown')
  if (m.peRatio == null && m.roe == null && m.grossMargin == null) risks.push('missing fundamentals')
  // After provider normalization, D/E is a true ratio (e.g. AAPL ~0.8, GS ~6.8).
  // Flag only clearly elevated leverage; banks/financials often sit above 3.
  if (m.debtToEquity !== null && m.debtToEquity > 4) risks.push('high leverage')
  return risks
}

function reasonList(parts: Array<[boolean, string]>): string[] {
  return parts.filter(([ok]) => ok).map(([, msg]) => msg).slice(0, 5)
}

function asOf(datasets: SymbolDataset[], extra: Record<string, OhlcvBar[]>) {
  const dates = [
    ...datasets.flatMap((d) => d.history.map((b) => b.date)),
    ...Object.values(extra).flatMap((h) => h.map((b) => b.date)),
  ].sort()
  return dates.length > 0 ? dates[dates.length - 1] : ''
}

function buildMetrics(datasets: SymbolDataset[], benchmarks: Record<string, OhlcvBar[]>): BaseMetrics[] {
  const spy6m = ret(closes(benchmarks.SPY ?? []), 126)
  return datasets.map((d) => baseMetrics(d, spy6m))
}

function factorScores(metrics: BaseMetrics[]) {
  const vals = {
    mom12_1: metrics.map((m) => m.momentum12_1),
    r6m: metrics.map((m) => m.r6m),
    rs6m: metrics.map((m) => m.rsVsSpy6m),
    roe: metrics.map((m) => m.roe),
    roic: metrics.map((m) => m.roic),
    grossMargin: metrics.map((m) => m.grossMargin),
    operatingMargin: metrics.map((m) => m.operatingMargin),
    debtToEquity: metrics.map((m) => m.debtToEquity),
    revenueGrowth: metrics.map((m) => m.revenueGrowth),
    epsGrowth: metrics.map((m) => m.epsGrowth),
    peRatio: metrics.map((m) => m.peRatio),
    priceToBook: metrics.map((m) => m.priceToBook),
    evToEbitda: metrics.map((m) => m.evToEbitda),
    freeCashFlowYield: metrics.map((m) => m.freeCashFlowYield),
    vol63: metrics.map((m) => m.vol63),
    maxDd63: metrics.map((m) => m.maxDd63),
  }
  return new Map(metrics.map((m) => {
    const momentum = scoreRound(
      0.45 * pctRank(m.momentum12_1, vals.mom12_1) +
      0.35 * pctRank(m.r6m, vals.r6m) +
      0.20 * pctRank(m.rsVsSpy6m, vals.rs6m),
    )
    const quality = scoreRound(
      0.22 * pctRank(m.roe, vals.roe) +
      0.18 * pctRank(m.roic, vals.roic) +
      0.18 * pctRank(m.grossMargin, vals.grossMargin) +
      0.14 * pctRank(m.operatingMargin, vals.operatingMargin) +
      0.14 * pctRank(m.debtToEquity, vals.debtToEquity, { higherIsBetter: false }) +
      0.07 * pctRank(m.revenueGrowth, vals.revenueGrowth) +
      0.07 * pctRank(m.epsGrowth, vals.epsGrowth),
    )
    const value = scoreRound(
      0.28 * pctRank(m.peRatio, vals.peRatio, { higherIsBetter: false }) +
      0.22 * pctRank(m.priceToBook, vals.priceToBook, { higherIsBetter: false }) +
      0.25 * pctRank(m.evToEbitda, vals.evToEbitda, { higherIsBetter: false }) +
      0.25 * pctRank(m.freeCashFlowYield, vals.freeCashFlowYield),
    )
    const volatility = scoreRound(
      0.6 * pctRank(m.vol63, vals.vol63, { higherIsBetter: false }) +
      0.4 * pctRank(m.maxDd63, vals.maxDd63),
    )
    return [m.symbol, { momentum, quality, value, volatility }] as const
  }))
}

export function computeUsRelativeStrengthPool(
  datasets: SymbolDataset[],
  benchmarks: Record<string, OhlcvBar[]>,
  opts: { universe?: UsEquityUniverse; top?: number } = {},
): UsRelativeStrengthPoolResult {
  const metrics = buildMetrics(datasets, benchmarks)
  const scores = factorScores(metrics)
  const ranked = metrics
    .map((m): ScoredEquityRow => {
      const s = scores.get(m.symbol)!
      const trendBonus = m.price !== null && m.sma200 !== null && m.price > m.sma200 ? 10 : -15
      const total = scoreRound(0.72 * s.momentum + 0.18 * s.quality + 0.10 * s.volatility + trendBonus)
      return {
        symbol: m.symbol,
        name: m.name,
        sector: m.sector,
        price: round(m.price, 2),
        scores: { total, momentum: s.momentum, quality: s.quality, value: s.value, volatility: s.volatility },
        metrics: metricMap(m),
        reasons: reasonList([
          [(m.rsVsSpy6m ?? -Infinity) > 0, 'outperforming SPY over 6M'],
          [(m.momentum12_1 ?? -Infinity) > 0, 'positive 12-1 momentum'],
          [m.price !== null && m.sma200 !== null && m.price > m.sma200, 'above 200d trend'],
          [s.quality >= 60, 'quality filter supportive'],
          [s.volatility >= 60, 'volatility profile controlled'],
        ]),
        risks: riskFlags(m, { requireTrend: true }),
        bars: m.bars,
      }
    })
    .filter((r) => r.bars >= 90)
    .sort((a, b) => b.scores.total - a.scores.total)
    .slice(0, opts.top ?? DEFAULT_TOP)

  return {
    asOf: asOf(datasets, benchmarks),
    universe: opts.universe ?? 'sp500_nasdaq100',
    benchmark: 'SPY',
    top: ranked,
    methodology: 'Trend leaders ranked by 12-1 momentum, 6M return, 6M relative strength vs SPY, then lightly filtered by quality and realized-volatility risk. Read-only screen; not an order recommendation.',
  }
}

export function computeUsFactorRank(
  datasets: SymbolDataset[],
  benchmarks: Record<string, OhlcvBar[]>,
  opts: { universe?: UsEquityUniverse; top?: number } = {},
): UsFactorRankResult {
  const metrics = buildMetrics(datasets, benchmarks)
  const scores = factorScores(metrics)
  const ranked = metrics
    .map((m): ScoredEquityRow => {
      const s = scores.get(m.symbol)!
      const total = scoreRound(0.35 * s.momentum + 0.25 * s.quality + 0.15 * s.value + 0.25 * s.volatility)
      return {
        symbol: m.symbol,
        name: m.name,
        sector: m.sector,
        price: round(m.price, 2),
        scores: { total, momentum: s.momentum, quality: s.quality, value: s.value, volatility: s.volatility },
        metrics: metricMap(m),
        reasons: reasonList([
          [s.momentum >= 65, 'strong momentum bucket'],
          [s.quality >= 65, 'quality bucket ranks well'],
          [s.value >= 65, 'valuation bucket ranks well'],
          [s.volatility >= 65, 'lower-volatility bucket ranks well'],
          [(m.avgDollarVolume20 ?? 0) >= 50_000_000, 'liquid enough for screening'],
        ]),
        risks: riskFlags(m),
        bars: m.bars,
      }
    })
    .filter((r) => r.bars >= 90)
    .sort((a, b) => b.scores.total - a.scores.total)
    .slice(0, opts.top ?? DEFAULT_TOP)

  return {
    asOf: asOf(datasets, benchmarks),
    universe: opts.universe ?? 'sp500_nasdaq100',
    top: ranked,
    methodology: 'Composite percentile rank: 35% momentum, 25% quality, 15% value, 25% volatility/drawdown. Missing fundamentals are neutralized and surfaced as risk flags.',
  }
}

export function computeMarketHealth(benchmarks: Record<string, OhlcvBar[]>): MarketHealth {
  const mk = (symbol: 'SPY' | 'QQQ') => {
    const c = closes(benchmarks[symbol] ?? [])
    return {
      close: c.length > 0 ? c[c.length - 1] : null,
      sma50: sma(c, 50),
      sma200: sma(c, 200),
      rsi14: rsiSafe(c, 14),
    }
  }
  const spy = mk('SPY')
  const qqq = mk('QQQ')
  const reasons: string[] = []
  if (spy.close === null || spy.sma200 === null || qqq.close === null || qqq.sma200 === null) {
    return { enabled: false, label: 'insufficient-data', reasons: ['SPY/QQQ trend data unavailable'], spy, qqq }
  }
  if (spy.close > spy.sma200) reasons.push('SPY above 200d')
  else reasons.push('SPY below 200d')
  if (qqq.close > qqq.sma200) reasons.push('QQQ above 200d')
  else reasons.push('QQQ below 200d')
  if (spy.sma50 !== null && spy.sma50 > spy.sma200) reasons.push('SPY 50d above 200d')
  if (qqq.sma50 !== null && qqq.sma50 > qqq.sma200) reasons.push('QQQ 50d above 200d')
  const enabled = spy.close > spy.sma200 && qqq.close > qqq.sma200
  const label = enabled
    ? (spy.sma50 !== null && spy.sma50 > spy.sma200 && qqq.sma50 !== null && qqq.sma50 > qqq.sma200 ? 'healthy' : 'caution')
    : 'unhealthy'
  return { enabled, label, reasons, spy, qqq }
}

export function computeUsMeanReversionPool(
  datasets: SymbolDataset[],
  benchmarks: Record<string, OhlcvBar[]>,
  opts: { universe?: UsEquityUniverse; top?: number } = {},
): UsMeanReversionPoolResult {
  const health = computeMarketHealth(benchmarks)
  const metrics = buildMetrics(datasets, benchmarks)
  const scores = factorScores(metrics)
  const rows = health.enabled
    ? metrics
      .map((m): ScoredEquityRow => {
        const s = scores.get(m.symbol)!
        const trendOk = m.price !== null && m.sma200 !== null && m.sma50 !== null && m.price > m.sma200 && m.sma50 > m.sma200
        const oversold = scoreRound(
          0.35 * pctRank(m.rsi2, metrics.map((x) => x.rsi2), { higherIsBetter: false }) +
          0.25 * pctRank(m.rsi5, metrics.map((x) => x.rsi5), { higherIsBetter: false }) +
          0.25 * pctRank(m.bbPct, metrics.map((x) => x.bbPct), { higherIsBetter: false }) +
          0.15 * pctRank(m.fiveDayReturn, metrics.map((x) => x.fiveDayReturn), { higherIsBetter: false }),
        )
        const pullback = scoreRound(0.55 * oversold + 0.30 * s.momentum + 0.15 * s.quality)
        const total = trendOk ? pullback : scoreRound(pullback * 0.55)
        return {
          symbol: m.symbol,
          name: m.name,
          sector: m.sector,
          price: round(m.price, 2),
          scores: { total, momentum: s.momentum, quality: s.quality, value: s.value, volatility: s.volatility, pullback },
          metrics: metricMap(m),
          reasons: reasonList([
            [trendOk, 'long-term uptrend intact'],
            [(m.rsVsSpy6m ?? -Infinity) > 0, 'still stronger than SPY over 6M'],
            [(m.rsi2 ?? Infinity) < 15, 'RSI(2) oversold'],
            [(m.rsi5 ?? Infinity) < 30, 'RSI(5) washed out'],
            [(m.bbPct ?? Infinity) < 0.15, 'near/below lower Bollinger band'],
          ]),
          risks: riskFlags(m, { requireTrend: true }),
          bars: m.bars,
        }
      })
      .filter((r) => r.bars >= 90 && (r.metrics.pct_above_sma200 ?? -Infinity) > 0)
      .sort((a, b) => b.scores.total - a.scores.total)
      .slice(0, opts.top ?? DEFAULT_TOP)
    : []

  return {
    asOf: asOf(datasets, benchmarks),
    universe: opts.universe ?? 'sp500_nasdaq100',
    marketHealth: health,
    top: rows,
    methodology: 'Mean-reversion candidates are emitted only when SPY and QQQ are above their 200d averages. Within that healthy regime, the screen looks for long-term uptrends with short-term oversold RSI/Bollinger/5D-return signals.',
  }
}

