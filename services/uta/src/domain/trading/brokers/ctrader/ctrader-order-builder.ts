/**
 * Pure translation of UTA (IBKR-shaped) order intents into cTrader
 * ProtoOANewOrderReq / ProtoOAAmendOrderReq payloads, with validation that
 * names the problem before the venue rejects it.
 *
 * Venue rules encoded here (OpenApiMessages.proto):
 *   - volume in cents of base units, on the symbol's step grid
 *   - absolute stopLoss / takeProfit are not accepted on MARKET orders; a
 *     distance from the fill (relativeStopLoss / relativeTakeProfit, in
 *     1/100000 units) is used instead
 *   - STOP_LIMIT carries its limit as slippageInPoints from the stop price
 *   - cTrader has no DAY time in force: a pending DAY order becomes
 *     GOOD_TILL_DATE at the symbol's next session close
 */

import Decimal from 'decimal.js'
import { Order, UNSET_DECIMAL } from '@traderalice/ibkr'
import type { TpSlParams } from '../types.js'
import type { CatalogSymbol, SymbolSpec } from './ctrader-catalog.js'
import {
  OrderType,
  PRICE_SCALE,
  TimeInForce,
  TradeSide,
  TradingMode,
  scheduleClock,
  volumeToUnits,
} from './ctrader-mapping.js'

export type BuildResult<T> = { ok: true; value: T } | { ok: false; error: string }

export interface NewOrderPlan {
  payload: Record<string, unknown>
  isMarket: boolean
  /** Exact protection to apply to the position after a market fill. */
  marketProtection?: { stopLoss?: number; takeProfit?: number }
}

export interface NewOrderInput {
  order: Order
  tpsl?: TpSlParams
  symbol: CatalogSymbol
  spec: SymbolSpec
  /** Current bid/ask; required for market orders with protection. */
  reference?: { bid: Decimal; ask: Decimal }
  clientOrderId: string
  now: Date
}

function isSet(value: Decimal | undefined | null): value is Decimal {
  return value != null && !value.equals(UNSET_DECIMAL)
}

function fail<T>(error: string): BuildResult<T> {
  return { ok: false, error }
}

/** Decimal price → wire double, refusing more precision than the symbol has. */
export function priceOnGrid(price: Decimal, spec: SymbolSpec, what: string, symbolName: string): BuildResult<number> {
  if (!price.isFinite() || price.lte(0)) return fail(`${what} must be a positive price`)
  if (price.decimalPlaces() > spec.digits) {
    return fail(`${what} ${price.toString()} has more decimals than ${symbolName} allows (${spec.digits})`)
  }
  return { ok: true, value: price.toNumber() }
}

/** Units → volume cents on the symbol's grid. */
export function volumeOnGrid(units: Decimal, spec: SymbolSpec, symbolName: string): BuildResult<number> {
  if (!units.isFinite() || units.lte(0)) return fail('Quantity must be greater than zero')
  const cents = units.mul(100)
  if (!cents.isInteger()) return fail(`Quantity ${units.toString()} is finer than 0.01 units`)
  const volume = cents.toNumber()
  const lot = spec.lotSize !== undefined ? ` (1 lot = ${volumeToUnits(spec.lotSize).toString()} units)` : ''
  if (spec.minVolume !== undefined && volume < spec.minVolume) {
    return fail(`Quantity ${units.toString()} is below the ${symbolName} minimum of ${volumeToUnits(spec.minVolume).toString()} units${lot}`)
  }
  if (spec.maxVolume !== undefined && volume > spec.maxVolume) {
    return fail(`Quantity ${units.toString()} is above the ${symbolName} maximum of ${volumeToUnits(spec.maxVolume).toString()} units${lot}`)
  }
  if (spec.stepVolume !== undefined && spec.stepVolume > 0 && volume % spec.stepVolume !== 0) {
    return fail(`Quantity ${units.toString()} is not a multiple of the ${symbolName} step of ${volumeToUnits(spec.stepVolume).toString()} units${lot}`)
  }
  return { ok: true, value: volume }
}

/** "YYYYMMDD HH:mm:ss [UTC]" or "YYYYMMDD-HH:mm:ss" → epoch ms (UTC). */
export function parseGoodTillDate(value: string): number | null {
  const m = /^(\d{4})(\d{2})(\d{2})[ -](\d{2}):(\d{2}):(\d{2})(?:\s+(?:UTC|GMT|Z))?$/.exec(value.trim())
  if (!m) return null
  const [, y, mo, d, h, mi, s] = m.map(Number) as number[]
  const ms = Date.UTC(y!, mo! - 1, d!, h!, mi!, s!)
  return Number.isFinite(ms) ? ms : null
}

