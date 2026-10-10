/**
 * A small multi-asset cTrader account for broker specs: EUR deposit, an FX
 * major, spot gold and an index, two hedged EURUSD longs, one gold short,
 * and two pending orders. Values are in wire encoding.
 */

import { PayloadType } from '../ctrader-protocol.js'
import type { FakeCtraderServer, FakeReply } from './fake-ctrader-server.js'

export const SYMBOL = { EURUSD: 1, XAUUSD: 41, US500: 100, OLD: 7 } as const

/** Sunday 22:00 → Friday 22:00 UTC. */
export const FX_WEEK = [{ startSecond: 22 * 3600, endSecond: 5 * 86_400 + 22 * 3600 }]

export const SPECS: Record<number, Record<string, unknown>> = {
  [SYMBOL.EURUSD]: {
    symbolId: SYMBOL.EURUSD, digits: 5, pipPosition: 4, lotSize: 10_000_000, minVolume: 100_000, maxVolume: 1_000_000_000,
    stepVolume: 100_000, schedule: FX_WEEK, scheduleTimeZone: 'UTC', tradingMode: 0, enableShortSelling: true,
  },
  [SYMBOL.XAUUSD]: {
    symbolId: SYMBOL.XAUUSD, digits: 2, pipPosition: 1, lotSize: 10_000, minVolume: 100, stepVolume: 100,
    schedule: FX_WEEK, scheduleTimeZone: 'UTC', measurementUnits: 'Ounces',
  },
  [SYMBOL.US500]: { symbolId: SYMBOL.US500, digits: 2, pipPosition: 0, lotSize: 100, minVolume: 10, stepVolume: 10 },
}

export const POSITIONS = [
  { positionId: 501, positionStatus: 1, swap: 0, price: 1.1, usedMargin: 5000, moneyDigits: 2,
    tradeData: { symbolId: SYMBOL.EURUSD, volume: 1_000_000, tradeSide: 1 } },
  { positionId: 502, positionStatus: 1, swap: 0, price: 1.12, usedMargin: 0, moneyDigits: 2,
    tradeData: { symbolId: SYMBOL.EURUSD, volume: 3_000_000, tradeSide: 1 } },
  { positionId: 503, positionStatus: 1, swap: 0, price: 4100, usedMargin: 8000, moneyDigits: 2,
    tradeData: { symbolId: SYMBOL.XAUUSD, volume: 200, tradeSide: 2 } },
]

export const ORDERS = [
  { orderId: 9001, orderType: 2, orderStatus: 1, limitPrice: 1.1, timeInForce: 2, clientOrderId: 'alice-1',
    tradeData: { symbolId: SYMBOL.EURUSD, volume: 100_000, tradeSide: 1 } },
  { orderId: 9002, orderType: 6, orderStatus: 1, stopPrice: 4000, slippageInPoints: 50, timeInForce: 1,
    expirationTimestamp: Date.UTC(2026, 9, 16, 21, 0, 0), stopLoss: 4100, takeProfit: 3900,
    tradeData: { symbolId: SYMBOL.XAUUSD, volume: 100, tradeSide: 2, label: 'gold-short' } },
]

/** Spot ticks in wire units (1/100000). */
export const SPOTS: Record<number, { bid: number; ask: number }> = {
  [SYMBOL.EURUSD]: { bid: 112_016, ask: 112_017 },
  [SYMBOL.XAUUSD]: { bid: 419_501_000, ask: 419_521_000 },
}

