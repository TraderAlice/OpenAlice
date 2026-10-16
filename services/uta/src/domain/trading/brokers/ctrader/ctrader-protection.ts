/**
 * Position protection and hedged-account order linking for cTrader.
 *
 * Protection legs — cTrader keeps a position's stop-loss and take-profit on
 * the position itself (served by an internal STOP_LOSS_TAKE_PROFIT order),
 * not as standalone orders. UTA, like IBKR, tracks and moves stops as
 * orders. Each protected position is therefore exposed as up to two
 * synthetic orders with stable ids, `sl-<positionId>` and `tp-<positionId>`,
 * that map onto ProtoOAAmendPositionSLTPReq.
 *
 * Reduce linking — on a HEDGED account an order opposite to an open
 * position opens a second, opposite position instead of reducing the first.
 * UTA's model (IBKR) is netting: a SELL against a long reduces it. Such
 * orders are linked to the position they reduce via `positionId`, or
 * refused when no single position can absorb them.
 */

import Decimal from 'decimal.js'
import { Contract, Order, OrderState } from '@traderalice/ibkr'
import type { OpenOrder, PlaceOrderLeg } from '../types.js'
import { PositionStatus, TradeSide, plainPrice, volumeToUnits } from './ctrader-mapping.js'

type Row = Record<string, unknown>

export type LegKind = 'stopLoss' | 'takeProfit'

const LEG_PREFIX: Record<LegKind, string> = { stopLoss: 'sl', takeProfit: 'tp' }

export function legId(kind: LegKind, positionId: number): string {
  return `${LEG_PREFIX[kind]}-${positionId}`
}

export function parseLegId(id: string): { kind: LegKind; positionId: number } | null {
  const m = /^(sl|tp)-(\d+)$/.exec(id)
  if (!m) return null
  const positionId = Number(m[2])
  if (!Number.isSafeInteger(positionId) || positionId <= 0) return null
  return { kind: m[1] === 'sl' ? 'stopLoss' : 'takeProfit', positionId }
}

function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function obj(value: unknown): Row {
  return value && typeof value === 'object' ? (value as Row) : {}
}

/** The fields of a raw ProtoOAPosition the adapter reads. */
export interface RawPositionView {
  positionId: number
  symbolId: number
  side: number
  volume: number
  open: boolean
  openedAt: number
  stopLoss: number | undefined
  takeProfit: number | undefined
}

export function viewPosition(raw: Row): RawPositionView | null {
  const td = obj(raw['tradeData'])
  const positionId = num(raw['positionId'])
  const symbolId = num(td['symbolId'])
  const volume = num(td['volume'])
  if (positionId === undefined || symbolId === undefined || volume === undefined) return null
  return {
    positionId,
    symbolId,
    side: num(td['tradeSide']) ?? TradeSide.BUY,
    volume,
    open: (num(raw['positionStatus']) ?? PositionStatus.OPEN) === PositionStatus.OPEN,
    openedAt: num(td['openTimestamp']) ?? 0,
    stopLoss: num(raw['stopLoss']),
    takeProfit: num(raw['takeProfit']),
  }
}

/**
 * A synthetic protection order. It closes the whole position: SL as a stop
 * (`auxPrice`), TP as a limit (`lmtPrice`). `price` is omitted when the
 * level is no longer known (removed, or position closed).
 */
export function makeLegOrder(params: {
  kind: LegKind
  positionId: number
  positionSide: number
  volume: number
  price: number | undefined
  status: 'Submitted' | 'Filled' | 'Cancelled'
  contract: Contract
  digits: number | undefined
  /** The real exit of a leg that fired: price and volume (cents). */
  fill?: { price: Decimal; volume: number }
}): OpenOrder {
  const order = new Order()
  order.action = params.positionSide === TradeSide.SELL ? 'BUY' : 'SELL'
  order.totalQuantity = volumeToUnits(params.volume)
  order.tif = 'GTC'
  order.orderRef = params.kind === 'stopLoss' ? 'position stop-loss' : 'position take-profit'
  if (params.kind === 'stopLoss') {
    order.orderType = 'STP'
    if (params.price !== undefined) order.auxPrice = new Decimal(plainPrice(params.price, params.digits))
  } else {
    order.orderType = 'LMT'
    if (params.price !== undefined) order.lmtPrice = new Decimal(plainPrice(params.price, params.digits))
  }
  const orderState = new OrderState()
  orderState.status = params.status
  const leg: OpenOrder = { contract: params.contract, order, orderState, orderId: legId(params.kind, params.positionId) }
  if (params.fill) {
    order.filledQuantity = volumeToUnits(params.fill.volume)
    leg.avgFillPrice = plainPrice(params.fill.price.toNumber(), params.digits)
  }
  return leg
}

