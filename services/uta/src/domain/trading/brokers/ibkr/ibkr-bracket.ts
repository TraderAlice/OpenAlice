/**
 * IBKR native bracket: parent plus attached opposite-side children, mirroring
 * TWS API `OrderSamples.BracketOrder`. The parent must stay out of the
 * children's OCA group, or its own fill cancels them.
 */

import Decimal from 'decimal.js'
import { Order, UNSET_DECIMAL } from '@traderalice/ibkr'
import { BrokerError, type PlaceOrderLeg, type TpSlParams } from '../types.js'

/** IBKR ocaType 1 = CANCEL_WITH_BLOCK. */
export const IBKR_OCA_CANCEL_WITH_BLOCK = 1

export interface IbkrBracketChild {
  orderId: number
  kind: PlaceOrderLeg['kind']
  order: Order
}

export interface IbkrBracket {
  parentId: number
  parent: Order
  children: IbkrBracketChild[]
}

export function cloneOrder(order: Order): Order {
  return Object.assign(new Order(), order)
}

function exitAction(action: string): 'BUY' | 'SELL' {
  return action === 'BUY' ? 'SELL' : 'BUY'
}

function applySharedChildFields(
  child: Order,
  parent: Order,
  parentId: number,
  ocaGroup: string,
): void {
  child.action = exitAction(parent.action)
  child.parentId = parentId
  child.transmit = false
  child.tif = 'GTC'
  child.ocaGroup = ocaGroup
  child.ocaType = IBKR_OCA_CANCEL_WITH_BLOCK
  child.overridePercentageConstraints = true
  child.totalQuantity = parent.totalQuantity
  // `cashQty` is not forwarded: a notional exit is a different share count
  // than the entry bought, and TWS rejects a notional STP leg (`10244`).
  if (parent.outsideRth) child.outsideRth = true
  if (parent.account) child.account = parent.account
}

/**
 * Refuses a caller OCA group on a bracket entry: the bracket mints its own
 * group for the exits, and the entry has to stay out of it. Call it before the
 * write's try/catch so the error propagates.
 */
export function refuseBracketOcaGroup(parentOrder: Order, tpsl: TpSlParams | undefined): void {
  if (!parentOrder.ocaGroup) return
  if (!tpsl?.takeProfit && !tpsl?.stopLoss) return
  throw new BrokerError(
    'CONFIG',
    `IBKR bracket mints its own OCA group for the exit legs; ocaGroup "${parentOrder.ocaGroup}" cannot be combined with attached TP/SL. ` +
    'Place the entry with ocaGroup and no TP/SL, or let the bracket own its group.',
  )
}

/**
 * Builds a parent plus 1-2 protective children, allocating ids parent-first via
 * `nextOrderId`. Does not mutate `parentOrder`.
 */
export function buildIbkrBracket(
  parentOrder: Order,
  tpsl: TpSlParams,
  nextOrderId: () => number,
): IbkrBracket {
  if (!tpsl.takeProfit && !tpsl.stopLoss) {
    throw new Error('buildIbkrBracket requires takeProfit and/or stopLoss')
  }
  if (parentOrder.totalQuantity.equals(UNSET_DECIMAL) || parentOrder.totalQuantity.lte(0)) {
    throw new Error(
      'IBKR attached TP/SL needs a share totalQuantity on the entry — a monetary-value (cashQty) entry cannot size its protective legs. Place the entry first, then attach STP/LMT protection to the filled quantity.',
    )
  }
  refuseBracketOcaGroup(parentOrder, tpsl)

  const parentId = nextOrderId()
  const parent = cloneOrder(parentOrder)
  parent.orderId = parentId
  parent.transmit = false
  const ocaGroup = `uta-br-${parentId}`
  parent.ocaGroup = ''
  parent.ocaType = 0

  const children: IbkrBracketChild[] = []

  if (tpsl.takeProfit) {
    const orderId = nextOrderId()
    const order = new Order()
    order.orderId = orderId
    order.orderType = 'LMT'
    order.lmtPrice = new Decimal(tpsl.takeProfit.price)
    applySharedChildFields(order, parent, parentId, ocaGroup)
    children.push({ orderId, kind: 'takeProfit', order })
  }

  if (tpsl.stopLoss) {
    const orderId = nextOrderId()
    const order = new Order()
    order.orderId = orderId
    if (tpsl.stopLoss.limitPrice) {
      order.orderType = 'STP LMT'
      order.auxPrice = new Decimal(tpsl.stopLoss.price)
      order.lmtPrice = new Decimal(tpsl.stopLoss.limitPrice)
    } else {
      order.orderType = 'STP'
      order.auxPrice = new Decimal(tpsl.stopLoss.price)
    }
    applySharedChildFields(order, parent, parentId, ocaGroup)
    children.push({ orderId, kind: 'stopLoss', order })
  }

  children[children.length - 1]!.order.transmit = true
  return { parentId, parent, children }
}

/**
 * Same-name OCA with type 0 is ignored by TWS and looks like a second short.
 *
 * The guard is falsiness, not `=== 0`: an `Order` rebuilt from `commit.json`
 * (or any plain object reaching the modify path) can carry `ocaType:
 * undefined`, which the encoder writes as 0 just the same. Matching only the
 * literal 0 would let exactly the rehydrated case through unlinked.
 */
export function applyStandaloneOcaType(order: Order): Order {
  if (order.ocaGroup && !order.ocaType) {
    const clone = cloneOrder(order)
    clone.ocaType = IBKR_OCA_CANCEL_WITH_BLOCK
    return clone
  }
  return order
}
