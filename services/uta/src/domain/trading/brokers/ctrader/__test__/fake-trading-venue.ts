/**
 * Stateful order handling on top of FakeCtraderServer, for write specs.
 *
 * Market orders fill at ask (buy) / bid (sell) and open a hedged position;
 * fill-relative SL/TP become absolute prices the way the venue applies
 * them. Pending orders rest until amended or cancelled. Replies mirror the
 * venue: the first execution event answers the request, later ones follow.
 */

import { PayloadType } from '../ctrader-protocol.js'
import type { FakeCtraderServer, FakeReply } from './fake-ctrader-server.js'
import { ORDERS, POSITIONS, SPECS, SPOTS } from './ctrader-fixtures.js'

type Row = Record<string, any>

const EXEC = { ACCEPTED: 2, FILLED: 3, REPLACED: 4, CANCELLED: 5, REJECTED: 7, CANCEL_REJECTED: 8 } as const

export interface FakeVenue {
  positions: Row[]
  orders: Row[]
  /** Reject the next order request with this ORDER_ERROR_EVENT code. */
  rejectNext?: string
  /** Create the next order but never answer the request (lost reply). */
  dropNextReply?: boolean
  /** Answer market orders with ACCEPTED only; the fill never follows. */
  holdFills?: boolean
  /** Reject AMEND_POSITION_SLTP_REQ with this code. */
  rejectProtectionAmend?: string
  /** Adverse fill offset for market orders, in price units. */
  fillSlippage?: number
}