/** The working protection orders of an open position (none when unprotected). */
export function protectionLegs(position: RawPositionView, contract: Contract, digits: number | undefined): OpenOrder[] {
  if (!position.open) return []
  const legs: OpenOrder[] = []
  for (const kind of ['stopLoss', 'takeProfit'] as const) {
    const price = position[kind]
    if (price === undefined) continue
    legs.push(makeLegOrder({
      kind, positionId: position.positionId, positionSide: position.side, volume: position.volume,
      price, status: 'Submitted', contract, digits,
    }))
  }
  return legs
}

export function legRefs(position: Pick<RawPositionView, 'positionId' | 'stopLoss' | 'takeProfit'>): PlaceOrderLeg[] {
  const legs: PlaceOrderLeg[] = []
  if (position.stopLoss !== undefined) legs.push({ orderId: legId('stopLoss', position.positionId), kind: 'stopLoss' })
  if (position.takeProfit !== undefined) legs.push({ orderId: legId('takeProfit', position.positionId), kind: 'takeProfit' })
  return legs
}

export interface ClosedLeg {
  status: 'Filled' | 'Cancelled'
  /** The leg's level on the protection order, when known. */
  level?: number
  /** Volume-weighted price of the closing deals the leg filled, and their volume in cents. */
  fillPrice?: Decimal
  filledVolume?: number
}

/**
 * How a leg ended once its position is closed. The venue serves both legs
 * with one STOP_LOSS_TAKE_PROFIT order that carries the stop-loss as
 * `stopPrice` and the take-profit as `limitPrice` (Spotware demo,
 * 2026-10-15). The leg 'Filled' when the position's closing deals came from
 * that order and executed nearer this leg's level; the deals give the real
 * exit price. Otherwise 'Cancelled': closed by another order, or by the
 * other leg.
 */
export function settleClosedLeg(kind: LegKind, protection: Row | undefined, closingDeals: Row[]): ClosedLeg {
  const levels: Record<LegKind, number | undefined> = {
    stopLoss: num(protection?.['stopPrice']) ?? num(protection?.['stopLoss']),
    takeProfit: num(protection?.['limitPrice']) ?? num(protection?.['takeProfit']),
  }
  const level = levels[kind]
  const protectionId = num(protection?.['orderId'])
  const fired = protectionId === undefined ? [] : closingDeals.filter((d) => num(d['orderId']) === protectionId)
  let volume = 0
  let notional = new Decimal(0)
  for (const deal of fired) {
    const filled = num(deal['filledVolume']) ?? 0
    const price = num(deal['executionPrice'])
    if (filled <= 0 || price === undefined) continue
    volume += filled
    notional = notional.plus(new Decimal(price).times(filled))
  }
  if (volume === 0) return { status: 'Cancelled', level }
  const fillPrice = notional.div(volume)
  const sl = levels.stopLoss
  const tp = levels.takeProfit
  const firedKind: LegKind = sl === undefined ? 'takeProfit'
    : tp === undefined ? 'stopLoss'
    : fillPrice.minus(sl).abs().lte(fillPrice.minus(tp).abs()) ? 'stopLoss' : 'takeProfit'
  return firedKind === kind ? { status: 'Filled', level, fillPrice, filledVolume: volume } : { status: 'Cancelled', level }
}

export type ReduceDecision =
  | { kind: 'open' }
  | { kind: 'reduce'; positionId: number }
  | { kind: 'refuse'; error: string }

/**
 * Decide how an order relates to the open positions of its symbol on a
 * hedged account. `side` is the order's trade side, `volume` in cents.
 */
export function decideHedgedOrder(
  positions: RawPositionView[],
  symbolName: string,
  side: number,
  volume: number,
): ReduceDecision {
  const open = positions.filter((p) => p.open)
  const opposite = open.filter((p) => p.side !== side).sort((a, b) => a.openedAt - b.openedAt || a.positionId - b.positionId)
  if (opposite.length === 0) return { kind: 'open' }
  if (open.some((p) => p.side === side)) {
    return { kind: 'refuse', error: `Both long and short ${symbolName} positions are open; reduce them with closePosition instead` }
  }
  const total = opposite.reduce((sum, p) => sum + p.volume, 0)
  const units = (v: number) => volumeToUnits(v).toString()
  if (volume > total) {
    return {
      kind: 'refuse',
      error: `This order (${units(volume)} units) is larger than the open ${symbolName} position (${units(total)} units). On a hedged cTrader account the excess would open an opposite position; close the position first, then open the new one.`,
    }
  }
  const target = opposite.find((p) => p.volume >= volume)
  if (!target) {
    return {
      kind: 'refuse',
      error: `No single open ${symbolName} position is large enough for ${units(volume)} units; on a hedged account an order can reduce only one position. Use closePosition, or size the order to one position.`,
    }
  }
  return { kind: 'reduce', positionId: target.positionId }
}
