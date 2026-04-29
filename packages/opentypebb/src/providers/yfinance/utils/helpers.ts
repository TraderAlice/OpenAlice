/**
 * Yahoo Finance helpers module.
 * Maps to: openbb_yfinance/utils/helpers.py
 *
 * Uses yahoo-finance2 npm package for authenticated access to Yahoo Finance API.
 * The package handles cookie/crumb authentication automatically.
 */

import YahooFinance from 'yahoo-finance2'
import { EmptyDataError } from '../../../core/provider/utils/errors.js'
import { SCREENER_FIELDS } from './references.js'

// Singleton Yahoo Finance instance — reset on persistent failures
let _yf: InstanceType<typeof YahooFinance> | null = null
let _yfFailCount = 0
function getYF(): InstanceType<typeof YahooFinance> {
  if (!_yf || _yfFailCount >= 3) {
    _yf = new YahooFinance({ suppressNotices: ['yahooSurvey'] })
    _yfFailCount = 0
  }
  return _yf
}

function recordYFSuccess(): void { _yfFailCount = 0 }
function recordYFFailure(): void { _yfFailCount++ }

/** Retry a function up to maxRetries times with delay between attempts */
async function withRetry<T>(fn: () => Promise<T>, maxRetries = 2, delayMs = 1000): Promise<T> {
  let lastError: unknown
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn()
    } catch (err) {
      lastError = err
      if (attempt < maxRetries) {
        await new Promise(r => setTimeout(r, delayMs * (attempt + 1)))
      }
    }
  }
  throw lastError
}

/**
 * Get data from Yahoo Finance predefined screener.
 * Uses yahoo-finance2's screener() method with scrIds parameter.
 * Maps to: get_custom_screener() in helpers.py
 *
 * @param scrId - Predefined screener ID: 'day_gainers', 'day_losers', 'most_actives', etc.
 * @param count - Max results to return (default: 250)
 */
export async function getPredefinedScreener(
  scrId: string,
  count = 250,
): Promise<Record<string, unknown>[]> {
  let result: any

  // Screener requires crumb authentication which can become stale in long-running
  // server processes. On failure, reset the YF singleton to force a fresh crumb,
  // then retry once.
  for (let attempt = 0; attempt < 2; attempt++) {
    const yf = getYF()
    try {
      result = await (yf as any).screener({ scrIds: scrId, count })
      recordYFSuccess()
      break
    } catch (err) {
      recordYFFailure()
      if (attempt === 0) {
        // Force singleton reset for fresh crumb on retry
        _yf = null
        _yfFailCount = 0
        await new Promise(r => setTimeout(r, 1000))
        continue
      }
      throw err
    }
  }

  const quotes: any[] = result?.quotes ?? []
  if (!quotes.length) {
    throw new EmptyDataError(`No data found for screener: ${scrId}`)
  }

  // Normalize quotes
  const output: Record<string, unknown>[] = []
  for (const item of quotes) {
    // Format earnings date if available
    if (item.earningsTimestamp) {
      try {
        const ts = typeof item.earningsTimestamp === 'number'
          ? item.earningsTimestamp
          : item.earningsTimestamp instanceof Date
            ? item.earningsTimestamp.getTime() / 1000
            : null
        if (ts) {
          item.earnings_date = new Date(ts * 1000).toISOString().replace('T', ' ').slice(0, 19)
        }
      } catch {
        item.earnings_date = null
      }
    }

    const result: Record<string, unknown> = {}
    for (const k of SCREENER_FIELDS) {
      result[k] = item[k] ?? null
    }

    if (result.regularMarketChange != null && result.regularMarketVolume != null) {
      output.push(result)
    }
  }

  return output
}

/** @deprecated Use getPredefinedScreener instead */
export const getCustomScreener = getPredefinedScreener as any

/**
 * Fetch quote summary data from Yahoo Finance for one symbol.
 * Uses yahoo-finance2's quoteSummary which handles authentication.
 * Maps to: yfinance Ticker.get_info() pattern.
 */
export async function getQuoteSummary(
  symbol: string,
  modules: string[] = ['defaultKeyStatistics', 'summaryDetail', 'summaryProfile', 'financialData', 'price'],
): Promise<Record<string, unknown>> {
  const yf = getYF()

  let result: any
  try {
    result = await withRetry(() => yf.quoteSummary(symbol, { modules: modules as any }))
    recordYFSuccess()
  } catch (err) {
    recordYFFailure()
    throw err
  }

  if (!result) {
    throw new EmptyDataError(`No quote summary data for ${symbol}`)
  }

  // Flatten all modules into a single dict
  const flat: Record<string, unknown> = { symbol }
  for (const [_modName, mod] of Object.entries(result)) {
    if (mod && typeof mod === 'object') {
      for (const [key, value] of Object.entries(mod as Record<string, unknown>)) {
        if (value !== undefined && value !== null) {
          if (value instanceof Date) {
            flat[key] = value.toISOString().slice(0, 10)
          } else if (typeof value !== 'object') {
            flat[key] = value
          } else if (typeof value === 'object' && value !== null && 'raw' in (value as any)) {
            flat[key] = (value as any).raw
          }
          // Skip nested objects (companyOfficers, etc.)
        }
      }
    }
  }

  return flat
}

