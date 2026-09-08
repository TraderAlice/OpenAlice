/**
 * IBKR historical-bar request mapping and bar decoding. `reqHistoricalData` is
 * anchored at `endDateTime` and reaches backwards by `durationStr`, so a
 * `BarParams` window is converted into that shape and re-bounded locally.
 */

import Decimal from 'decimal.js'
import type { BarData } from '@traderalice/ibkr'
import { UNSET_DECIMAL } from '@traderalice/ibkr'
import { BrokerError, type Bar, type BarInterval, type BarParams } from '../types.js'

/** BarInterval → TWS `barSizeSetting`. */
export const IBKR_BAR_SIZE: Record<BarInterval, string> = {
  '1m': '1 min',
  '5m': '5 mins',
  '15m': '15 mins',
  '30m': '30 mins',
  '1h': '1 hour',
  '4h': '4 hours',
  '1d': '1 day',
  '1w': '1 week',
}

export const IBKR_SUPPORTED_BAR_SIZES = Object.keys(IBKR_BAR_SIZE) as BarInterval[]

const MINUTE_MS = 60_000
const DAY_MS = 86_400_000

const INTERVAL_MS: Record<BarInterval, number> = {
  '1m': MINUTE_MS,
  '5m': 5 * MINUTE_MS,
  '15m': 15 * MINUTE_MS,
  '30m': 30 * MINUTE_MS,
  '1h': 60 * MINUTE_MS,
  '4h': 4 * 60 * MINUTE_MS,
  '1d': DAY_MS,
  '1w': 7 * DAY_MS,
}

/**
 * Per-bar-size duration ceiling, in days, from the TWS "Historical Data
 * Limitations" table. Exceeding it fails the whole request with error 162
 * rather than truncating.
 */
const MAX_DURATION_DAYS: Record<BarInterval, number> = {
  '1m': 1,
  '5m': 7,
  '15m': 7,
  '30m': 30,
  '1h': 30,
  '4h': 30,
  '1d': 365,
  '1w': 730,
}

/** Pad the derived window so an in-progress or partially-formed bar can't eat the request. */
const WINDOW_PADDING_INTERVALS = 2

/**
 * `limit` counts bars while `durationStr` spans calendar time, so reaching back
 * exactly N intervals returns nothing over a weekend. Over-fetching is
 * harmless: `decodeBars` tail-slices to `limit`.
 */
const SESSION_TO_CALENDAR = 4
/** Wide enough to reach back over a weekend plus an adjacent holiday. */
const MIN_INTRADAY_SPAN_MS = 4 * DAY_MS
/** Daily bars are calendar-anchored; only the ~5-trading-days-in-7 cadence. */
const TRADING_DAY_TO_CALENDAR = 1.5

/** Calendar span that should contain `bars` bars of `interval`. */
function calendarSpanFor(bars: number, interval: BarInterval): number {
  const raw = bars * INTERVAL_MS[interval]
  if (interval === '1w') return raw
  if (INTERVAL_MS[interval] >= DAY_MS) return Math.ceil(raw * TRADING_DAY_TO_CALENDAR)
  return Math.max(raw * SESSION_TO_CALENDAR, MIN_INTRADAY_SPAN_MS)
}

/**
 * `TRADES` does not exist for spot FX / metals (`CASH`) or CFDs; TWS answers
 * error 162 rather than substituting a stream.
 */
export function defaultWhatToShow(secType: string): string {
  return secType === 'CASH' || secType === 'CFD' ? 'MIDPOINT' : 'TRADES'
}

export interface IbkrHistoricalRequest {
  endDateTime: string
  durationStr: string
  barSizeSetting: string
  whatToShow: string
  useRTH: number
  formatDate: number
}

/** TWS accepts `yyyyMMdd-HH:mm:ss`, interpreted as UTC when no zone is given. */
export function formatEndDateTime(end: Date): string {
  const iso = end.toISOString() // 2026-09-03T12:34:56.789Z
  return `${iso.slice(0, 4)}${iso.slice(5, 7)}${iso.slice(8, 10)}-${iso.slice(11, 19)}`
}

/**
 * TWS's largest documented `S` bucket is `28800 S` (8 hours). A longer seconds
 * request is an unlisted pairing that TWS answers with 162.
 */
const MAX_SECONDS_SPAN_MS = 28_800_000

/** Days beyond which TWS expects the `Y` unit rather than a very large `D`. */
const MAX_DAYS_SPAN_DAYS = 365

/**
 * Renders a span into a TWS `durationStr`. Unit selection is a correctness
 * constraint: TWS rejects an unlisted (duration unit, bar size) pair with 162.
 */
