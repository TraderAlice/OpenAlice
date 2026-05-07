/**
 * CcxtBroker e2e — real orders against Bybit demo/sandbox.
 *
 * Reads Alice's config, picks the first CCXT Bybit account on a
 * sandbox/demoTrading platform. If none configured, entire suite skips.
 *
 * Run: pnpm test:e2e
 */

import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import Decimal from 'decimal.js'
import { Order } from '@traderalice/ibkr'
import { getTestAccounts, filterByProvider } from './setup.js'
import type { IBroker } from '../../brokers/types.js'
import '../../contract-ext.js'

let broker: IBroker | null = null

beforeAll(async () => {
  const all = await getTestAccounts()
  const bybit = filterByProvider(all, 'ccxt').find(a => a.id.includes('bybit'))
  if (!bybit) {
    console.log('e2e: No Bybit sandbox/demo account configured, skipping')
    return
  }
  broker = bybit.broker
  console.log(`e2e: ${bybit.label} connected`)
}, 60_000)

describe('CcxtBroker — Bybit e2e', () => {
  beforeEach(({ skip }) => { if (!broker) skip('no Bybit account') })

  /** Narrow broker type — beforeEach guarantees non-null via skip(). */
  function b(): IBroker { return broker! }

  it('fetches account info with positive equity', async () => {
    const account = await b().getAccount()
    expect(Number(account.netLiquidation)).toBeGreaterThan(0)
    console.log(`  equity: $${Number(account.netLiquidation).toFixed(2)}, cash: $${Number(account.totalCashValue).toFixed(2)}`)
  })

  it('fetches positions', async () => {

    const positions = await b().getPositions()
    expect(Array.isArray(positions)).toBe(true)
    console.log(`  ${positions.length} open positions`)
  })

  it('searches ETH contracts', async () => {

    const results = await b().searchContracts('ETH')
    expect(results.length).toBeGreaterThan(0)
    const perp = results.find(r => r.contract.secType === 'CRYPTO_PERP')
    expect(perp).toBeDefined()
    console.log(`  found ${results.length} ETH contracts, perp: ${perp!.contract.localSymbol}`)
  })

  it('places market buy 0.01 ETH → execution returned', async ({ skip }) => {
    const matches = await b().searchContracts('ETH')
    const ethPerp = matches.find(m => m.contract.secType === 'CRYPTO_PERP')
    if (!ethPerp) return skip('ETH/USDT perp not found')

    // Diagnostic: see raw CCXT createOrder response
    const exchange = (b() as any).exchange
    const rawOrder = await exchange.createOrder('ETH/USDT:USDT', 'market', 'buy', 0.01)
    console.log('  CCXT raw createOrder:', JSON.stringify({
      id: rawOrder.id, status: rawOrder.status, filled: rawOrder.filled,
      average: rawOrder.average, amount: rawOrder.amount, remaining: rawOrder.remaining,
      datetime: rawOrder.datetime, type: rawOrder.type, side: rawOrder.side,
    }))

    // Clean up diagnostic order
    await b().closePosition(ethPerp.contract, new Decimal('0.01'))

    // Now test through our placeOrder
    const order = new Order()
    order.action = 'BUY'
    order.orderType = 'MKT'
    order.totalQuantity = new Decimal('0.01')

    const result = await b().placeOrder(ethPerp.contract, order)
    expect(result.success).toBe(true)
    expect(result.orderId).toBeDefined()
    console.log(`  placeOrder result: orderId=${result.orderId}, execution=${!!result.execution}, orderState=${result.orderState?.status}`)

    if (result.execution) {
      expect(result.execution.shares.toNumber()).toBeGreaterThan(0)
      expect(result.execution.price).toBeGreaterThan(0)
      console.log(`  filled: ${result.execution.shares} @ $${result.execution.price}`)
    }
  }, 30_000)

  it('verifies ETH position exists after buy', async () => {

    const positions = await b().getPositions()
    const ethPos = positions.find(p => p.contract.symbol === 'ETH')
    expect(ethPos).toBeDefined()
    console.log(`  ETH position: ${ethPos!.quantity} ${ethPos!.side}`)
  })

  it('closes ETH position with reduceOnly', async ({ skip }) => {
    const matches = await b().searchContracts('ETH')
    const ethPerp = matches.find(m => m.contract.secType === 'CRYPTO_PERP')
    if (!ethPerp) return skip('ETH/USDT perp not found')

    const result = await b().closePosition(ethPerp.contract, new Decimal('0.01'))
    expect(result.success).toBe(true)
    console.log(`  close orderId=${result.orderId}, success=${result.success}`)
  }, 15_000)

  it('queries order by ID', async ({ skip }) => {
    // Place a small order to get an orderId
    const matches = await b().searchContracts('ETH')
    const ethPerp = matches.find(m => m.contract.secType === 'CRYPTO_PERP')
    if (!ethPerp) return skip('ETH/USDT perp not found')

    const order = new Order()
    order.action = 'BUY'
    order.orderType = 'MKT'
    order.totalQuantity = new Decimal('0.01')

    const placed = await b().placeOrder(ethPerp.contract, order)
    if (!placed.orderId) return skip('no orderId returned')

    // Wait for exchange to settle — Bybit needs time before order appears in closed list
    await new Promise(r => setTimeout(r, 5000))

    const detail = await b().getOrder(placed.orderId)
    console.log(`  getOrder(${placed.orderId}): ${detail ? `status=${detail.orderState.status}` : 'null'}`)

    expect(detail).not.toBeNull()
    if (detail) {
      expect(detail.orderState.status).toBe('Filled')
    }

    // Clean up
    await b().closePosition(ethPerp.contract, new Decimal('0.01'))
  }, 15_000)

  it('places order with TPSL and reads back tpsl from getOrder', async ({ skip }) => {
    const matches = await b().searchContracts('ETH')
    const ethPerp = matches.find(m => m.contract.secType === 'CRYPTO_PERP')
    if (!ethPerp) return skip('ETH/USDT perp not found')

    const order = new Order()
    order.action = 'BUY'
    order.orderType = 'MKT'
    order.totalQuantity = new Decimal('0.01')

    // Get current price to set reasonable TP/SL
    const quote = await b().getQuote(ethPerp.contract)
    const tpPrice = Math.round(Number(quote.last) * 1.5)  // 50% above — won't trigger
    const slPrice = Math.round(Number(quote.last) * 0.5)  // 50% below — won't trigger

    const placed = await b().placeOrder(ethPerp.contract, order, {
      takeProfit: { price: String(tpPrice) },
      stopLoss: { price: String(slPrice) },
    })
    expect(placed.success).toBe(true)
    console.log(`  placed with TPSL: orderId=${placed.orderId}, tp=${tpPrice}, sl=${slPrice}`)

    // Wait for exchange to register
    await new Promise(r => setTimeout(r, 3000))

    const detail = await b().getOrder(placed.orderId!)
    expect(detail).not.toBeNull()
    console.log(`  getOrder tpsl:`, JSON.stringify(detail!.tpsl))

    // CCXT should populate takeProfitPrice/stopLossPrice on the fetched order
    if (detail!.tpsl) {
      if (detail!.tpsl.takeProfit) {
        expect(parseFloat(detail!.tpsl.takeProfit.price)).toBe(tpPrice)
      }
      if (detail!.tpsl.stopLoss) {
        expect(parseFloat(detail!.tpsl.stopLoss.price)).toBe(slPrice)
      }
    } else {
      // Some exchanges don't return TP/SL on the parent order — log for visibility
      console.log('  NOTE: exchange did not return TPSL on fetched order (may be separate conditional orders)')
    }

    // Clean up
    await b().closePosition(ethPerp.contract, new Decimal('0.01'))
  }, 30_000)

  it('queries conditional/trigger order by ID (#90)', async ({ skip }) => {
    // Place a stop-loss trigger order far from market price, then verify getOrder can see it.
    // This is the core scenario from issue #90.
    const matches = await b().searchContracts('ETH')
    const ethPerp = matches.find(m => m.contract.secType === 'CRYPTO_PERP')
    if (!ethPerp) return skip('ETH/USDT perp not found')

    // Open a small position first — stop-loss with reduceOnly needs an existing position
    const buyOrder = new Order()
    buyOrder.action = 'BUY'
    buyOrder.orderType = 'MKT'
    buyOrder.totalQuantity = new Decimal('0.01')
    const buyResult = await b().placeOrder(ethPerp.contract, buyOrder)
    if (!buyResult.success) return skip('could not open position for stop-loss test')

    // Get current price to set a trigger far away (won't execute)
    const quote = await b().getQuote(ethPerp.contract)
    const triggerPrice = Math.round(Number(quote.last) * 0.5) // 50% below — will never trigger

    // Place a conditional sell order via raw CCXT (with triggerPrice).
    // Bybit requires triggerDirection: price falling below trigger = "descending".
    const exchange = (b() as any).exchange
    const rawOrder = await exchange.createOrder(
      'ETH/USDT:USDT', 'market', 'sell', 0.01,
      undefined,
      { triggerPrice, triggerDirection: 'descending', reduceOnly: true },
    )
    console.log(`  placed conditional order: id=${rawOrder.id}, triggerPrice=${triggerPrice}`)
    expect(rawOrder.id).toBeDefined()

    // Wait for exchange to register the order
    await new Promise(r => setTimeout(r, 2000))

    // Seed the symbol cache (normally done by placeOrder, but we used raw CCXT)
    ;(b() as any).orderSymbolCache.set(rawOrder.id, 'ETH/USDT:USDT')

    // This is the bug from #90: getOrder must find a conditional order
    const detail = await b().getOrder(rawOrder.id)
    console.log(`  getOrder(${rawOrder.id}): ${detail ? `status=${detail.orderState.status}` : 'null (BUG: conditional order invisible)'}`)

    expect(detail).not.toBeNull()

    // Clean up — cancel the conditional order, then close position
    const cancelResult = await b().cancelOrder(rawOrder.id)
    console.log(`  cancel conditional: success=${cancelResult.success}`)
    expect(cancelResult.success).toBe(true)

    await b().closePosition(ethPerp.contract, new Decimal('0.01'))
  }, 30_000)
})