/** End of the symbol's current/next session, or end of the UTC day. */
export function dayExpiry(spec: SymbolSpec, now: Date): number {
  const clock = scheduleClock(spec.schedule, spec.scheduleTimeZone, now)
  if (clock.nextClose) return clock.nextClose.getTime()
  if (!clock.isOpen && clock.nextOpen) {
    const reopened = scheduleClock(spec.schedule, spec.scheduleTimeZone, new Date(clock.nextOpen.getTime() + 1000))
    if (reopened.nextClose) return reopened.nextClose.getTime()
  }
  const d = new Date(now)
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 23, 59, 59)
}

interface TifResult {
  timeInForce?: number
  expirationTimestamp?: number
}

export function resolveTimeInForce(order: Order, isMarket: boolean, spec: SymbolSpec, now: Date): BuildResult<TifResult> {
  const tif = (order.tif || '').toUpperCase()
  if (isMarket) {
    switch (tif) {
      case '':
      case 'DAY':
      case 'GTC':
        return { ok: true, value: {} }
      case 'IOC': return { ok: true, value: { timeInForce: TimeInForce.IMMEDIATE_OR_CANCEL } }
      case 'FOK': return { ok: true, value: { timeInForce: TimeInForce.FILL_OR_KILL } }
      case 'OPG': return { ok: true, value: { timeInForce: TimeInForce.MARKET_ON_OPEN } }
      default: return fail(`Time in force "${order.tif}" is not supported for cTrader market orders`)
    }
  }
  switch (tif) {
    case '':
    case 'GTC':
      return { ok: true, value: { timeInForce: TimeInForce.GOOD_TILL_CANCEL } }
    case 'DAY':
      return { ok: true, value: { timeInForce: TimeInForce.GOOD_TILL_DATE, expirationTimestamp: dayExpiry(spec, now) } }
    case 'GTD': {
      const expiry = order.goodTillDate ? parseGoodTillDate(order.goodTillDate) : null
      if (expiry === null) return fail('GTD orders need goodTillDate as "YYYYMMDD HH:mm:ss UTC"')
      if (expiry <= now.getTime()) return fail('goodTillDate is in the past')
      return { ok: true, value: { timeInForce: TimeInForce.GOOD_TILL_DATE, expirationTimestamp: expiry } }
    }
    case 'IOC': return { ok: true, value: { timeInForce: TimeInForce.IMMEDIATE_OR_CANCEL } }
    case 'FOK': return { ok: true, value: { timeInForce: TimeInForce.FILL_OR_KILL } }
    default: return fail(`Time in force "${order.tif}" is not supported for cTrader pending orders`)
  }
}

/** Check that SL/TP sit on the protective side of the entry. */
function checkProtectionSides(
  side: 'BUY' | 'SELL',
  entry: Decimal,
  stopLoss: Decimal | undefined,
  takeProfit: Decimal | undefined,
  entryLabel: string,
): string | null {
  const buy = side === 'BUY'
  if (stopLoss && (buy ? stopLoss.gte(entry) : stopLoss.lte(entry))) {
    return `Stop loss ${stopLoss.toString()} must be ${buy ? 'below' : 'above'} the ${entryLabel} ${entry.toString()} for a ${side.toLowerCase()} order`
  }
  if (takeProfit && (buy ? takeProfit.lte(entry) : takeProfit.gte(entry))) {
    return `Take profit ${takeProfit.toString()} must be ${buy ? 'above' : 'below'} the ${entryLabel} ${entry.toString()} for a ${side.toLowerCase()} order`
  }
  return null
}

