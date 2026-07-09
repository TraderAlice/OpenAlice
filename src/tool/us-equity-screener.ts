/**
 * US Equity Screener Tools
 *
 * Read-only systematic screens for US equities:
 * - trend leaders (relative strength + quality)
 * - multi-factor rank
 * - healthy-market pullback candidates
 */

import { tool } from 'ai'
import { z } from 'zod'
import type { BarService, OhlcvBar } from '@/domain/market-data/bars/types.js'
import type { EquityClientLike, IndexClientLike } from '@/domain/market-data/client/types.js'
import {
  computeUsFactorRank,
  computeUsMeanReversionPool,
  computeUsRelativeStrengthPool,
  type SymbolDataset,
  type UsEquityFundamentals,
  type UsEquityUniverse,
} from '@/domain/analysis/us-equity-screener.js'

const DEFAULT_LIMIT = 20
const HISTORY_COUNT = 280
const HISTORY_INTERVAL = '1d'
const FETCH_CONCURRENCY = 8
const FUNDAMENTAL_CONCURRENCY = 5

const universeSchema = z.enum(['sp500', 'nasdaq100', 'sp500_nasdaq100', 'custom'])

const CORE_US_GROWTH_AND_QUALITY = [
  'AAPL', 'MSFT', 'NVDA', 'AMZN', 'META', 'GOOGL', 'GOOG', 'AVGO', 'TSLA', 'COST',
  'NFLX', 'AMD', 'ADBE', 'CRM', 'ORCL', 'CSCO', 'INTC', 'QCOM', 'TXN', 'AMAT',
  'LRCX', 'KLAC', 'MU', 'PANW', 'CRWD', 'NOW', 'SHOP', 'INTU', 'ADP', 'CDNS',
  'SNPS', 'ANET', 'LIN', 'LLY', 'UNH', 'JNJ', 'ABBV', 'MRK', 'TMO', 'ABT',
  'ISRG', 'VRTX', 'REGN', 'AMGN', 'GILD', 'DHR', 'JPM', 'V', 'MA', 'BAC',
  'WFC', 'GS', 'MS', 'AXP', 'BLK', 'SCHW', 'BRK.B', 'HD', 'LOW', 'MCD',
  'BKNG', 'NKE', 'SBUX', 'TJX', 'WMT', 'TGT', 'PG', 'KO', 'PEP', 'C',
  'CAT', 'GE', 'HON', 'RTX', 'BA', 'DE', 'LMT', 'XOM', 'CVX', 'COP',
  'SLB', 'EOG', 'NEE', 'DUK', 'SO', 'PLD', 'AMT', 'EQIX',
]

const NASDAQ100_SEED = [
  'AAPL', 'MSFT', 'NVDA', 'AMZN', 'META', 'AVGO', 'GOOGL', 'GOOG', 'TSLA', 'COST',
  'NFLX', 'AMD', 'PEP', 'ADBE', 'CSCO', 'TMUS', 'LIN', 'INTU', 'QCOM', 'TXN',
  'AMAT', 'ISRG', 'AMGN', 'HON', 'BKNG', 'VRTX', 'ADP', 'ADI', 'PANW', 'MU',
  'LRCX', 'SBUX', 'GILD', 'MDLZ', 'KLAC', 'SNPS', 'CDNS', 'MELI', 'CRWD', 'REGN',
  'MAR', 'PYPL', 'ORLY', 'CSX', 'ABNB', 'FTNT', 'NXPI', 'ROP', 'MRVL', 'MNST',
]

function uniq(symbols: string[]): string[] {
  return [...new Set(symbols.map((s) => s.trim().toUpperCase()).filter(Boolean))]
}

function toNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value)
    return Number.isFinite(n) ? n : null
  }
  return null
}

function firstNumber(row: Record<string, unknown> | undefined, keys: string[]): number | null {
  if (!row) return null
  for (const k of keys) {
    const n = toNumber(row[k])
    if (n !== null) return n
  }
  return null
}

function firstString(row: Record<string, unknown> | undefined, keys: string[]): string | null {
  if (!row) return null
  for (const k of keys) {
    const v = row[k]
    if (typeof v === 'string' && v.trim() !== '') return v
  }
  return null
}

