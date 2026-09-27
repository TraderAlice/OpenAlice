/**
 * Lightweight A-share paper rules for local CN paper (L2).
 *
 * Not a full exchange simulator — only the constraints that block
 * obviously-invalid closed-loop trades during OpenAlice dry runs.
 */

import Decimal from 'decimal.js'
import type { CnQuoteSnapshot } from './cn-quote.js'
import { limitPctForBareCode } from './cn-limit.js'

export { isCnAshareSessionOpen, isCnAshareTradingDay } from './cn-calendar.js'
export { limitPctForBareCode, limitBandFromPrevClose } from './cn-limit.js'

const LOT = 100
/** Sell-side stamp tax (simplified flat rate; ignores board nuances). */
export const CN_STAMP_TAX_RATE = new Decimal('0.0005')
/** Simplified commission rate (~万2.5); floored by {@link CN_MIN_COMMISSION}. */
export const CN_COMMISSION_RATE = new Decimal('0.00025')
/** A-share retail minimum commission (CNY). */
export const CN_MIN_COMMISSION = new Decimal(5)

export function isMultipleOfLot(qty: Decimal): boolean {
  return qty.gt(0) && qty.mod(LOT).eq(0)
}

export const LOT_SIZE = LOT

/** @deprecated Prefer {@link assertOrderQty} — buy lot / sell odd-lot aware. */
export function assertLotSize(qty: Decimal): string | null {
  if (!isMultipleOfLot(qty)) {
    return `A-share lot size is ${LOT} shares; got ${qty.toString()}`
  }
  return null
}

/**
 * Buy must be whole lots (100); sell may be odd lots (qty > 0).
 */
export function assertOrderQty(side: string, qty: Decimal): string | null {
  if (!qty.gt(0)) return `Quantity must be positive; got ${qty.toString()}`
  if (side.toUpperCase() === 'BUY' && !isMultipleOfLot(qty)) {
    return `A-share buy lot size is ${LOT} shares; got ${qty.toString()}`
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
  const pct = limitPctForBareCode(quote.code)
  const pctLabel = `${(pct * 100).toFixed(0)}%`
  if (price.gt(up) || price.lt(down)) {
    return `Price ${price.toString()} outside ±${pctLabel} band [${down.toString()}, ${up.toString()}] vs prevClose ${quote.prevClose}`
  }
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

/** Commission on notional (buy or sell), with ¥5 minimum. */
export function commissionOnNotional(notional: Decimal): Decimal {
  if (notional.lte(0)) return new Decimal(0)
  const raw = notional.mul(CN_COMMISSION_RATE).toDecimalPlaces(2, Decimal.ROUND_UP)
  return Decimal.max(raw, CN_MIN_COMMISSION)
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