export function installTradingVenue(server: FakeCtraderServer): FakeVenue {
  const venue: FakeVenue = {
    positions: structuredClone(POSITIONS) as Row[],
    orders: structuredClone(ORDERS) as Row[],
  }
  let nextOrderId = 9100
  let nextPositionId = 600
  let nextDealId = 7000
  let clock = Date.UTC(2026, 9, 14, 9, 0, 0)
  const exec = (executionType: number, body: Row): FakeReply => ({
    payloadType: PayloadType.EXECUTION_EVENT,
    payload: { ctidTraderAccountId: 4242, executionType, ...body },
  })
  const scale = 100_000

  server.handlers[PayloadType.RECONCILE_REQ] = () => ({
    payloadType: PayloadType.RECONCILE_RES,
    payload: { ctidTraderAccountId: 4242, position: venue.positions, order: venue.orders.filter((o) => o['orderStatus'] === 1) },
  })
  server.handlers[PayloadType.ORDER_DETAILS_REQ] = (p) => {
    const order = venue.orders.find((o) => o['orderId'] === p['orderId'])
    return order ? { payloadType: PayloadType.ORDER_DETAILS_RES, payload: { ctidTraderAccountId: 4242, order, deal: [] } } : { error: 'ORDER_NOT_FOUND' }
  }
  server.handlers[PayloadType.ORDER_LIST_REQ] = () => ({
    payloadType: PayloadType.ORDER_LIST_RES,
    payload: { ctidTraderAccountId: 4242, order: venue.orders, hasMore: false },
  })

  server.handlers[PayloadType.NEW_ORDER_REQ] = (p) => {
    if (venue.rejectNext) {
      const errorCode = venue.rejectNext
      venue.rejectNext = undefined
      return { payloadType: PayloadType.ORDER_ERROR_EVENT, payload: { ctidTraderAccountId: 4242, errorCode, description: 'Not enough funds' } }
    }
    const symbolId = p['symbolId'] as number
    if (!SPECS[symbolId]) return { error: 'SYMBOL_NOT_FOUND' }
    const side = p['tradeSide'] as number
    const tradeData = { symbolId, volume: p['volume'], tradeSide: side, openTimestamp: clock++, ...(p['label'] ? { label: p['label'] } : {}) }
    const order: Row = {
      orderId: nextOrderId++, orderType: p['orderType'], orderStatus: 1, tradeData,
      clientOrderId: p['clientOrderId'], timeInForce: p['timeInForce'] ?? 2, utcLastUpdateTimestamp: clock++,
    }
    for (const key of ['limitPrice', 'stopPrice', 'stopLoss', 'takeProfit', 'expirationTimestamp', 'slippageInPoints']) {
      if (p[key] !== undefined) order[key] = p[key]
    }
    venue.orders.push(order)
    const drop = venue.dropNextReply
    venue.dropNextReply = false
    if (drop) return undefined

    const accepted = exec(EXEC.ACCEPTED, { order: { ...order } })
    if (p['orderType'] !== 1) return accepted
    if (venue.holdFills) return accepted

    const spot = SPOTS[symbolId]!
    const slip = venue.fillSlippage ?? 0
    const price = (side === 1 ? spot.ask : spot.bid) / scale + (side === 1 ? slip : -slip)
    const position: Row = {
      positionId: nextPositionId++, positionStatus: 1, swap: 0, price, usedMargin: 1000, moneyDigits: 2, tradeData: { ...tradeData },
    }
    const sign = side === 1 ? 1 : -1
    const digits = SPECS[symbolId]!['digits'] as number
    const round = (v: number) => Number(v.toFixed(digits))
    if (p['relativeStopLoss'] !== undefined) position['stopLoss'] = round(price - sign * (p['relativeStopLoss'] as number) / scale)
    if (p['relativeTakeProfit'] !== undefined) position['takeProfit'] = round(price + sign * (p['relativeTakeProfit'] as number) / scale)
    venue.positions.push(position)
    order['orderStatus'] = 2
    order['executionPrice'] = price
    order['positionId'] = position['positionId']
    const deal = {
      dealId: nextDealId++, orderId: order['orderId'], positionId: position['positionId'], volume: p['volume'], filledVolume: p['volume'],
      symbolId, executionPrice: price, tradeSide: side, executionTimestamp: clock++, dealStatus: 2,
    }
    return [accepted, exec(EXEC.FILLED, { order: { ...order }, position: { ...position }, deal })]
  }

  server.handlers[PayloadType.AMEND_ORDER_REQ] = (p) => {
    const order = venue.orders.find((o) => o['orderId'] === p['orderId'] && o['orderStatus'] === 1)
    if (!order) return { payloadType: PayloadType.ORDER_ERROR_EVENT, payload: { ctidTraderAccountId: 4242, errorCode: 'ORDER_NOT_FOUND', orderId: p['orderId'] } }
    if (p['volume'] !== undefined) order['tradeData']['volume'] = p['volume']
    for (const key of ['limitPrice', 'stopPrice', 'stopLoss', 'takeProfit', 'expirationTimestamp', 'slippageInPoints']) {
      if (p[key] !== undefined) order[key] = p[key]
    }
    // Real venue (Spotware demo, 2026-10-13): an amend without an expiry
    // turns a GOOD_TILL_DATE order into GOOD_TILL_CANCEL.
    if (p['expirationTimestamp'] === undefined && order['timeInForce'] === 1) {
      order['timeInForce'] = 2
      delete order['expirationTimestamp']
    }
    order['utcLastUpdateTimestamp'] = clock++
    return exec(EXEC.REPLACED, { order: { ...order } })
  }

  server.handlers[PayloadType.CANCEL_ORDER_REQ] = (p) => {
    const order = venue.orders.find((o) => o['orderId'] === p['orderId'])
    if (!order) return { error: 'ORDER_NOT_FOUND' }
    if (order['orderStatus'] !== 1) return exec(EXEC.CANCEL_REJECTED, { order: { ...order }, errorCode: 'UNABLE_TO_CANCEL_ORDER' })
    order['orderStatus'] = 5
    return exec(EXEC.CANCELLED, { order: { ...order } })
  }

  server.handlers[PayloadType.CLOSE_POSITION_REQ] = (p) => {
    const position = venue.positions.find((x) => x['positionId'] === p['positionId'] && x['positionStatus'] === 1)
    if (!position) return { payloadType: PayloadType.ORDER_ERROR_EVENT, payload: { ctidTraderAccountId: 4242, errorCode: 'POSITION_NOT_FOUND', positionId: p['positionId'] } }
    const volume = p['volume'] as number
    const td = position['tradeData']
    if (volume > td['volume']) return { payloadType: PayloadType.ORDER_ERROR_EVENT, payload: { ctidTraderAccountId: 4242, errorCode: 'TRADING_BAD_VOLUME' } }
    const side = td['tradeSide'] === 1 ? 2 : 1
    const spot = SPOTS[td['symbolId']]!
    const price = (side === 1 ? spot.ask : spot.bid) / scale
    const order: Row = {
      orderId: nextOrderId++, orderType: 1, orderStatus: 2, closingOrder: true, positionId: position['positionId'], executionPrice: price,
      tradeData: { symbolId: td['symbolId'], volume, tradeSide: side }, utcLastUpdateTimestamp: clock++,
    }
    venue.orders.push(order)
    td['volume'] -= volume
    if (td['volume'] === 0) position['positionStatus'] = 2
    const deal = {
      dealId: nextDealId++, orderId: order['orderId'], positionId: position['positionId'], volume, filledVolume: volume,
      symbolId: td['symbolId'], executionPrice: price, tradeSide: side, executionTimestamp: clock++, dealStatus: 2,
    }
    return [exec(EXEC.ACCEPTED, { order: { ...order, orderStatus: 1 } }), exec(EXEC.FILLED, { order: { ...order }, position: { ...position }, deal })]
  }

  server.handlers[PayloadType.AMEND_POSITION_SLTP_REQ] = (p) => {
    if (venue.rejectProtectionAmend) {
      return { payloadType: PayloadType.ORDER_ERROR_EVENT, payload: { ctidTraderAccountId: 4242, errorCode: venue.rejectProtectionAmend, positionId: p['positionId'] } }
    }
    const position = venue.positions.find((x) => x['positionId'] === p['positionId'])
    if (!position) return { payloadType: PayloadType.ORDER_ERROR_EVENT, payload: { ctidTraderAccountId: 4242, errorCode: 'POSITION_NOT_FOUND' } }
    if (p['stopLoss'] !== undefined) position['stopLoss'] = p['stopLoss']
    if (p['takeProfit'] !== undefined) position['takeProfit'] = p['takeProfit']
    return exec(EXEC.ACCEPTED, { order: { orderId: nextOrderId++, orderType: 4, orderStatus: 1, tradeData: { ...position['tradeData'] } }, position: { ...position } })
  }

  return venue
}
