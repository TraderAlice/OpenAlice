/**
 * Pure conversions between cTrader Open API encodings and UTA shapes.
 *
 * cTrader wire conventions (OpenApiModelMessages.proto):
 *   - volume: int64 in cents of the base unit (1000 = 10.00 units)
 *   - spot / trendbar prices: integers in 1/100000 of a price unit
 *   - order / position prices: plain doubles
 *   - money: int64 scaled by 10^moneyDigits
 *   - enums: their numeric proto values (JSON mode)
 *
 * Quantities are exposed to UTA in base units, never lots: lot size differs
 * by broker and symbol, units do not.
 */

import Decimal from 'decimal.js'
import type { Bar, BarInterval, MarketClock } from '../types.js'

export const PRICE_SCALE = 100_000

// ==================== numeric encodings ====================

/** 1/100000-scaled integer price → decimal string rounded to the symbol's digits. */
export function scaledPrice(value: number, digits?: number): string {
  const price = new Decimal(value).div(PRICE_SCALE)
  return (digits === undefined ? price : price.toDecimalPlaces(digits)).toString()
}

/** A double price from orders/positions → decimal string rounded to digits. */
export function plainPrice(value: number, digits?: number): string {
  const price = new Decimal(value)
  return (digits === undefined ? price : price.toDecimalPlaces(digits)).toString()
}

/** int64 money scaled by 10^moneyDigits → decimal string. */
export function money(value: number | undefined, moneyDigits: number | undefined): string {
  if (value === undefined) return '0'
  return new Decimal(value).div(new Decimal(10).pow(moneyDigits ?? 2)).toString()
}

/** Volume in cents → base units. */
export function volumeToUnits(volume: number): Decimal {
  return new Decimal(volume).div(100)
}

/** Base units → volume in cents. Throws when the quantity is finer than 0.01 units. */
export function unitsToVolume(units: Decimal): number {
  const cents = units.mul(100)
  if (!cents.isInteger()) throw new Error(`Quantity ${units.toString()} is finer than the venue's 0.01-unit resolution`)
  return cents.toNumber()
}

// ==================== enums ====================

export const TradeSide = { BUY: 1, SELL: 2 } as const

export const OrderType = {
  MARKET: 1,
  LIMIT: 2,
  STOP: 3,
  STOP_LOSS_TAKE_PROFIT: 4,
  MARKET_RANGE: 5,
  STOP_LIMIT: 6,
} as const

export const OrderStatus = {
  ACCEPTED: 1,
  FILLED: 2,
  REJECTED: 3,
  EXPIRED: 4,
  CANCELLED: 5,
} as const

export const PositionStatus = { OPEN: 1, CLOSED: 2, CREATED: 3, ERROR: 4 } as const

export const TimeInForce = {
  GOOD_TILL_DATE: 1,
  GOOD_TILL_CANCEL: 2,
  IMMEDIATE_OR_CANCEL: 3,
  FILL_OR_KILL: 4,
  MARKET_ON_OPEN: 5,
} as const

export const TrendbarPeriod = {
  M1: 1, M2: 2, M3: 3, M4: 4, M5: 5, M10: 6, M15: 7, M30: 8,
  H1: 9, H4: 10, H12: 11, D1: 12, W1: 13, MN1: 14,
} as const

export const TradingMode = {
  ENABLED: 0,
  DISABLED_WITHOUT_PENDINGS_EXECUTION: 1,
  DISABLED_WITH_PENDINGS_EXECUTION: 2,
  CLOSE_ONLY_MODE: 3,
} as const

export function tradeSideToAction(side: number): 'BUY' | 'SELL' {
  return side === TradeSide.SELL ? 'SELL' : 'BUY'
}

/** cTrader order type → IBKR order type string. */
export function orderTypeToIbkr(type: number): string {
  switch (type) {
    case OrderType.MARKET:
    case OrderType.MARKET_RANGE:
      return 'MKT'
    case OrderType.LIMIT:
      return 'LMT'
    case OrderType.STOP:
    case OrderType.STOP_LOSS_TAKE_PROFIT:
      return 'STP'
    case OrderType.STOP_LIMIT:
      return 'STP LMT'
    default:
      return 'MKT'
  }
}

export function timeInForceToIbkr(tif: number | undefined): string {
  switch (tif) {
    case TimeInForce.GOOD_TILL_DATE: return 'GTD'
    case TimeInForce.GOOD_TILL_CANCEL: return 'GTC'
    case TimeInForce.FILL_OR_KILL: return 'FOK'
    case TimeInForce.MARKET_ON_OPEN: return 'OPG'
    case TimeInForce.IMMEDIATE_OR_CANCEL:
    default:
      return 'IOC'
  }
}

/**
 * cTrader order status → IBKR status string. A partially filled order stays
 * ACCEPTED on cTrader, which is still working: Submitted.
 */
