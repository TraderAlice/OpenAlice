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
 * Run: OPENALICE_UTA_LIVE_PAPER=1 pnpm test:uta:live-paper
 */

import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import Decimal from 'decimal.js'
import { Contract, Order } from '@traderalice/ibkr'
import { getTestAccounts, filterByProvider } from './setup.js'
import { contractEvidence, recordLivePaperEvidence } from './live-paper-evidence.js'
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

// ==================== Canonical conId routing (any time) ====================

describe('IbkrBroker — canonical conId routing', () => {
  beforeEach(({ skip }) => { if (!broker) skip('no IBKR paper account') })

  it('validates a polluted USD.CHF conId as a what-if order and leaves no state delta', async () => {
    expect(broker!.getOpenOrders).toBeDefined()

    const clean = new Contract()
    clean.conId = 12087820
    const details = await broker!.getContractDetails(clean)
    expect(details?.contract).toBeDefined()
    expect(details!.contract.secType).toBe('CASH')
    expect(details!.contract.exchange).toBe('IDEALPRO')
    expect(details!.contract.currency).toBe('CHF')

    const positionsBefore = await broker!.getPositions()
    const ordersBefore = await broker!.getOpenOrders!()
    const baselineOrderIds = new Set(ordersBefore.map(order => order.orderId))
    const baselinePositions = positionsBefore
      .map(position => `${position.contract.conId}|${position.contract.localSymbol}|${position.side}|${position.quantity}`)
      .sort()
    const evidencePath = await recordLivePaperEvidence({
      scenario: 'ibkr-usd-chf-canonical-routing',
      phase: 'baseline',
      contract: contractEvidence(details!.contract),
      baseline: { positions: positionsBefore.length, openOrders: ordersBefore.length },
    })

    // Recreate the historical UTA failure shape. conId is the identity; the
    // other fields are deliberately wrong and must not reach TWS.
    const polluted = new Contract()
    polluted.conId = 12087820
    polluted.symbol = 'USDCHF'
    polluted.secType = 'STK'
    polluted.exchange = 'SMART'
    polluted.currency = 'USD'

    const order = new Order()
    order.action = 'BUY'
    order.orderType = 'MKT'
    order.totalQuantity = new Decimal('25000')
    order.tif = 'DAY'
    order.whatIf = true

    let result: Awaited<ReturnType<IBroker['placeOrder']>> | undefined
    try {
      result = await broker!.placeOrder(polluted, order)
      await recordLivePaperEvidence({
        scenario: 'ibkr-usd-chf-canonical-routing',
        phase: 'what-if-result',
        contract: contractEvidence(details!.contract),
        request: contractEvidence(polluted),
        result: {
          success: result.success,
          status: result.orderState?.status,
          error: result.error,
        },
      })
      expect(result.success, result.error).toBe(true)
    } finally {
      // whatIf should never become an open order. If venue behavior changes,
      // cancel any order introduced by this test before asserting the baseline.
      const afterAttempt = await broker!.getOpenOrders!()
      const introduced = afterAttempt.filter(order => !baselineOrderIds.has(order.orderId))
      for (const open of introduced) await broker!.cancelOrder(open.orderId)

      const positionsAfter = await broker!.getPositions()
      const ordersAfter = await broker!.getOpenOrders!()
      const finalPositions = positionsAfter
        .map(position => `${position.contract.conId}|${position.contract.localSymbol}|${position.side}|${position.quantity}`)
        .sort()
      const finalOrderIds = ordersAfter.map(order => order.orderId).sort()
      const matchesBaseline =
        JSON.stringify(finalPositions) === JSON.stringify(baselinePositions) &&
        JSON.stringify(finalOrderIds) === JSON.stringify([...baselineOrderIds].sort())
      await recordLivePaperEvidence({
        scenario: 'ibkr-usd-chf-canonical-routing',
        phase: 'cleanup',
        cleanup: {
          positions: positionsAfter.length,
          openOrders: ordersAfter.length,
          matchesBaseline,
        },
      })
      console.log(`  live-paper evidence: ${evidencePath}`)
      expect(matchesBaseline).toBe(true)
    }
  }, 30_000)
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
    order.lmtPrice = new Decimal('1.00')
    order.totalQuantity = new Decimal('1')
    order.tif = 'GTC'

    let orderId: string | undefined
    try {
      const placed = await broker!.placeOrder(contract, order)
      orderId = placed.orderId
      console.log(`  placeOrder LMT: success=${placed.success}, orderId=${placed.orderId}, status=${placed.orderState?.status}`)
      expect(placed.success).toBe(true)
      expect(orderId).toBeDefined()

      // Query order
      await new Promise(r => setTimeout(r, 1000))
      const detail = await broker!.getOrder(orderId!)
      console.log(`  getOrder: status=${detail?.orderState.status}`)
      expect(detail).not.toBeNull()

      // Batch query
      const orders = await broker!.getOrders([orderId!])
      console.log(`  getOrders: ${orders.length} results`)
      expect(orders.length).toBe(1)

      const cancelled = await broker!.cancelOrder(orderId!)
      console.log(`  cancelOrder: success=${cancelled.success}, status=${cancelled.orderState?.status}`)
      expect(cancelled.success).toBe(true)
    } finally {
      if (orderId) {
        const stillOpen = (await broker!.getOpenOrders!()).some(open => open.orderId === orderId)
        if (stillOpen) await broker!.cancelOrder(orderId)
      }
    }
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
      expect(Number(quote.last)).toBeGreaterThan(0)
      expect(Number(quote.bid)).toBeGreaterThan(0)
      expect(Number(quote.ask)).toBeGreaterThan(0)
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

  it('places, queries, and closes only the AAPL quantity created by this test', async () => {
    const contract = new Contract()
    contract.symbol = 'AAPL'
    contract.secType = 'STK'
    contract.exchange = 'SMART'
    contract.currency = 'USD'

    const positionsBefore = await broker!.getPositions()
    const initialQty = positionsBefore.find(position => position.contract.symbol === 'AAPL')?.quantity ?? new Decimal(0)
    const ordersBefore = await broker!.getOpenOrders!()
    const baselineOrderIds = new Set(ordersBefore.map(open => open.orderId))
    let entryOrderId: string | undefined

    const currentAaplQty = async (): Promise<Decimal> => {
      const positions = await broker!.getPositions()
      return positions.find(position => position.contract.symbol === 'AAPL')?.quantity ?? new Decimal(0)
    }
    const waitForQty = async (expected: Decimal): Promise<Decimal> => {
      let current = await currentAaplQty()
      for (let i = 0; i < 15 && !current.equals(expected); i += 1) {
        await new Promise(resolve => setTimeout(resolve, 1000))
        current = await currentAaplQty()
      }
      return current
    }

    try {
      const order = new Order()
      order.action = 'BUY'
      order.orderType = 'MKT'
      order.totalQuantity = new Decimal('1')
      order.tif = 'DAY'

      const placed = await broker!.placeOrder(contract, order)
      entryOrderId = placed.orderId
      console.log(`  placeOrder: success=${placed.success}, orderId=${placed.orderId}, status=${placed.orderState?.status}`)
      expect(placed.success, placed.error).toBe(true)
      expect(entryOrderId).toBeDefined()

      const filledQty = await waitForQty(initialQty.plus(1))
      expect(filledQty.equals(initialQty.plus(1))).toBe(true)
      const detail = await broker!.getOrder(entryOrderId!)
      expect(detail).not.toBeNull()
    } finally {
      const openAfterAttempt = await broker!.getOpenOrders!()
      for (const open of openAfterAttempt.filter(order => !baselineOrderIds.has(order.orderId))) {
        await broker!.cancelOrder(open.orderId)
      }

      // Cancel first, then close only the filled delta introduced by this test.
      const afterEntry = await currentAaplQty()
      const createdQty = afterEntry.minus(initialQty)
      if (createdQty.greaterThan(0)) {
        const closed = await broker!.closePosition(contract, createdQty)
        expect(closed.success, closed.error).toBe(true)
      } else if (createdQty.lessThan(0)) {
        throw new Error(`AAPL position moved below its baseline during E2E: ${afterEntry} < ${initialQty}`)
      }

      const cleanedQty = await waitForQty(initialQty)
      expect(cleanedQty.equals(initialQty)).toBe(true)
      const finalOrderIds = (await broker!.getOpenOrders!()).map(open => open.orderId).sort()
      expect(finalOrderIds).toEqual([...baselineOrderIds].sort())
    }
  }, 60_000)
})
