/**
 * Yahoo Finance helpers module.
 * Maps to: openbb_yfinance/utils/helpers.py
 *
 * Uses yahoo-finance2 npm package for authenticated access to Yahoo Finance API.
 * The package handles cookie/crumb authentication automatically.
 */

import YahooFinance from 'yahoo-finance2'
import { EmptyDataError, OpenBBError, NetworkUnreachableError, RateLimitedError } from '../../../core/provider/utils/errors.js'
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

/**
 * The HTTP status yahoo-finance2 attaches to its `HTTPError` as `.code`
 * (see yahoo-finance2 lib/yahooFinanceFetch.js: `error.code = response.status`).
 * Returns the numeric status only — string error codes (ENOTFOUND etc.) are
 * not statuses and must not be mistaken for one.
 */
function httpStatusOf(err: unknown): number | undefined {
  const code = (err as { code?: unknown } | null)?.code
  return typeof code === 'number' && code >= 100 && code < 600 ? code : undefined
}

/** Flatten an error (name + message + `.cause` chain) into one searchable string. */
function errorHaystack(err: unknown, depth = 0): string {
  if (err == null || depth > 4) return ''
  if (err instanceof Error) {
    const cause = (err as Error & { cause?: unknown }).cause
    return [err.name, err.message, errorHaystack(cause, depth + 1)].filter(Boolean).join(' ')
  }
  return String(err)
}

/**
 * Translate whatever yahoo-finance2 throws into a typed, self-explanatory error.
 *
 * Yahoo serves the K-line endpoints to the unofficial client behind a
 * crumb/cookie handshake and throttles by IP + request fingerprint. When that
 * throttle trips, the library throws an `HTTPError` with `.code = 429` (or a
 * 401/403 on the crumb step — itself usually a downstream 429). Left raw, those
 * surface as an opaque "Edge: Too Many Requests"; worse, the per-symbol fan-out's
 * `Promise.allSettled` used to swallow them into "No historical data" entirely
 * (issue #375). Map them to errors that say what's actually wrong:
 *   - 429 / "too many requests" / rate-limit  → RateLimitedError (retry / switch source)
 *   - 401 / 403 / crumb / cookie / consent     → RateLimitedError (same Yahoo-block syndrome)
 *   - DNS / TLS / connection failures           → NetworkUnreachableError (do-not-retry)
 *   - anything else                             → passed through unchanged (never masked)
 */
export function classifyYahooFetchError(symbol: string, err: unknown): Error {
  const status = httpStatusOf(err)
  const hay = errorHaystack(err)
  const detail = err instanceof Error ? (err.message || err.name) : String(err)

  if (status === 429 || /too many requests|rate.?limit(ed)?/i.test(hay)) {
    return new RateLimitedError('Yahoo Finance', detail, { symbol, status: status ?? 429, original: err })
  }
  if (status === 401 || status === 403 || /\bcrumb\b|invalid cookie|consent|unauthorized|forbidden/i.test(hay)) {
    return new RateLimitedError('Yahoo Finance', detail, { symbol, status, original: err })
  }
  if (/fetch failed|ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EHOSTUNREACH|ENETUNREACH|socket hang up|UNABLE_TO_VERIFY|SELF_SIGNED/i.test(hay)) {
    return new NetworkUnreachableError('finance.yahoo.com', detail, err)
  }
  return err instanceof Error ? err : new Error(detail)
}

/**
 * Build the error to throw when a per-symbol historical fan-out produced zero
 * rows. The yfinance `*-historical` models fetch each symbol under
 * `Promise.allSettled` and keep only fulfilled rows; when EVERY fetch fails we
 * must surface WHY rather than a bare "no data" (issue #375 — a Yahoo rate-limit
 * failed all symbols and the old generic EmptyDataError masked a transient block
 * as missing history).
 *
 *   - rejections sharing one distinct cause (single symbol, or all symbols hit
 *     the same wall) → re-throw it verbatim so its type + actionable text survive
 *     (a RateLimitedError stays a RateLimitedError).
 *   - rejections with several distinct causes → aggregate the messages.
 *   - no rejections (every fetch resolved empty — defensive; getHistoricalData
 *     throws on empty, so this is unreachable today) → plain EmptyDataError.
 */
export function emptyHistoricalError(
  results: PromiseSettledResult<unknown>[],
  emptyMessage: string,
): Error {
  const failures = results.filter(
    (r): r is PromiseRejectedResult => r.status === 'rejected',
  )
  if (failures.length === 0) return new EmptyDataError(emptyMessage)

  const distinct = [...new Set(
    failures.map((f) => (f.reason instanceof Error ? f.reason.message : String(f.reason))),
  )]
  if (distinct.length === 1) {
    const reason = failures[0].reason
    return reason instanceof Error ? reason : new Error(distinct[0])
  }
  return new OpenBBError(`${emptyMessage}: every symbol failed — ${distinct.join(' | ')}`)
}

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
      // validateResult: false — Yahoo keeps adding fields to the screener
      // response (predefined screeners gained a large includeFields set),
      // tripping yahoo-finance2's strict ScreenerResult schema. Same treatment
      // as search() below. We only read the whitelisted SCREENER_FIELDS anyway.
      // moduleOptions (validateResult) is the THIRD arg — screener(overrides, queryOpts, moduleOpts).
      result = await (yf as any).screener({ scrIds: scrId, count }, undefined, { validateResult: false })
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

    // Derive right-side volume reads while the raw yahoo keys are still present.
    // These snake_case keys aren't in the alias dict, so they pass straight
    // through applyAliases + the schema's passthrough() to the consumer.
    const vol = result.regularMarketVolume
    const avgVol = result.averageDailyVolume3Month
    const sharesOut = result.sharesOutstanding
    const price = result.regularMarketPrice
    result.relative_volume =
      typeof vol === 'number' && typeof avgVol === 'number' && avgVol > 0 ? vol / avgVol : null
    result.turnover =
      typeof vol === 'number' && typeof sharesOut === 'number' && sharesOut > 0
        ? vol / sharesOut
        : null
    // dollar_volume (price × volume) is the cross-ticker-comparable absolute:
    // raw share volume isn't (1M shares means different money at $5 vs $500).
    // This is the unit that aggregates to a sector. relative_volume answers
    // "unusual for itself?"; dollar_volume answers "how much money is here?".
    result.dollar_volume =
      typeof vol === 'number' && typeof price === 'number' ? vol * price : null

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
  })).catch((err: unknown) => {
    // A failed K-line fetch is almost always Yahoo throttling / blocking the
    // unofficial client (HTTP 429 / crumb auth), NOT a symbol with no history.
    // Bump the failure counter so a stale crumb is refreshed on the next call,
    // and rethrow a typed, self-explanatory error instead of letting an opaque
    // "Edge: Too Many Requests" — or, worse, a swallowed "No historical data" —
    // reach the agent (issue #375).
    recordYFFailure()
    throw classifyYahooFetchError(symbol, err)
  })
  recordYFSuccess()

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

