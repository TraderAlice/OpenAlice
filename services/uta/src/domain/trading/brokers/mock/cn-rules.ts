/**
 * Lightweight A-share paper rules for local CN paper (L2).
 *
 * Not a full exchange simulator — only the constraints that block
 * obviously-invalid closed-loop trades during OpenAlice dry runs.
 */

import Decimal from 'decimal.js'
import type { CnQuoteSnapshot } from './cn-quote.js'

const LOT = 100
/** Sell-side stamp tax (simplified flat rate; ignores minimums / board nuances). */
export const CN_STAMP_TAX_RATE = new Decimal('0.0005')

export function isMultipleOfLot(qty: Decimal): boolean {
  return qty.gt(0) && qty.mod(LOT).eq(0)
}

export const LOT_SIZE = LOT

/** Shanghai calendar weekday session (no holidays calendar in L2). */
export function isCnAshareSessionOpen(now: Date = new Date()): boolean {
  // Asia/Shanghai wall clock via Intl — avoids depending on process TZ.
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now)
  const weekday = parts.find((p) => p.type === 'weekday')?.value
  if (weekday === 'Sat' || weekday === 'Sun') return false
  const hour = Number(parts.find((p) => p.type === 'hour')?.value)
  const minute = Number(parts.find((p) => p.type === 'minute')?.value)
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return false
  const mins = hour * 60 + minute
  // 09:30–11:30, 13:00–15:00
  const morning = mins >= 9 * 60 + 30 && mins < 11 * 60 + 30
  const afternoon = mins >= 13 * 60 && mins < 15 * 60
  return morning || afternoon
}

export function assertLotSize(qty: Decimal): string | null {
  if (!isMultipleOfLot(qty)) {
    return `A-share lot size is ${LOT} shares; got ${qty.toString()}`
  }
  return null
}

export function assertLimitBand(
  side: string,
  price: Decimal,
  quote: CnQuoteSnapshot,
): string | null {
  const up = new Decimal(quote.limitUp)
  const down = new Decimal(quote.limitDown)
  if (price.gt(up) || price.lt(down)) {
    return `Price ${price.toString()} outside ±10% band [${down.toString()}, ${up.toString()}] vs prevClose ${quote.prevClose}`
  }
  // Buy cannot lift through limit-up; sell cannot dump through limit-down at mark.
  const last = new Decimal(quote.last)
  if (side === 'BUY' && last.gte(up) && price.gte(up)) {
    return `Limit-up ${up.toString()} — buy rejected at local paper`
  }
  if (side === 'SELL' && last.lte(down) && price.lte(down)) {
    return `Limit-down ${down.toString()} — sell rejected at local paper`
  }
  return null
}

export function stampTaxOnSell(notional: Decimal): Decimal {
  if (notional.lte(0)) return new Decimal(0)
  return notional.mul(CN_STAMP_TAX_RATE).toDecimalPlaces(2, Decimal.ROUND_UP)
}

/** Trading-day key in Asia/Shanghai (YYYY-MM-DD). */
export function cnTradingDayKey(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
}
