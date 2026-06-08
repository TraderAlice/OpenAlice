/**
 * Shared helpers for the TWSE provider's data fetchers.
 *
 * Conventions across TWSE / TPEx open-data endpoints (verified live 2026-06-08):
 * - Dates use the ROC calendar packed as "YYYMMDD" (e.g. "1150605" = 2026-06-05).
 * - All numbers arrive as strings; empty string means "no data". TPEx signs
 *   changes ("+0.06"), TWSE uses plain negatives ("-0.3100").
 * - Symbols follow the Yahoo suffix convention established by EquitySearch:
 *   `2330.TW` (TWSE listed) / `6488.TWO` (TPEx OTC); bare codes match either.
 */

import { amakeRequest } from '../../../core/provider/utils/helpers.js'

export type TwBoard = 'TWSE' | 'TPEX'

export interface ParsedTwSymbol {
  code: string
  /** undefined = no suffix — search both boards. */
  board: TwBoard | undefined
}

export const TW_HEADERS = { Accept: 'application/json' }

/** ROC packed date ("1150605") → ISO ("2026-06-05"). Null on empty/malformed. */
export function rocToIso(value: string | undefined): string | null {
  if (!value || !/^\d{6,7}$/.test(value)) return null
  const rocYear = Number(value.slice(0, value.length - 4))
  const month = value.slice(-4, -2)
  const day = value.slice(-2)
  return `${rocYear + 1911}-${month}-${day}`
}

/** Numeric string → number. Tolerates "+" signs and thousands separators; null on empty/non-numeric. */
export function toNum(value: string | undefined): number | null {
  if (value === undefined) return null
  const cleaned = value.replace(/,/g, '').replace(/^\+/, '').trim()
  if (cleaned === '') return null
  const n = Number(cleaned)
  return Number.isFinite(n) ? n : null
}

/** Split a Yahoo-suffixed Taiwan symbol into code + board. */
export function parseTwSymbol(symbol: string): ParsedTwSymbol {
  const upper = symbol.trim().toUpperCase()
  if (upper.endsWith('.TWO')) return { code: upper.slice(0, -4), board: 'TPEX' }
  if (upper.endsWith('.TW')) return { code: upper.slice(0, -3), board: 'TWSE' }
  return { code: upper, board: undefined }
}

/** Which board-wide snapshot lists must be fetched to resolve these symbols. */
export function boardsNeeded(symbols: ParsedTwSymbol[]): { twse: boolean; tpex: boolean } {
  let twse = false
  let tpex = false
  for (const s of symbols) {
    if (s.board === 'TWSE') twse = true
    else if (s.board === 'TPEX') tpex = true
    else { twse = true; tpex = true }
  }
  return { twse, tpex }
}

/** Yahoo-suffix a code for its board. */
export function toYahooSymbol(code: string, board: TwBoard): string {
  return `${code}.${board === 'TWSE' ? 'TW' : 'TWO'}`
}

/** Parse a comma-separated symbol query into distinct parsed symbols. */
export function parseSymbolList(symbol: string): ParsedTwSymbol[] {
  return symbol.split(',').map((s) => s.trim()).filter(Boolean).map(parseTwSymbol)
}

// ==================== Rate-limited fetch (twseFetch) ====================
//
// The TWSE / TPEx open-data hosts ban callers that exceed ~3 requests per
// 5 seconds. Every TWSE fetcher hits board-wide *snapshot* endpoints
// (STOCK_DAY_ALL, tpex_mainboard_quotes, t187ap03_L, …) that return the
// whole market in one response and only change once per trading day, so the
// right defence is mostly to *not* re-fetch. `twseFetch` wraps `amakeRequest`
// with three layers:
//
//   1. Snapshot cache (URL-keyed, 10-min TTL) + in-flight coalescing — N
//      symbol queries collapse to one network request per board per window.
//   2. Per-host serialized throttle spacing request *starts* by ≥1.7s, so
//      even an all-miss burst stays under 3/5s. TWSE and TPEx are distinct
//      hosts and rate-limited independently, hence per-host.
//   3. Bounded backoff retry, to ride out a transient 429 / network blip.
//
// State is module-level on purpose: it must be shared across every fetcher
// and every concurrent query in the process. Tests reset it via
// `__resetTwseFetch` and substitute clock / sleep / request via
// `__twseFetchInternals`.

