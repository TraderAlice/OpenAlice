/**
 * AlpacaBroker e2e — real orders against Alpaca paper trading.
 *
 * Three groups:
 * - Connectivity: any time (account, positions, search, clock)
 * - Order lifecycle: any time (limit order place → query → cancel)
 * - Fill + position: market hours only (market order → fill → close)
 *
 * Run: pnpm test:e2e
 */

import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import Decimal from 'decimal.js'
import { Contract, Order } from '@traderalice/ibkr'
import { getTestAccounts, filterByProvider } from './setup.js'
import type { IBroker } from '../../brokers/types.js'
import '../../contract-ext.js'

let broker: IBroker | null = null
let marketOpen = false

beforeAll(async () => {
  const all = await getTestAccounts()
  const alpaca = filterByProvider(all, 'alpaca')[0]
  if (!alpaca) return
  broker = alpaca.broker
  const clock = await broker.getMarketClock()
  marketOpen = clock.isOpen
  console.log(`e2e: ${alpaca.label} connected (market ${marketOpen ? 'OPEN' : 'CLOSED'})`)
}, 60_000)

// ==================== Connectivity (any time) ====================

describe('AlpacaBroker — connectivity', () => {
  beforeEach(({ skip }) => { if (!broker) skip('no Alpaca paper account') })

  it('fetches account info with positive equity', async () => {
    const account = await broker!.getAccount()
    expect(Number(account.netLiquidation)).toBeGreaterThan(0)
    expect(Number(account.totalCashValue)).toBeGreaterThan(0)
    console.log(`  equity: $${Number(account.netLiquidation).toFixed(2)}, cash: $${Number(account.totalCashValue).toFixed(2)}, buying_power: $${account.buyingPower ? Number(account.buyingPower).toFixed(2) : undefined}`)
  })

  it('fetches market clock', async () => {
    const clock = await broker!.getMarketClock()
    expect(typeof clock.isOpen).toBe('boolean')
    console.log(`  isOpen: ${clock.isOpen}, nextOpen: ${clock.nextOpen?.toISOString()}, nextClose: ${clock.nextClose?.toISOString()}`)
  })

  it('searches AAPL contracts', async () => {
    const results = await broker!.searchContracts('AAPL')
    expect(results.length).toBeGreaterThan(0)
    expect(results[0].contract.symbol).toBe('AAPL')
    console.log(`  found: ${results[0].contract.symbol}, secType: ${results[0].contract.secType}`)
  })

  it('fetches positions with correct types', async () => {
    const positions = await broker!.getPositions()
    console.log(`  ${positions.length} positions total`)
    for (const p of positions) {
      console.log(`  ${p.contract.symbol}: qty=${p.quantity}, avg=${p.avgCost}, mkt=${p.marketPrice}`)
      expect(p.quantity).toBeInstanceOf(Decimal)
      expect(typeof p.avgCost).toBe('string')
      expect(typeof p.marketPrice).toBe('string')
      expect(typeof p.unrealizedPnL).toBe('string')
    }
  })
})

// ==================== Order lifecycle (any time — limit orders accepted outside market hours) ====================

describe('AlpacaBroker — order lifecycle', () => {
  beforeEach(({ skip }) => { if (!broker) skip('no Alpaca paper account') })

  it('places limit buy → queries → cancels', async () => {
    const contract = new Contract()
    contract.symbol = 'AAPL'
    contract.secType = 'STK'

    // Place a limit buy at $1 — will never fill, safe to leave open briefly
    const order = new Order()
    order.action = 'BUY'
    order.orderType = 'LMT'
    order.lmtPrice = 1.00
    order.totalQuantity = new Decimal('1')
    order.tif = 'GTC'

    const placed = await broker!.placeOrder(contract, order)
    console.log(`  placeOrder LMT: success=${placed.success}, orderId=${placed.orderId}, status=${placed.orderState?.status}`)
    expect(placed.success).toBe(true)
    expect(placed.orderId).toBeDefined()

    // Query order
    await new Promise(r => setTimeout(r, 1000))
    const detail = await broker!.getOrder(placed.orderId!)
    console.log(`  getOrder: status=${detail?.orderState.status}`)
    expect(detail).not.toBeNull()

    // Batch query
    const orders = await broker!.getOrders([placed.orderId!])
    console.log(`  getOrders: ${orders.length} results`)
    expect(orders.length).toBe(1)

    // Cancel
    const cancelled = await broker!.cancelOrder(placed.orderId!)
    console.log(`  cancelOrder: success=${cancelled.success}, status=${cancelled.orderState?.status}`)
    expect(cancelled.success).toBe(true)
  }, 30_000)
})

