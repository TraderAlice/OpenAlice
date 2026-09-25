import { describe, expect, it } from 'vitest'
import ccxt from 'ccxt'

/** The swap fields ccxt's okx editOrderRequest reads before it builds newSz/newPx. */
const ETH_SWAP = {
  id: 'ETH-USDT-SWAP',
  symbol: 'ETH/USDT:USDT',
  base: 'ETH',
  quote: 'USDT',
  settle: 'USDT',
  baseId: 'ETH',
  quoteId: 'USDT',
  settleId: 'USDT',
  type: 'swap',
  spot: false,
  margin: false,
  swap: true,
  future: false,
  option: false,
  contract: true,
  linear: true,
  inverse: false,
  contractSize: 0.1,
  active: true,
  precision: { amount: 0.01, price: 0.01 },
  limits: { amount: { min: 0.01 }, price: {} },
  info: {},
}

const BTC_SPOT = {
  id: 'BTC-USDT',
  symbol: 'BTC/USDT',
  base: 'BTC',
  quote: 'USDT',
  baseId: 'BTC',
  quoteId: 'USDT',
  type: 'spot',
  spot: true,
  margin: false,
  swap: false,
  future: false,
  option: false,
  contract: false,
  active: true,
  precision: { amount: 0.00001, price: 0.01 },
  limits: { amount: { min: 0.00001 }, price: {} },
  info: {},
}

function exchangeWithMarket(symbol: string, market: Record<string, unknown>) {
  const exchange = new ccxt.okx({ apiKey: 'k', secret: 's', password: 'p' })
  ;(exchange as unknown as { markets: Record<string, unknown> }).markets = { [symbol]: market }
  return exchange
}

function editBody(params: Record<string, unknown> = {}): Record<string, unknown> {
  const exchange = exchangeWithMarket('ETH/USDT:USDT', ETH_SWAP)
  return (exchange as unknown as {
    editOrderRequest: (...args: unknown[]) => Record<string, unknown>
  }).editOrderRequest('okx-edit-3', 'ETH/USDT:USDT', 'limit', 'sell', 2, 2600, params)
}

function createBody(params: Record<string, unknown> = {}): Record<string, unknown> {
  const exchange = exchangeWithMarket('ETH/USDT:USDT', ETH_SWAP)
  return (exchange as unknown as {
    createOrderRequest: (...args: unknown[]) => Record<string, unknown>
  }).createOrderRequest('ETH/USDT:USDT', 'limit', 'buy', 1, 2500, params)
}

function createSpotBody(params: Record<string, unknown>): Record<string, unknown> {
  const exchange = exchangeWithMarket('BTC/USDT', BTC_SPOT)
  return (exchange as unknown as {
    createOrderRequest: (...args: unknown[]) => Record<string, unknown>
  }).createOrderRequest('BTC/USDT', 'limit', 'buy', 0.01, 65000, params)
}

describe('okx amend wire contract against real ccxt', () => {
  it('maps swap stopLoss and takeProfit into attachAlgoOrds with slTriggerPx and tpTriggerPx', () => {
    const body = createBody({
      posSide: 'long',
      takeProfit: { triggerPrice: 2600 },
      stopLoss: { triggerPrice: 2400 },
    })

    expect(body.attachAlgoOrds).toEqual([
      {
        slTriggerPx: '2400',
        slOrdPx: '-1',
        slTriggerPxType: 'last',
        tpTriggerPx: '2600',
        tpOrdPx: '-1',
        tpTriggerPxType: 'last',
      },
    ])
  })

  it('emits spot attached TP/SL as attachAlgoOrds through real ccxt', () => {
    const body = createSpotBody({
      takeProfit: { triggerPrice: 71000 },
      stopLoss: { triggerPrice: 62000 },
    })

    expect(body.attachAlgoOrds).toEqual(expect.arrayContaining([
      expect.objectContaining({
        slTriggerPx: '62000',
        tpTriggerPx: '71000',
      }),
    ]))
  })

  it('emits OKX move_order_stop with callbackRatio for trailing percent', () => {
    const body = createBody({ trailingPercent: 1.5 })

    expect(body.ordType).toBe('move_order_stop')
    expect(body.callbackRatio).toBe('0.015')
  })

  it('emits OKX move_order_stop with callbackSpread for trailing price', () => {
    const body = createBody({ trailingPrice: 25 })

    expect(body.ordType).toBe('move_order_stop')
    expect(body.callbackSpread).toBe('25')
  })

  it('amends with the official size and price fields and no posSide', () => {
    expect(editBody()).toEqual({
      instId: 'ETH-USDT-SWAP',
      ordId: 'okx-edit-3',
      newSz: '2',
      newPx: '2600',
    })
  })

  it('forwards a caller-supplied posSide, which the broker must not supply', () => {
    expect(editBody({ posSide: 'long' }).posSide).toBe('long')
  })
})