export function buildNewOrder(input: NewOrderInput): BuildResult<NewOrderPlan> {
  const { order, tpsl, symbol, spec } = input
  const name = symbol.name

  if (spec.tradingMode !== TradingMode.ENABLED) {
    return fail(spec.tradingMode === TradingMode.CLOSE_ONLY_MODE
      ? `${name} is in close-only mode; new orders are not accepted`
      : `Trading is disabled for ${name}`)
  }
  const side = (order.action || '').toUpperCase()
  if (side !== 'BUY' && side !== 'SELL') return fail(`Order action must be BUY or SELL, got "${order.action}"`)
  // Short-selling permission is left to the venue: on a netting account a
  // SELL may reduce a long, which only the venue can tell apart.
  if (isSet(order.cashQty)) return fail('Cash-quantity orders are not supported by cTrader; give the quantity in units')
  if (!isSet(order.totalQuantity)) return fail('totalQuantity is required')
  const volume = volumeOnGrid(order.totalQuantity, spec, name)
  if (!volume.ok) return volume

  const type = (order.orderType || '').toUpperCase()
  const payload: Record<string, unknown> = {
    symbolId: symbol.symbolId,
    tradeSide: side === 'BUY' ? TradeSide.BUY : TradeSide.SELL,
    volume: volume.value,
    clientOrderId: input.clientOrderId,
  }
  if (order.orderRef) payload['label'] = order.orderRef.slice(0, 100)

  let entry: Decimal | undefined
  let entryLabel = 'entry price'
  switch (type) {
    case 'MKT':
      payload['orderType'] = OrderType.MARKET
      break
    case 'LMT': {
      if (!isSet(order.lmtPrice)) return fail('Limit orders need lmtPrice')
      const p = priceOnGrid(order.lmtPrice, spec, 'Limit price', name)
      if (!p.ok) return p
      payload['orderType'] = OrderType.LIMIT
      payload['limitPrice'] = p.value
      entry = order.lmtPrice
      entryLabel = 'limit price'
      break
    }
    case 'STP': {
      if (!isSet(order.auxPrice)) return fail('Stop orders need auxPrice (the stop trigger)')
      const p = priceOnGrid(order.auxPrice, spec, 'Stop price', name)
      if (!p.ok) return p
      payload['orderType'] = OrderType.STOP
      payload['stopPrice'] = p.value
      entry = order.auxPrice
      entryLabel = 'stop price'
      break
    }
    case 'STP LMT': {
      if (!isSet(order.auxPrice) || !isSet(order.lmtPrice)) return fail('Stop-limit orders need auxPrice (stop) and lmtPrice (limit)')
      const stop = priceOnGrid(order.auxPrice, spec, 'Stop price', name)
      if (!stop.ok) return stop
      const limit = priceOnGrid(order.lmtPrice, spec, 'Limit price', name)
      if (!limit.ok) return limit
      const distance = side === 'BUY' ? order.lmtPrice.minus(order.auxPrice) : order.auxPrice.minus(order.lmtPrice)
      if (distance.lt(0)) {
        return fail(`For a ${side.toLowerCase()} stop-limit the limit must be ${side === 'BUY' ? 'at or above' : 'at or below'} the stop price`)
      }
      payload['orderType'] = OrderType.STOP_LIMIT
      payload['stopPrice'] = stop.value
      payload['slippageInPoints'] = distance.mul(new Decimal(10).pow(spec.digits)).toNumber()
      entry = order.auxPrice
      entryLabel = 'stop price'
      break
    }
    default:
      return fail(`Order type "${order.orderType}" is not supported by cTrader (use MKT, LMT, STP or STP LMT)`)
  }

  const isMarket = type === 'MKT'
  const tif = resolveTimeInForce(order, isMarket, spec, input.now)
  if (!tif.ok) return tif
  if (tif.value.timeInForce !== undefined) payload['timeInForce'] = tif.value.timeInForce
  if (tif.value.expirationTimestamp !== undefined) payload['expirationTimestamp'] = tif.value.expirationTimestamp

  if (tpsl?.stopLoss?.limitPrice) return fail('Stop-limit protection is not supported by cTrader; give a plain stop-loss price')
  const stopLoss = tpsl?.stopLoss ? new Decimal(tpsl.stopLoss.price) : undefined
  const takeProfit = tpsl?.takeProfit ? new Decimal(tpsl.takeProfit.price) : undefined
  if (!stopLoss && !takeProfit) return { ok: true, value: { payload, isMarket } }

  for (const [label, value] of [['Stop loss', stopLoss], ['Take profit', takeProfit]] as const) {
    if (!value) continue
    const p = priceOnGrid(value, spec, label, name)
    if (!p.ok) return p
  }

  if (!isMarket) {
    const problem = checkProtectionSides(side, entry!, stopLoss, takeProfit, entryLabel)
    if (problem) return fail(problem)
    if (stopLoss) payload['stopLoss'] = stopLoss.toNumber()
    if (takeProfit) payload['takeProfit'] = takeProfit.toNumber()
    return { ok: true, value: { payload, isMarket } }
  }

  // Market order: the venue only accepts a distance from the fill price.
  if (!input.reference) return fail(`No current ${name} price to place market-order protection against`)
  const reference = side === 'BUY' ? input.reference.ask : input.reference.bid
  const problem = checkProtectionSides(side, reference, stopLoss, takeProfit, 'current price')
  if (problem) return fail(problem)
  const toRelative = (price: Decimal) => price.minus(reference).abs().mul(PRICE_SCALE).toDecimalPlaces(0).toNumber()
  if (stopLoss) payload['relativeStopLoss'] = toRelative(stopLoss)
  if (takeProfit) payload['relativeTakeProfit'] = toRelative(takeProfit)
  return {
    ok: true,
    value: {
      payload,
      isMarket,
      marketProtection: {
        ...(stopLoss ? { stopLoss: stopLoss.toNumber() } : {}),
        ...(takeProfit ? { takeProfit: takeProfit.toNumber() } : {}),
      },
    },
  }
}

