/**
 * IbkrBroker e2e — real calls against TWS/IB Gateway paper trading.
 *
 * Three groups:
 * - Connectivity: any time (account, positions, search, clock)
 * - Order lifecycle: any time (limit order place → query → cancel)
 * - Fill + position: market hours only (market order → fill → close)
 *
 * Requires TWS or IB Gateway running with paper trading enabled.
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
  const ibkr = filterByProvider(all, 'ibkr')[0]
  if (!ibkr) return
  broker = ibkr.broker
  const clock = await broker.getMarketClock()
  marketOpen = clock.isOpen
  console.log(`e2e: ${ibkr.label} connected (market ${marketOpen ? 'OPEN' : 'CLOSED'})`)
}, 60_000)

// ==================== Connectivity (any time) ====================

describe('IbkrBroker — connectivity', () => {
  beforeEach(({ skip }) => { if (!broker) skip('no IBKR paper account') })

  it('fetches account info with positive equity', async () => {
    const account = await broker!.getAccount()
    expect(Number(account.netLiquidation)).toBeGreaterThan(0)
    expect(Number(account.totalCashValue)).toBeGreaterThan(0)
    console.log(`  equity: $${Number(account.netLiquidation).toFixed(2)}, cash: $${Number(account.totalCashValue).toFixed(2)}, buying_power: $${account.buyingPower ? Number(account.buyingPower).toFixed(2) : undefined}`)
  })

  it('fetches market clock', async () => {
    const clock = await broker!.getMarketClock()
    expect(typeof clock.isOpen).toBe('boolean')
    console.log(`  isOpen: ${clock.isOpen}`)
  })

  it('searches AAPL contracts', async () => {
    const results = await broker!.searchContracts('AAPL')
    expect(results.length).toBeGreaterThan(0)
    expect(results[0].contract.symbol).toBe('AAPL')
    console.log(`  found: ${results[0].contract.symbol}, secType: ${results[0].contract.secType}`)
  })

  it('fetches AAPL contract details with conId', async () => {
    const query = new Contract()
    query.symbol = 'AAPL'
    query.secType = 'STK'
    query.exchange = 'SMART'
    query.currency = 'USD'

    const details = await broker!.getContractDetails(query)
    expect(details).not.toBeNull()
    expect(details!.contract.conId).toBeGreaterThan(0)
    expect(details!.contract.symbol).toBe('AAPL')
    console.log(`  conId: ${details!.contract.conId}, longName: ${details!.longName}, primaryExchange: ${details!.contract.primaryExchange}`)
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

// ==================== Currency tracking (any time) ====================

describe('IbkrBroker — currency tracking', () => {
  beforeEach(({ skip }) => { if (!broker) skip('no IBKR paper account') })

  it('getAccount returns baseCurrency field', async () => {
    const account = await broker!.getAccount()
    expect(account.baseCurrency).toBeDefined()
    expect(typeof account.baseCurrency).toBe('string')
    expect(account.baseCurrency.length).toBeGreaterThanOrEqual(3)
    console.log(`  baseCurrency: ${account.baseCurrency}`)
  })

  it('positions carry currency field matching contract.currency', async () => {
    const positions = await broker!.getPositions()
    if (positions.length === 0) {
      console.log('  no positions — skipping currency check')
      return
    }
    for (const p of positions) {
      expect(p.currency).toBeDefined()
      expect(typeof p.currency).toBe('string')
      expect(p.currency.length).toBeGreaterThanOrEqual(3)
      // currency should match what the contract says
      if (p.contract.currency) {
        expect(p.currency).toBe(p.contract.currency)
      }
      console.log(`  ${p.contract.symbol}: currency=${p.currency}, avgCost=${p.avgCost}, marketPrice=${p.marketPrice}`)
    }
  })
})

// ==================== Order lifecycle (any time — limit orders accepted outside market hours) ====================

describe('IbkrBroker — order lifecycle', () => {
  beforeEach(({ skip }) => { if (!broker) skip('no IBKR paper account') })

  it('places limit buy → queries → cancels', async () => {
    // Discover contract via searchContracts to get conId
    const results = await broker!.searchContracts('AAPL')
    expect(results.length).toBeGreaterThan(0)
    const contract = results[0].contract
    console.log(`  resolved: symbol=${contract.symbol}, conId=${contract.conId}, secType=${contract.secType}`)

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

describe('IbkrBroker — fill + position (market hours)', () => {
  beforeEach(({ skip }) => {
    if (!broker) skip('no IBKR paper account')
    if (!marketOpen) skip('market closed')
  })

  it('fetches AAPL quote with valid prices', async () => {
    const contract = new Contract()
    contract.symbol = 'AAPL'
    contract.secType = 'STK'
    contract.exchange = 'SMART'
    contract.currency = 'USD'

    try {
      const quote = await broker!.getQuote(contract)
      expect(quote.last).toBeGreaterThan(0)
      expect(quote.bid).toBeGreaterThan(0)
      expect(quote.ask).toBeGreaterThan(0)
      console.log(`  AAPL: last=$${quote.last}, bid=$${quote.bid}, ask=$${quote.ask}, vol=${quote.volume}`)
    } catch (err: any) {
      // TWS paper frequently times out on snapshot market data requests
      if (err.code === 'NETWORK' && err.message.includes('timed out')) {
        console.warn('  AAPL quote: snapshot timed out (TWS paper limitation), skipping')
        return
      }
      throw err
    }
  })

  it('places market buy 1 AAPL → success with numeric orderId', async () => {
    const contract = new Contract()
    contract.symbol = 'AAPL'
    contract.secType = 'STK'
    contract.exchange = 'SMART'
    contract.currency = 'USD'

    const order = new Order()
    order.action = 'BUY'
    order.orderType = 'MKT'
    order.totalQuantity = new Decimal('1')
    order.tif = 'DAY'

    const result = await broker!.placeOrder(contract, order)
    console.log(`  placeOrder: success=${result.success}, orderId=${result.orderId}, status=${result.orderState?.status}`)

    expect(result.success).toBe(true)
    expect(result.orderId).toBeDefined()
  }, 15_000)

  it('queries order by ID after place', async () => {
    const contract = new Contract()
    contract.symbol = 'AAPL'
    contract.secType = 'STK'
    contract.exchange = 'SMART'
    contract.currency = 'USD'

    const order = new Order()
    order.action = 'BUY'
    order.orderType = 'MKT'
    order.totalQuantity = new Decimal('1')
    order.tif = 'DAY'

    const placed = await broker!.placeOrder(contract, order)
    expect(placed.orderId).toBeDefined()

    await new Promise(r => setTimeout(r, 3000))

    const detail = await broker!.getOrder(placed.orderId!)
    console.log(`  getOrder: status=${detail?.orderState.status}`)

    expect(detail).not.toBeNull()
  }, 20_000)

  it('closes AAPL position', async () => {
    // Wait for TWS to update positions after preceding buy
    await new Promise(r => setTimeout(r, 3000))

    const contract = new Contract()
    contract.symbol = 'AAPL'
    contract.secType = 'STK'
    contract.exchange = 'SMART'
    contract.currency = 'USD'

    const result = await broker!.closePosition(contract)
    console.log(`  closePosition: success=${result.success}, error=${result.error}`)
    expect(result.success).toBe(true)
  }, 20_000)
})