/**
 * Fetch historical chart data from Yahoo Finance.
 * Uses yahoo-finance2's chart method which handles authentication.
 * Maps to: yf.download() pattern.
 */
export async function getHistoricalData(
  symbol: string,
  options: {
    startDate?: string | null
    endDate?: string | null
    interval?: string
  } = {},
): Promise<Record<string, unknown>[]> {
  const yf = getYF()
  const interval = options.interval ?? '1d'

  const period1 = options.startDate
    ? new Date(options.startDate)
    : new Date(Date.now() - 365 * 24 * 60 * 60 * 1000)

  const period2 = options.endDate
    ? new Date(options.endDate)
    : new Date()

  const chartResult = await withRetry(() => yf.chart(symbol, {
    period1,
    period2,
    interval: interval as any,
  }))

  if (!chartResult?.quotes?.length) {
    throw new EmptyDataError(`No historical data for ${symbol}`)
  }

  const isIntraday = ['1m', '2m', '5m', '15m', '30m', '60m', '90m', '1h'].includes(interval)

  const records: Record<string, unknown>[] = []
  for (const q of chartResult.quotes) {
    if (q.open == null || q.open <= 0) continue

    const date = q.date instanceof Date ? q.date : new Date(q.date as any)
    const dateStr = isIntraday
      ? date.toISOString().replace('T', ' ').slice(0, 19)
      : date.toISOString().slice(0, 10)

    records.push({
      date: dateStr,
      open: q.open ?? null,
      high: q.high ?? null,
      low: q.low ?? null,
      close: q.close ?? null,
      volume: q.volume ?? null,
      ...(q.adjclose != null ? { adj_close: q.adjclose } : {}),
    })
  }

  if (records.length === 0) {
    throw new EmptyDataError(`No valid historical data for ${symbol}`)
  }

  return records
}

/**
 * Search Yahoo Finance for symbols.
 * Used by crypto-search and currency-search models.
 */
export async function searchYahooFinance(
  query: string,
): Promise<Record<string, unknown>[]> {
  const yf = getYF()
  // validateResult: false — Yahoo changed typeDisp casing (e.g. "cryptocurrency" vs
  // "Cryptocurrency"), causing yahoo-finance2's strict schema validation to throw.
  const result: any = await withRetry(() =>
    (yf as any).search(query, { quotesCount: 20, newsCount: 0 }, { validateResult: false }),
  )
  return (result.quotes ?? []) as Record<string, unknown>[]
}

/**
 * Convert a camelCase string to snake_case, preserving acronyms.
 * `EBITDA` → `ebitda` (not `e_b_i_t_d_a`),
 * `totalRevenue` → `total_revenue`,
 * `EBITDAMargin` → `ebitda_margin`.
 *
 * Maps to: openbb_core.provider.utils.helpers.to_snake_case.
 */
function toSnakeCase(s: string): string {
  return s
    // boundary between a run of caps and a following word (EBITDAMargin → EBITDA_Margin)
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    // boundary between a lowercase/digit and an uppercase (totalRevenue → total_Revenue)
    .replace(/([a-z\d])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .replace(/^_/, '')
}

/**
 * Fetch financial statement data from Yahoo Finance via fundamentalsTimeSeries.
 * Used by balance-sheet, income-statement, and cash-flow fetchers.
 *
 * Note: The old quoteSummary modules (balanceSheetHistory, incomeStatementHistory,
 * cashflowStatementHistory) have been deprecated since Nov 2024 and return almost
 * no data. fundamentalsTimeSeries returns ALL financial data fields mixed together.
 *
 * @param symbol - Stock ticker
 * @param period - "annual" or "quarter"
 * @param limit - max periods to return (default: 5)
 */
export async function getFinancialStatements(
  symbol: string,
  period: string,
  limit = 5,
): Promise<Record<string, unknown>[]> {
  const yf = getYF()
  const type = period === 'quarter' ? 'quarterly' : 'annual'

  // Fetch 10 years back for annual, 3 years for quarterly
  const yearsBack = period === 'quarter' ? 3 : 10
  const period1 = new Date()
  period1.setFullYear(period1.getFullYear() - yearsBack)

  let result: any
  try {
    result = await withRetry(() => (yf as any).fundamentalsTimeSeries(symbol, {
      period1: period1.toISOString().slice(0, 10),
      period2: new Date().toISOString().slice(0, 10),
      type,
      module: 'all',
    }))
    recordYFSuccess()
  } catch (err) {
    recordYFFailure()
    throw err
  }

  if (!Array.isArray(result) || result.length === 0) {
    throw new EmptyDataError(`No financial statement data for ${symbol}`)
  }

  // Sort by date descending (most recent first) and apply limit
  const sorted = result.sort((a: any, b: any) => {
    const da = a.date instanceof Date ? a.date.getTime() : new Date(a.date).getTime()
    const db = b.date instanceof Date ? b.date.getTime() : new Date(b.date).getTime()
    return db - da
  })
  const limited = sorted.slice(0, limit)

  // Convert each period's data to snake_case records
  return limited.map((stmt: any) => {
    const record: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(stmt)) {
      // Skip metadata fields
      if (key === 'TYPE') continue
      const snakeKey = toSnakeCase(key)
      if (value instanceof Date) {
        record[snakeKey] = value.toISOString().slice(0, 10)
      } else if (value != null && typeof value === 'object' && 'raw' in (value as any)) {
        record[snakeKey] = (value as any).raw
      } else if (typeof value !== 'object' || value === null) {
        record[snakeKey] = value ?? null
      }
    }
    // Map 'date' → 'period_ending' for standard model
    if (record.date && !record.period_ending) {
      record.period_ending = record.date
      delete record.date
    }
    return record
  })
}