export function formatDuration(spanMs: number, interval: BarInterval): string {
  const maxMs = MAX_DURATION_DAYS[interval] * DAY_MS
  const clamped = Math.min(Math.max(spanMs, INTERVAL_MS[interval]), maxMs)
  if (clamped <= MAX_SECONDS_SPAN_MS && INTERVAL_MS[interval] < DAY_MS) {
    // Round UP to whole seconds so a sub-second remainder can't drop a bar.
    return `${Math.max(1, Math.ceil(clamped / 1000))} S`
  }
  const days = Math.max(1, Math.ceil(clamped / DAY_MS))
  if (days > MAX_DAYS_SPAN_DAYS) return `${Math.ceil(days / 365)} Y`
  return `${days} D`
}

/**
 * Maps `BarParams` onto the `reqHistoricalData` argument shape. `now` is
 * injected so the derived window is deterministic under test.
 */
export function buildHistoricalRequest(
  params: BarParams,
  now = new Date(),
  secType = '',
): IbkrHistoricalRequest {
  const barSizeSetting = IBKR_BAR_SIZE[params.interval]
  if (!barSizeSetting) {
    throw new BrokerError('EXCHANGE', `IBKR has no native bar size for the ${params.interval} interval`)
  }

  const endMs = params.end?.getTime() ?? now.getTime()
  const limit = params.limit == null ? undefined : Math.max(1, Math.floor(params.limit))

  // Without an explicit window, reach back far enough in calendar time to
  // contain `limit` bars plus padding.
  const spanMs = params.start != null
    ? endMs - params.start.getTime()
    : calendarSpanFor((limit ?? 1) + WINDOW_PADDING_INTERVALS, params.interval)

  return {
    // An empty endDateTime means "now" to TWS. Sending it rather than a
    // formatted clock reading avoids requesting bars from the future when the
    // local clock runs ahead of the gateway's.
    endDateTime: params.end ? formatEndDateTime(params.end) : '',
    durationStr: formatDuration(spanMs, params.interval),
    barSizeSetting,
    whatToShow: params.whatToShow ?? defaultWhatToShow(secType),
    // The session is already resolved per instrument upstream
    // (`resolveBarSession`); an undefined value can only mean a direct adapter
    // call, which takes the continuous tape.
    useRTH: params.session === 'regular' ? 1 : 0,
    // 2 = epoch seconds. Format 1 changes shape with bar size and takes its
    // timezone from gateway settings.
    formatDate: 2,
  }
}

/**
 * `BarData.date` under `formatDate: 2` is epoch seconds. Some gateway builds
 * still return `YYYYMMDD` for daily and weekly bars, so both are accepted.
 */
export function parseBarDate(date: string): Date {
  const trimmed = date.trim()
  if (/^\d{8}$/.test(trimmed)) {
    return new Date(`${trimmed.slice(0, 4)}-${trimmed.slice(4, 6)}-${trimmed.slice(6, 8)}T00:00:00.000Z`)
  }
  const seconds = Number(trimmed)
  if (!Number.isFinite(seconds)) {
    throw new BrokerError('EXCHANGE', `Unparseable IBKR bar date: ${JSON.stringify(date)}`)
  }
  return new Date(seconds * 1000)
}

/**
 * Decodes TWS bars into the protocol shape and re-applies the caller's bounds,
 * because the duration window returns a superset of what was asked for.
 */
export function decodeBars(raw: BarData[], params: BarParams): Bar[] {
  const lowerBound = params.start?.getTime()
  const upperBound = params.end?.getTime()
  const limit = params.limit == null ? undefined : Math.max(1, Math.floor(params.limit))

  const bars: Bar[] = []
  for (const bar of raw) {
    const timestamp = parseBarDate(bar.date)
    const ms = timestamp.getTime()
    if (lowerBound != null && ms < lowerBound) continue
    if (upperBound != null && ms > upperBound) continue
    bars.push({
      timestamp,
      open: String(bar.open),
      high: String(bar.high),
      low: String(bar.low),
      close: String(bar.close),
      // Volume is UNSET or -1 for whatToShow values that carry no size
      // (MIDPOINT, BID, ASK), which means no volume.
      volume: bar.volume == null || bar.volume.equals(UNSET_DECIMAL) || bar.volume.isNegative()
        ? '0'
        : new Decimal(bar.volume).toFixed(),
    })
  }
  bars.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())
  return limit == null ? bars : bars.slice(-limit)
}

/**
 * TWS reports no-data, pacing violations, and genuine query errors under the
 * same code 162, distinguished only by message text. An empty window and a
 * pacing violation are both transient, so neither may disable the account.
 */
export function classifyHistoricalError(err: unknown): 'empty' | 'pacing' | 'error' {
  const msg = err instanceof Error ? err.message : String(err)
  if (!/error 162|historical market data service/i.test(msg)) return 'error'
  if (/pacing violation|too many requests/i.test(msg)) return 'pacing'
  if (/no data|query returned no data|hmds query returned no data/i.test(msg)) return 'empty'
  return 'error'
}