export function installReadHandlers(server: FakeCtraderServer, options: { spots?: boolean } = {}): void {
  const withAccount = (payloadType: number, payload: Record<string, unknown>): FakeReply => ({
    payloadType,
    payload: { ctidTraderAccountId: 4242, ...payload },
  })

  server.handlers[PayloadType.SYMBOLS_LIST_REQ] = () => withAccount(PayloadType.SYMBOLS_LIST_RES, {
    symbol: [
      { symbolId: SYMBOL.XAUUSD, symbolName: 'XAUUSD', enabled: true, baseAssetId: 3, quoteAssetId: 2, symbolCategoryId: 20, description: 'Gold vs US Dollar', sortingNumber: 5 },
      { symbolId: SYMBOL.EURUSD, symbolName: 'EURUSD', enabled: true, baseAssetId: 1, quoteAssetId: 2, symbolCategoryId: 10, description: 'Euro vs US Dollar', sortingNumber: 1 },
      { symbolId: SYMBOL.US500, symbolName: 'US 500', enabled: true, baseAssetId: 4, quoteAssetId: 2, symbolCategoryId: 30, description: 'US 500 Index', sortingNumber: 9 },
      { symbolId: SYMBOL.OLD, symbolName: 'OLDFX', enabled: false, baseAssetId: 1, quoteAssetId: 2, symbolCategoryId: 10, sortingNumber: 2 },
    ],
  })
  server.handlers[PayloadType.ASSET_LIST_REQ] = () => withAccount(PayloadType.ASSET_LIST_RES, {
    asset: [
      { assetId: 1, name: 'EUR' }, { assetId: 2, name: 'USD' }, { assetId: 3, name: 'XAU' }, { assetId: 4, name: 'US500' },
    ],
  })
  server.handlers[PayloadType.ASSET_CLASS_LIST_REQ] = () => withAccount(PayloadType.ASSET_CLASS_LIST_RES, {
    assetClass: [{ id: 1, name: 'Forex' }, { id: 2, name: 'Metals' }, { id: 3, name: 'Indices' }],
  })
  server.handlers[PayloadType.SYMBOL_CATEGORY_REQ] = () => withAccount(PayloadType.SYMBOL_CATEGORY_RES, {
    symbolCategory: [
      { id: 10, assetClassId: 1, name: 'Majors' },
      { id: 20, assetClassId: 2, name: 'Spot Metals' },
      { id: 30, assetClassId: 3, name: 'Cash Indices' },
    ],
  })
  server.handlers[PayloadType.SYMBOL_BY_ID_REQ] = (p) => withAccount(PayloadType.SYMBOL_BY_ID_RES, {
    symbol: (p['symbolId'] as number[]).map((id) => SPECS[id]).filter(Boolean),
  })
  server.handlers[PayloadType.TRADER_REQ] = () => withAccount(PayloadType.TRADER_RES, {
    trader: { ctidTraderAccountId: 4242, balance: 100_000, moneyDigits: 2, depositAssetId: 1, leverageInCents: 10_000, traderLogin: 1000001 },
  })
  server.handlers[PayloadType.RECONCILE_REQ] = () => withAccount(PayloadType.RECONCILE_RES, { position: POSITIONS, order: ORDERS })
  server.handlers[PayloadType.GET_POSITION_UNREALIZED_PNL_REQ] = () => withAccount(PayloadType.GET_POSITION_UNREALIZED_PNL_RES, {
    moneyDigits: 2,
    positionUnrealizedPnL: [
      { positionId: 501, grossUnrealizedPnL: 9000, netUnrealizedPnL: 8000 },
      { positionId: 502, grossUnrealizedPnL: 8000, netUnrealizedPnL: 7000 },
      { positionId: 503, grossUnrealizedPnL: -16000, netUnrealizedPnL: -17000 },
    ],
  })
  server.handlers[PayloadType.ORDER_DETAILS_REQ] = (p) => {
    const order = ORDERS.find((o) => o.orderId === p['orderId'])
    return order ? withAccount(PayloadType.ORDER_DETAILS_RES, { order, deal: [] }) : { error: 'ORDER_NOT_FOUND' }
  }
  server.handlers[PayloadType.SUBSCRIBE_SPOTS_REQ] = (p) => {
    const ids = p['symbolId'] as number[]
    const replies: FakeReply[] = [withAccount(PayloadType.SUBSCRIBE_SPOTS_RES, {})]
    if (options.spots !== false) {
      for (const id of ids) {
        const spot = SPOTS[id]
        if (spot) replies.push(withAccount(PayloadType.SPOT_EVENT, { symbolId: id, ...spot, timestamp: Date.UTC(2026, 9, 14, 9, 0, 0) }))
      }
    }
    return replies
  }
}