export function orderStatusToIbkr(status: number): string {
  switch (status) {
    case OrderStatus.FILLED: return 'Filled'
    case OrderStatus.REJECTED: return 'Inactive'
    case OrderStatus.EXPIRED:
    case OrderStatus.CANCELLED:
      return 'Cancelled'
    case OrderStatus.ACCEPTED:
    default:
      return 'Submitted'
  }
}

/** IBKR goodTillDate format: "YYYYMMDD HH:mm:ss UTC". */
export function formatGoodTillDate(timestampMs: number): string {
  const d = new Date(timestampMs)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} UTC`
}

// ==================== asset classes ====================

export type VenueAssetClass = 'equity' | 'crypto' | 'currency' | 'commodity' | 'unknown'

/**
 * Asset classes and categories are named by each broker. Classify by the
 * common vocabulary rather than per-broker tables.
 */
export function classifyAssetClass(...names: Array<string | undefined>): VenueAssetClass {
  const text = names.filter(Boolean).join(' ').toLowerCase()
  if (!text) return 'unknown'
  if (/crypto|bitcoin|digital/.test(text)) return 'crypto'
  if (/forex|\bfx\b|currenc/.test(text)) return 'currency'
  if (/metal|commodit|energ|agri|soft|oil|gas|gold|silver/.test(text)) return 'commodity'
  if (/stock|share|equit|etf|indic|index|indices/.test(text)) return 'equity'
  return 'unknown'
}

// ==================== bars ====================

export const BAR_INTERVAL_TO_PERIOD: Record<BarInterval, number> = {
  '1m': TrendbarPeriod.M1,
  '5m': TrendbarPeriod.M5,
  '15m': TrendbarPeriod.M15,
  '30m': TrendbarPeriod.M30,
  '1h': TrendbarPeriod.H1,
  '4h': TrendbarPeriod.H4,
  '1d': TrendbarPeriod.D1,
  '1w': TrendbarPeriod.W1,
}

export const BAR_INTERVAL_MS: Record<BarInterval, number> = {
  '1m': 60_000,
  '5m': 300_000,
  '15m': 900_000,
  '30m': 1_800_000,
  '1h': 3_600_000,
  '4h': 14_400_000,
  '1d': 86_400_000,
  '1w': 604_800_000,
}

export interface RawTrendbar {
  volume?: number
  low?: number
  deltaOpen?: number
  deltaClose?: number
  deltaHigh?: number
  utcTimestampInMinutes?: number
}

/** Trendbar (low + deltas, 1/100000-scaled) → Bar. Returns null for incomplete rows. */
export function trendbarToBar(raw: RawTrendbar, digits?: number): Bar | null {
  if (raw.low === undefined || raw.utcTimestampInMinutes === undefined) return null
  const low = raw.low
  return {
    timestamp: new Date(raw.utcTimestampInMinutes * 60_000),
    open: scaledPrice(low + (raw.deltaOpen ?? 0), digits),
    high: scaledPrice(low + (raw.deltaHigh ?? 0), digits),
    low: scaledPrice(low, digits),
    close: scaledPrice(low + (raw.deltaClose ?? 0), digits),
    volume: String(raw.volume ?? 0),
  }
}

// ==================== trading schedule ====================

export interface ScheduleInterval {
  startSecond: number
  endSecond: number
}

const WEEK_SECONDS = 7 * 24 * 3600
const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }

/** Seconds since Sunday 00:00 in the given IANA time zone. */
export function secondsIntoWeek(now: Date, timeZone: string): number {
  let parts: Intl.DateTimeFormatPart[]
  try {
    parts = new Intl.DateTimeFormat('en-US', {
      timeZone, weekday: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    }).formatToParts(now)
  } catch {
    return secondsIntoWeek(now, 'UTC')
  }
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '0'
  const day = WEEKDAYS[get('weekday')] ?? 0
  return day * 86_400 + Number(get('hour')) * 3_600 + Number(get('minute')) * 60 + Number(get('second'))
}

/**
 * Evaluate a weekly schedule (seconds from Sunday 00:00 in `timeZone`).
 * Next open/close are computed from the current week offset, so a DST change
 * inside the coming week can shift them by up to an hour.
 */
export function scheduleClock(schedule: ScheduleInterval[], timeZone: string | undefined, now: Date): MarketClock {
  if (schedule.length === 0) return { isOpen: true, timestamp: now }
  const tz = timeZone || 'UTC'
  const nowSec = secondsIntoWeek(now, tz)
  const weekStartMs = now.getTime() - nowSec * 1000
  const at = (sec: number) => new Date(weekStartMs + sec * 1000)

  const sorted = [...schedule].sort((a, b) => a.startSecond - b.startSecond)
  const current = sorted.find((i) => nowSec >= i.startSecond && nowSec < i.endSecond)
  if (current) {
    return { isOpen: true, nextClose: at(current.endSecond), timestamp: now }
  }
  const next = sorted.find((i) => i.startSecond > nowSec)
  const nextOpen = next ? at(next.startSecond) : at(sorted[0]!.startSecond + WEEK_SECONDS)
  return { isOpen: false, nextOpen, timestamp: now }
}
