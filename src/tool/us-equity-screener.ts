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

async function getIndexSymbols(indexClient: IndexClientLike | undefined, symbol: string): Promise<string[]> {
  if (!indexClient) return []
  const tries = symbol === 'sp500'
    ? ['sp500', 'sp500_constituent', 'SPY', '^GSPC']
    : ['nasdaq100', 'nasdaq_100', 'QQQ', '^NDX']
  for (const s of tries) {
    try {
      const rows = await indexClient.getConstituents({ symbol: s, provider: 'fmp' })
      const symbols = rows.map((r) => r.symbol).filter((x): x is string => typeof x === 'string')
      if (symbols.length > 0) return uniq(symbols)
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
): Promise<{ symbols: string[]; source: string }> {
  if (universe === 'custom') {
    const symbols = uniq(customSymbols ?? [])
    return { symbols, source: 'custom' }
  }

  const [sp500, nasdaq100] = await Promise.all([
    universe === 'nasdaq100' ? Promise.resolve([]) : getIndexSymbols(indexClient, 'sp500'),
    universe === 'sp500' ? Promise.resolve([]) : getIndexSymbols(indexClient, 'nasdaq100'),
  ])
  const fetched = uniq([...sp500, ...nasdaq100])
  if (fetched.length > 0) return { symbols: fetched, source: 'index-constituents' }

  if (universe === 'nasdaq100') return { symbols: uniq(NASDAQ100_SEED), source: 'static-nasdaq100-seed' }
  if (universe === 'sp500') return { symbols: uniq(CORE_US_GROWTH_AND_QUALITY), source: 'static-largecap-seed' }
  return { symbols: uniq([...CORE_US_GROWTH_AND_QUALITY, ...NASDAQ100_SEED]), source: 'static-sp500-nasdaq100-seed' }
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
  const peRatio = firstNumber(m, ['pe_ratio', 'peRatio']) ?? firstNumber(r, ['price_earnings_ratio', 'pe_ratio', 'peRatio'])
  const fcfYield =
    firstNumber(m, ['free_cash_flow_yield', 'fcf_yield', 'freeCashFlowYield']) ??
    firstNumber(r, ['free_cash_flow_yield', 'fcf_yield', 'freeCashFlowYield'])

  return {
    symbol,
    name: firstString(p, ['name', 'company_name', 'long_name']),
    sector: firstString(p, ['sector']),
    marketCap,
    peRatio,
    priceToBook: firstNumber(m, ['pb_ratio', 'price_to_book', 'priceToBook']) ?? firstNumber(r, ['price_to_book_ratio', 'price_to_book']),
    evToEbitda: firstNumber(m, ['enterprise_value_over_ebitda', 'ev_to_ebitda', 'evToEbitda']) ?? firstNumber(r, ['enterprise_value_over_ebitda']),
    roe: firstNumber(m, ['roe', 'return_on_equity']) ?? firstNumber(r, ['return_on_equity', 'roe']),
    roic: firstNumber(m, ['roic', 'return_on_invested_capital']) ?? firstNumber(r, ['return_on_invested_capital', 'roic']),
    grossMargin: firstNumber(r, ['gross_profit_margin', 'gross_margin']) ?? firstNumber(m, ['gross_margin']),
    operatingMargin: firstNumber(r, ['operating_profit_margin', 'operating_margin']) ?? firstNumber(m, ['operating_margin']),
    debtToEquity: firstNumber(r, ['debt_to_equity', 'debt_equity_ratio']) ?? firstNumber(m, ['debt_to_equity']),
    revenueGrowth: firstNumber(m, ['revenue_growth', 'revenueGrowth']) ?? firstNumber(r, ['revenue_growth']),
    epsGrowth: firstNumber(m, ['eps_growth', 'epsGrowth']) ?? firstNumber(r, ['eps_growth']),
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

  const datasets = histories.map((h) => ({
    symbol: h.symbol,
    name: fMap.get(h.symbol)?.name ?? null,
    history: h.history,
    fundamentals: fMap.get(h.symbol),
  }))

  const [spy, qqq] = await Promise.all([fetchHistory(deps.barService, 'SPY'), fetchHistory(deps.barService, 'QQQ')])
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