// ==================== Fill + position (market hours only) ====================

describe('AlpacaBroker — fill + position (market hours)', () => {
  beforeEach(({ skip }) => {
    if (!broker) skip('no Alpaca paper account')
    if (!marketOpen) skip('market closed')
  })

  it('fetches AAPL quote with valid prices', async () => {
    const contract = new Contract()
    contract.aliceId = 'alpaca-paper|AAPL'
    contract.symbol = 'AAPL'

    const quote = await broker!.getQuote(contract)
    expect(quote.last).toBeGreaterThan(0)
    expect(quote.bid).toBeGreaterThan(0)
    expect(quote.ask).toBeGreaterThan(0)
    expect(quote.volume).toBeGreaterThan(0)
    console.log(`  AAPL: last=$${quote.last}, bid=$${quote.bid}, ask=$${quote.ask}, vol=${quote.volume}`)
  })

  it('places market buy 1 AAPL → success with UUID orderId', async () => {
    const contract = new Contract()
    contract.aliceId = 'alpaca-paper|AAPL'
    contract.symbol = 'AAPL'
    contract.secType = 'STK'

    const order = new Order()
    order.action = 'BUY'
    order.orderType = 'MKT'
    order.totalQuantity = new Decimal('1')
    order.tif = 'DAY'

    const result = await broker!.placeOrder(contract, order)
    console.log(`  placeOrder: success=${result.success}, orderId=${result.orderId}, status=${result.orderState?.status}`)

    expect(result.success).toBe(true)
    expect(result.orderId).toBeDefined()
    expect(result.orderId!.length).toBeGreaterThan(10)
  }, 15_000)

  it('queries order by ID after place', async () => {
    const contract = new Contract()
    contract.aliceId = 'alpaca-paper|AAPL'
    contract.symbol = 'AAPL'
    contract.secType = 'STK'

    const order = new Order()
    order.action = 'BUY'
    order.orderType = 'MKT'
    order.totalQuantity = new Decimal('1')
    order.tif = 'DAY'

    const placed = await broker!.placeOrder(contract, order)
    expect(placed.orderId).toBeDefined()

    await new Promise(r => setTimeout(r, 2000))

    const detail = await broker!.getOrder(placed.orderId!)
    console.log(`  getOrder: status=${detail?.orderState.status}`)

    expect(detail).not.toBeNull()
    if (detail) {
      expect(detail.orderState.status).toBe('Filled')
    }
  }, 15_000)

  it('verifies AAPL position exists after buy', async () => {
    const positions = await broker!.getPositions()
    const aapl = positions.find(p => p.contract.symbol === 'AAPL')
    expect(aapl).toBeDefined()
    if (aapl) {
      console.log(`  AAPL: ${aapl.quantity} ${aapl.side}, avg=$${aapl.avgCost}, mkt=$${aapl.marketPrice}`)
      expect(aapl.quantity.toNumber()).toBeGreaterThan(0)
    }
  })

  it('closes AAPL position', async () => {
    const contract = new Contract()
    contract.aliceId = 'alpaca-paper|AAPL'
    contract.symbol = 'AAPL'

    const result = await broker!.closePosition(contract)
    console.log(`  closePosition: success=${result.success}, error=${result.error}`)
    expect(result.success).toBe(true)
  }, 15_000)

  it('getOrders with known IDs', async () => {
    const contract = new Contract()
    contract.aliceId = 'alpaca-paper|AAPL'
    contract.symbol = 'AAPL'
    contract.secType = 'STK'

    const order = new Order()
    order.action = 'BUY'
    order.orderType = 'MKT'
    order.totalQuantity = new Decimal('1')
    order.tif = 'DAY'

    const placed = await broker!.placeOrder(contract, order)
    expect(placed.orderId).toBeDefined()

    await new Promise(r => setTimeout(r, 2000))

    const orders = await broker!.getOrders([placed.orderId!])
    console.log(`  getOrders: ${orders.length} results`)
    expect(orders.length).toBe(1)

    // Clean up
    await broker!.closePosition(contract)
  }, 15_000)
})