// ==================== amend ====================

export interface AmendInput {
  /** The current order as returned by ORDER_DETAILS. */
  current: {
    orderId: number
    orderType: number
    tradeSide: number
    volume: number
    limitPrice?: number
    stopPrice?: number
    stopLoss?: number
    takeProfit?: number
    timeInForce?: number
    expirationTimestamp?: number
  }
  changes: Partial<Order>
  symbol: CatalogSymbol
  spec: SymbolSpec
  now: Date
}

export function buildAmendOrder(input: AmendInput): BuildResult<Record<string, unknown>> {
  const { current, changes, spec, symbol } = input
  const name = symbol.name
  const payload: Record<string, unknown> = { orderId: current.orderId }
  // Re-send existing protection and expiry so an amend never silently drops
  // them. Observed on the Spotware demo (2026-10-13): an amend without
  // expirationTimestamp turns a GOOD_TILL_DATE order into GOOD_TILL_CANCEL.
  if (current.stopLoss !== undefined) payload['stopLoss'] = current.stopLoss
  if (current.takeProfit !== undefined) payload['takeProfit'] = current.takeProfit
  if (current.timeInForce === TimeInForce.GOOD_TILL_DATE && current.expirationTimestamp !== undefined) {
    payload['expirationTimestamp'] = current.expirationTimestamp
  }

  let changed = false
  if (isSet(changes.totalQuantity)) {
    const volume = volumeOnGrid(changes.totalQuantity, spec, name)
    if (!volume.ok) return volume
    payload['volume'] = volume.value
    changed = true
  }

  const type = current.orderType
  const buy = current.tradeSide !== TradeSide.SELL
  if (isSet(changes.lmtPrice)) {
    const p = priceOnGrid(changes.lmtPrice, spec, 'Limit price', name)
    if (!p.ok) return p
    if (type === OrderType.LIMIT) {
      payload['limitPrice'] = p.value
    } else if (type === OrderType.STOP_LIMIT) {
      const stop = isSet(changes.auxPrice) ? changes.auxPrice : current.stopPrice !== undefined ? new Decimal(current.stopPrice) : undefined
      if (!stop) return fail('Cannot amend the limit of a stop-limit order without its stop price')
      const distance = buy ? changes.lmtPrice.minus(stop) : stop.minus(changes.lmtPrice)
      if (distance.lt(0)) return fail(`For a ${buy ? 'buy' : 'sell'} stop-limit the limit must be ${buy ? 'at or above' : 'at or below'} the stop price`)
      payload['slippageInPoints'] = distance.mul(new Decimal(10).pow(spec.digits)).toNumber()
    } else {
      return fail('lmtPrice can only be changed on limit or stop-limit orders')
    }
    changed = true
  }
  if (isSet(changes.auxPrice)) {
    if (type !== OrderType.STOP && type !== OrderType.STOP_LIMIT) return fail('auxPrice can only be changed on stop or stop-limit orders')
    const p = priceOnGrid(changes.auxPrice, spec, 'Stop price', name)
    if (!p.ok) return p
    payload['stopPrice'] = p.value
    changed = true
  }
  if (changes.tif !== undefined && changes.tif !== '') {
    const probe = Object.assign(new Order(), { tif: changes.tif, goodTillDate: changes.goodTillDate ?? '' })
    const tif = resolveTimeInForce(probe, false, spec, input.now)
    if (!tif.ok) return tif
    if (tif.value.timeInForce !== current.timeInForce) {
      return fail('cTrader can only change the expiry of an order, not switch its time in force')
    }
    if (tif.value.expirationTimestamp !== undefined) {
      payload['expirationTimestamp'] = tif.value.expirationTimestamp
      changed = true
    }
  } else if (changes.goodTillDate) {
    const expiry = parseGoodTillDate(changes.goodTillDate)
    if (expiry === null) return fail('goodTillDate must be "YYYYMMDD HH:mm:ss UTC"')
    payload['expirationTimestamp'] = expiry
    changed = true
  }

  if (!changed) return fail('Nothing to change: give totalQuantity, lmtPrice, auxPrice or a new expiry')
  return { ok: true, value: payload }
}