const CACHE_TTL_MS = 10 * 60 * 1000 // 10 minutes — EOD snapshots, generous is fine.
const MIN_INTERVAL_MS = 1700 // per-host start-to-start spacing → ≤3 starts / 5s.
const RETRY_BACKOFF_MS = [600, 1800] as const // attempt count = length + 1.

interface CacheEntry {
  at: number
  promise: Promise<unknown>
}

interface TwseFetchOptions {
  headers?: Record<string, string>
  timeoutMs?: number
}

/** Swappable seams so tests avoid real timers / network. */
export const __twseFetchInternals = {
  now: () => Date.now(),
  sleep: (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
  request: <T>(url: string, opts: TwseFetchOptions) => amakeRequest<T>(url, opts),
}

const cache = new Map<string, CacheEntry>()
/** Per-host queue tail — chains requests so their starts are spaced. */
const chainTail = new Map<string, Promise<unknown>>()
/** Per-host timestamp of the last request start (for spacing). */
const lastStart = new Map<string, number>()

/** Clear cache + throttle state. Test-only. */
export function __resetTwseFetch(): void {
  cache.clear()
  chainTail.clear()
  lastStart.clear()
}

function hostOf(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

/** Serialize per host and space request starts by ≥ MIN_INTERVAL_MS. */
function withThrottle<T>(host: string, fn: () => Promise<T>): Promise<T> {
  const prev = chainTail.get(host) ?? Promise.resolve()
  const run = prev
    .catch(() => {}) // a prior failure must not break the queue
    .then(async () => {
      const last = lastStart.get(host)
      const wait = last === undefined ? 0 : MIN_INTERVAL_MS - (__twseFetchInternals.now() - last)
      if (wait > 0) await __twseFetchInternals.sleep(wait)
      lastStart.set(host, __twseFetchInternals.now())
      return fn()
    })
  // Tail tracks completion (success or failure) so the next request waits its turn.
  chainTail.set(host, run.then(() => {}, () => {}))
  return run
}

async function requestWithRetry<T>(url: string, opts: TwseFetchOptions): Promise<T> {
  let lastErr: unknown
  for (let attempt = 0; attempt <= RETRY_BACKOFF_MS.length; attempt++) {
    try {
      return await __twseFetchInternals.request<T>(url, opts)
    } catch (err) {
      lastErr = err
      const backoff = RETRY_BACKOFF_MS[attempt]
      if (backoff !== undefined) await __twseFetchInternals.sleep(backoff)
    }
  }
  throw lastErr
}

/**
 * Rate-limit-aware GET for TWSE / TPEx snapshot endpoints. Drop-in for
 * `amakeRequest` inside this provider. Concurrent callers for the same URL
 * share one in-flight request; results are cached for {@link CACHE_TTL_MS}.
 */
export function twseFetch<T>(url: string, opts: TwseFetchOptions = {}): Promise<T> {
  const cached = cache.get(url)
  if (cached && __twseFetchInternals.now() - cached.at < CACHE_TTL_MS) {
    return cached.promise as Promise<T>
  }

  const promise = withThrottle(hostOf(url), () => requestWithRetry<T>(url, opts))
  cache.set(url, { at: __twseFetchInternals.now(), promise })
  // Never serve a rejected promise from cache — evict on failure so the next
  // caller retries instead of inheriting the error.
  promise.catch(() => {
    if (cache.get(url)?.promise === promise) cache.delete(url)
  })
  return promise
}