/**
 * Fetch raw (unflattened) quoteSummary modules from Yahoo Finance.
 * Unlike getQuoteSummary(), this preserves nested objects like companyOfficers.
 * Useful for endpoints that need array-type nested data.
 */
export async function getRawQuoteSummary(
  symbol: string,
  modules: string[],
): Promise<Record<string, any>> {
  const yf = getYF()

  let result: any
  try {
    result = await withRetry(() => yf.quoteSummary(symbol, { modules: modules as any }))
    recordYFSuccess()
  } catch (err) {
    recordYFFailure()
    throw err
  }

  if (!result) {
    throw new EmptyDataError(`No quote summary data for ${symbol}`)
  }

  return result
}

/**
 * Fetch historical dividend data from Yahoo Finance using the chart API.
 * Maps to: yfinance Ticker.get_dividends() pattern.
 */
export async function getHistoricalDividends(
  symbol: string,
  startDate?: string | null,
  endDate?: string | null,
): Promise<Record<string, unknown>[]> {
  const yf = getYF()

  const period1 = startDate
    ? new Date(startDate)
    : new Date('1970-01-01')
  const period2 = endDate
    ? new Date(endDate)
    : new Date()

  let result: any
  try {
    result = await withRetry(() => yf.chart(symbol, {
      period1,
      period2,
      interval: '1d',
      events: 'div',
    } as any))
    recordYFSuccess()
  } catch (err) {
    recordYFFailure()
    throw err
  }

  // Extract dividends from events
  const dividends: Record<string, unknown>[] = []
  const events = result?.events
  if (events?.dividends) {
    const divEntries = Array.isArray(events.dividends)
      ? events.dividends
      : Object.values(events.dividends)
    for (const div of divEntries) {
      const date = div.date instanceof Date
        ? div.date.toISOString().slice(0, 10)
        : typeof div.date === 'number'
          ? new Date(div.date * 1000).toISOString().slice(0, 10)
          : String(div.date ?? '').slice(0, 10)
      dividends.push({
        ex_dividend_date: date,
        amount: div.amount ?? div.dividend ?? 0,
      })
    }
  }

  if (!dividends.length) {
    throw new EmptyDataError(`No dividend data found for ${symbol}`)
  }

  // Filter by date range if specified
  let filtered = dividends
  if (startDate) {
    filtered = filtered.filter(d => String(d.ex_dividend_date) >= startDate)
  }
  if (endDate) {
    filtered = filtered.filter(d => String(d.ex_dividend_date) <= endDate)
  }

  return filtered
}

/**
 * Get the list of futures chain symbols from Yahoo Finance.
 * Uses quoteSummary with 'futuresChain' module on the continuation symbol (SYMBOL=F).
 * Maps to: get_futures_symbols() in helpers.py
 */
export async function getFuturesSymbols(symbol: string): Promise<string[]> {
  try {
    const result = await getRawQuoteSummary(`${symbol}=F`, ['futuresChain'] as any)
    const chain: any = (result as any)?.futuresChain
    if (chain?.futures && Array.isArray(chain.futures)) {
      return chain.futures as string[]
    }
  } catch {
    // Fall through to empty
  }
  return []
}

/**
 * Get options chain data from Yahoo Finance for a symbol.
 * Uses yahoo-finance2 options() with retry and instance reset logic.
 */
export async function getOptionsData(
  symbol: string,
  date?: Date | null,
): Promise<any> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const yf = getYF()
    try {
      const result = date
        ? await (yf as any).options(symbol, { date })
        : await (yf as any).options(symbol)
      recordYFSuccess()
      return result
    } catch (err) {
      recordYFFailure()
      if (attempt === 0) {
        // Force singleton reset for fresh crumb on retry
        _yf = null
        _yfFailCount = 0
        await new Promise(r => setTimeout(r, 1000))
        continue
      }
      throw err
    }
  }
}

/**
 * Get news from Yahoo Finance for a symbol.
 */
export async function getYahooNews(
  symbol: string,
  limit = 20,
): Promise<Record<string, unknown>[]> {
  const yf = getYF()
  const result = await withRetry(() => yf.search(symbol, { quotesCount: 0, newsCount: limit }))
  return (result.news ?? []) as Record<string, unknown>[]
}