/**
 * Normalize debt/equity to a true ratio.
 * Yahoo historically returns percent-scale (79.5 ≈ 0.795×); FMP returns ratios.
 * Values above 20 are almost never genuine non-financial ratios and are treated
 * as percent-scale even if a provider forgot to normalize.
 */
export function normalizeDebtToEquity(value: number | null): number | null {
  if (value === null) return null
  if (!Number.isFinite(value)) return null
  return value > 20 ? value / 100 : value
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = []
  let next = 0
  async function worker() {
    while (next < items.length) {
      const idx = next++
      out[idx] = await fn(items[idx])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return out
}

async function getIndexConstituents(
  indexClient: IndexClientLike | undefined,
  symbol: string,
): Promise<Array<{ symbol: string; name: string | null }>> {
  if (!indexClient) return []
  const tries = symbol === 'sp500'
    ? ['sp500', 'sp500_constituent', 'SPY', '^GSPC']
    : ['nasdaq100', 'nasdaq_100', 'QQQ', '^NDX']
  for (const s of tries) {
    try {
      const rows = await indexClient.getConstituents({ symbol: s, provider: 'fmp' })
      const out = rows
        .map((r) => {
          const sym = typeof r.symbol === 'string' ? r.symbol.trim().toUpperCase() : ''
          if (!sym) return null
          const name = typeof (r as { name?: unknown }).name === 'string'
            ? ((r as { name: string }).name.trim() || null)
            : null
          return { symbol: sym, name }
        })
        .filter((x): x is { symbol: string; name: string | null } => x !== null)
      if (out.length > 0) return out
    } catch {
      /* try next alias */
    }
  }
  return []
}

async function resolveUniverse(
  universe: UsEquityUniverse,
  customSymbols: string[] | undefined,
  indexClient: IndexClientLike | undefined,
): Promise<{ symbols: string[]; source: string; names: Map<string, string> }> {
  const names = new Map<string, string>()
  if (universe === 'custom') {
    const symbols = uniq(customSymbols ?? [])
    return { symbols, source: 'custom', names }
  }

  const [sp500, nasdaq100] = await Promise.all([
    universe === 'nasdaq100' ? Promise.resolve([]) : getIndexConstituents(indexClient, 'sp500'),
    universe === 'sp500' ? Promise.resolve([]) : getIndexConstituents(indexClient, 'nasdaq100'),
  ])
  for (const row of [...sp500, ...nasdaq100]) {
    if (row.name && !names.has(row.symbol)) names.set(row.symbol, row.name)
  }
  const fetched = uniq([...sp500, ...nasdaq100].map((r) => r.symbol))
  if (fetched.length > 0) return { symbols: fetched, source: 'index-constituents', names }

  if (universe === 'nasdaq100') return { symbols: uniq(NASDAQ100_SEED), source: 'static-nasdaq100-seed', names }
  if (universe === 'sp500') return { symbols: uniq(CORE_US_GROWTH_AND_QUALITY), source: 'static-largecap-seed', names }
  return { symbols: uniq([...CORE_US_GROWTH_AND_QUALITY, ...NASDAQ100_SEED]), source: 'static-sp500-nasdaq100-seed', names }
}

async function fetchHistory(barService: BarService, symbol: string): Promise<OhlcvBar[]> {
  try {
    const res = await barService.getBars(
      { symbol, assetClass: 'equity' },
      { interval: HISTORY_INTERVAL, count: HISTORY_COUNT },
    )
    return res.bars
  } catch {
    return []
  }
}

async function fetchFundamentals(equityClient: EquityClientLike, symbol: string): Promise<UsEquityFundamentals> {
  const [profile, metrics, ratios] = await Promise.all([
    equityClient.getProfile({ symbol }).catch(() => []),
    equityClient.getKeyMetrics({ symbol, limit: 1 }).catch(() => []),
    equityClient.getFinancialRatios({ symbol, limit: 1 }).catch(() => []),
  ])
  const p = profile[0] as Record<string, unknown> | undefined
  const m = metrics[0] as Record<string, unknown> | undefined
  const r = ratios[0] as Record<string, unknown> | undefined

  const marketCap = firstNumber(m, ['market_cap', 'marketCap']) ?? firstNumber(p, ['market_cap', 'marketCap'])
  // Yahoo key-metrics uses price_to_earnings / gross_profit_margin; FMP ratios
  // use pe_ratio / gross_profit_margin. Accept both so a missing FMP key doesn't
  // blank out every PE/margin and trip "missing fundamentals".
  const peRatio =
    firstNumber(m, ['price_to_earnings', 'pe_ratio', 'peRatio', 'forward_pe']) ??
    firstNumber(r, ['price_earnings_ratio', 'pe_ratio', 'peRatio', 'price_to_earnings'])
  const fcfYield =
    firstNumber(m, ['free_cash_flow_yield', 'fcf_yield', 'freeCashFlowYield']) ??
    firstNumber(r, ['free_cash_flow_yield', 'fcf_yield', 'freeCashFlowYield'])

  return {
    symbol,
    name: firstString(p, ['name', 'company_name', 'long_name']),
    sector: firstString(p, ['sector']),
    marketCap,
    peRatio,
    priceToBook:
      firstNumber(m, ['price_to_book', 'pb_ratio', 'priceToBook']) ??
      firstNumber(r, ['price_to_book_ratio', 'price_to_book']),
    evToEbitda:
      firstNumber(m, ['ev_to_ebitda', 'enterprise_value_over_ebitda', 'evToEbitda']) ??
      firstNumber(r, ['enterprise_value_over_ebitda', 'ev_to_ebitda']),
    roe: firstNumber(m, ['return_on_equity', 'roe']) ?? firstNumber(r, ['return_on_equity', 'roe']),
    roic:
      firstNumber(m, ['return_on_invested_capital', 'roic']) ??
      firstNumber(r, ['return_on_invested_capital', 'roic']),
    grossMargin:
      firstNumber(m, ['gross_profit_margin', 'gross_margin']) ??
      firstNumber(r, ['gross_profit_margin', 'gross_margin']),
    operatingMargin:
      firstNumber(m, ['operating_profit_margin', 'operating_margin']) ??
      firstNumber(r, ['operating_profit_margin', 'operating_margin']),
    debtToEquity: normalizeDebtToEquity(
      firstNumber(r, ['debt_to_equity', 'debt_equity_ratio']) ?? firstNumber(m, ['debt_to_equity']),
    ),
    revenueGrowth:
      firstNumber(m, ['revenue_growth', 'revenueGrowth']) ?? firstNumber(r, ['revenue_growth']),
    epsGrowth:
      firstNumber(m, ['earnings_growth', 'eps_growth', 'epsGrowth']) ??
      firstNumber(r, ['eps_growth', 'earnings_growth']),
    freeCashFlowYield: fcfYield,
  }
}

async function buildDatasets(
  deps: { equityClient: EquityClientLike; indexClient?: IndexClientLike; barService: BarService },
  input: { universe: UsEquityUniverse; customSymbols?: string[]; maxSymbols?: number },
): Promise<{ datasets: SymbolDataset[]; benchmarks: Record<string, OhlcvBar[]>; universeSource: string; symbolCount: number }> {
  const resolved = await resolveUniverse(input.universe, input.customSymbols, deps.indexClient)
  const symbols = (input.maxSymbols ? resolved.symbols.slice(0, input.maxSymbols) : resolved.symbols)
  const histories = await mapLimit(symbols, FETCH_CONCURRENCY, async (symbol) => ({ symbol, history: await fetchHistory(deps.barService, symbol) }))

  // Fetch fundamentals for symbols that at least have usable price history.
  const withBars = histories.filter((h) => h.history.length >= 90)
  const fundamentals = await mapLimit(withBars, FUNDAMENTAL_CONCURRENCY, async ({ symbol }) => [symbol, await fetchFundamentals(deps.equityClient, symbol)] as const)
  const fMap = new Map(fundamentals)

  const datasets = histories.map((h) => {
    const f = fMap.get(h.symbol)
    const name = f?.name ?? resolved.names.get(h.symbol) ?? null
    return {
      symbol: h.symbol,
      name,
      history: h.history,
      fundamentals: f
        ? { ...f, name: f.name ?? name }
        : name
          ? { symbol: h.symbol, name }
          : undefined,
    }
  })

  const [spy, qqq] = await Promise.all([fetchHistory(deps.barService, 'SPY'), fetchHistory(deps.barService, 'QQQ')])
  if (spy.length < 127) {
    console.warn(
      `[us-screener] SPY history too short for 6M relative strength (${spy.length} bars); RS vs SPY will be n/a`,
    )
  }
  return {
    datasets,
    benchmarks: { SPY: spy, QQQ: qqq },
    universeSource: resolved.source,
    symbolCount: resolved.symbols.length,
  }
}

export function createUsEquityScreenerTools(
  equityClient: EquityClientLike,
  barService: BarService,
  indexClient?: IndexClientLike,
) {
  const deps = { equityClient, barService, indexClient }
  const commonSchema = z.object({
    universe: universeSchema.optional().default('sp500_nasdaq100').describe('Stock universe to scan. custom requires symbols.'),
    symbols: z.array(z.string()).optional().describe('Custom symbols when universe="custom".'),
    limit: z.number().int().positive().max(50).optional().default(DEFAULT_LIMIT),
    maxSymbols: z.number().int().positive().max(700).optional().describe('Debug/performance cap; omit for the full resolved universe.'),
  })

  return {
    usRelativeStrengthPool: tool({
      description: `Find US trend leaders: S&P 500 / Nasdaq 100 relative strength plus quality and volatility filters.

Returns the Top N ranked candidates with reasons and risk flags. This is read-only research:
it does not stage or place orders. Defaults to the merged S&P 500 + Nasdaq 100 universe,
uses SPY as the relative-strength benchmark, and falls back to a static large-cap seed
if index constituents are unavailable.`,
      inputSchema: commonSchema.meta({ examples: [{ universe: 'sp500_nasdaq100', limit: 20 }] }),
      execute: async ({ universe, symbols, limit, maxSymbols }) => {
        const built = await buildDatasets(deps, { universe, customSymbols: symbols, maxSymbols })
        return {
          ...computeUsRelativeStrengthPool(built.datasets, built.benchmarks, { universe, top: limit }),
          universeSource: built.universeSource,
          symbolCount: built.symbolCount,
        }
      },
    }),

    usFactorRank: tool({
      description: `Rank US equities by a multi-factor model with explicit sub-scores:
momentum, quality, value, and volatility/drawdown.

The composite is 35% momentum, 25% quality, 15% value, 25% volatility. Missing
fundamentals are treated neutrally and surfaced as risk flags instead of being
silently treated as good data. Read-only research; no orders.`,
      inputSchema: commonSchema.meta({ examples: [{ universe: 'nasdaq100', limit: 20 }] }),
      execute: async ({ universe, symbols, limit, maxSymbols }) => {
        const built = await buildDatasets(deps, { universe, customSymbols: symbols, maxSymbols })
        return {
          ...computeUsFactorRank(built.datasets, built.benchmarks, { universe, top: limit }),
          universeSource: built.universeSource,
          symbolCount: built.symbolCount,
        }
      },
    }),

    usMeanReversionPool: tool({
      description: `Find short-term pullback candidates only when the broad market is healthy.

Market gate: SPY and QQQ must both be above their 200-day moving averages. Candidates
must still be in long-term uptrends, then rank by RSI/Bollinger/5-day oversold state
plus relative-strength and quality context. If the market gate fails, returns no
candidates and explains why. Read-only research; no orders.`,
      inputSchema: commonSchema.meta({ examples: [{ universe: 'sp500_nasdaq100', limit: 20 }] }),
      execute: async ({ universe, symbols, limit, maxSymbols }) => {
        const built = await buildDatasets(deps, { universe, customSymbols: symbols, maxSymbols })
        return {
          ...computeUsMeanReversionPool(built.datasets, built.benchmarks, { universe, top: limit }),
          universeSource: built.universeSource,
          symbolCount: built.symbolCount,
        }
      },
    }),
  }
}

