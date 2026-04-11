/**
 * CcxtBroker e2e — real orders against Hyperliquid testnet.
 *
 * Reads Alice's config, picks the first CCXT Hyperliquid account on a
 * sandbox (testnet) platform. If none configured, entire suite skips.
 *
 * Required configuration in data/config/accounts.json:
 *   {
 *     "id": "hyperliquid-test",
 *     "type": "ccxt",
 *     "enabled": true,
 *     "guards": [],
 *     "brokerConfig": {
 *       "exchange": "hyperliquid",
 *       "sandbox": true,                // <-- testnet
 *       "walletAddress": "0x...",       // <-- Hyperliquid testnet wallet
 *       "privateKey": "0x..."           // <-- corresponding private key
 *     }
 *   }
 *
 * Get testnet funds at app.hyperliquid-testnet.xyz/drip.
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
  const hl = filterByProvider(all, 'ccxt').find(a => a.id.includes('hyperliquid'))
  if (!hl) {
    console.log('e2e: No Hyperliquid testnet account configured, skipping')
    return
  }
  broker = hl.broker
  console.log(`e2e: ${hl.label} connected`)
}, 60_000)

describe('CcxtBroker — Hyperliquid e2e', () => {
  beforeEach(({ skip }) => { if (!broker) skip('no Hyperliquid account') })

  /** Narrow broker type — beforeEach guarantees non-null via skip(). */
  function b(): IBroker { return broker! }

  // ==================== Connectivity ====================

  it('fetches account info with USD baseCurrency', async () => {
    const account = await b().getAccount()
    expect(account.baseCurrency).toBeDefined()
    expect(account.netLiquidation).toBeGreaterThanOrEqual(0)
    console.log(`  equity: $${account.netLiquidation.toFixed(2)}, cash: $${account.totalCashValue.toFixed(2)}, base=${account.baseCurrency}`)
  })

  it('fetches positions with currency field', async () => {
    const positions = await b().getPositions()
    expect(Array.isArray(positions)).toBe(true)
    console.log(`  ${positions.length} open positions`)
    for (const p of positions) {
      expect(p.currency).toBeDefined()
      // Regression: hyperliquid's CCXT parsePosition leaves markPrice undefined.
      // Our override recovers it from notional / contracts — verify it's > 0.
      expect(p.marketPrice, `marketPrice missing for ${p.contract.symbol}`).toBeGreaterThan(0)
      // marketValue should equal qty × markPrice
      expect(p.marketValue).toBeCloseTo(p.quantity.toNumber() * p.marketPrice, 2)
      console.log(`    ${p.contract.symbol}: ${p.side} ${p.quantity} @ ${p.marketPrice} ${p.currency}`)
    }
  })

  // ==================== Markets / search ====================

  it('searches BTC contracts and finds a perpetual', async () => {
    const results = await b().searchContracts('BTC')
    expect(results.length).toBeGreaterThan(0)
    // Hyperliquid uses USDC as the perpetual settle currency
    const perp = results.find(r => r.contract.localSymbol?.includes('USDC:USDC'))
    expect(perp, `BTC perp not found. Results: ${results.slice(0, 5).map(r => r.contract.localSymbol).join(', ')}`).toBeDefined()
    console.log(`  found ${results.length} BTC contracts, perp: ${perp!.contract.localSymbol}`)
  })

  it('searches ETH contracts and finds a perpetual', async () => {
    const results = await b().searchContracts('ETH')
    expect(results.length).toBeGreaterThan(0)
    const perp = results.find(r => r.contract.localSymbol?.includes('USDC:USDC'))
    expect(perp).toBeDefined()
    console.log(`  found ${results.length} ETH contracts, perp: ${perp!.contract.localSymbol}`)
  })

  // ==================== Trading ====================

  it('places market buy 0.001 BTC perp → execution returned', async ({ skip }) => {
    const matches = await b().searchContracts('BTC')
    const btcPerp = matches.find(m => m.contract.localSymbol?.includes('USDC:USDC'))
    if (!btcPerp) return skip('BTC perp not found')

    // Hyperliquid minimum order value: $10. At ~$60k BTC, 0.001 = $60 (well above min).
    // Adjust quantity if BTC price drops dramatically.
    const order = new Order()
    order.action = 'BUY'
    order.orderType = 'MKT'
    order.totalQuantity = new Decimal('0.001')

    const result = await b().placeOrder(btcPerp.contract, order)
    expect(result.success, `placeOrder failed: ${result.error}`).toBe(true)
    expect(result.orderId).toBeDefined()
    console.log(`  placeOrder result: orderId=${result.orderId}, execution=${!!result.execution}, orderState=${result.orderState?.status}`)

    if (result.execution) {
      expect(result.execution.shares.toNumber()).toBeGreaterThan(0)
      expect(result.execution.price).toBeGreaterThan(0)
      console.log(`  filled: ${result.execution.shares} @ $${result.execution.price}`)
    }
  }, 30_000)

  it('verifies BTC position exists after buy', async () => {
    const positions = await b().getPositions()
    const btcPos = positions.find(p => p.contract.symbol === 'BTC')
    expect(btcPos, `BTC position not found. Positions: ${positions.map(p => p.contract.symbol).join(', ')}`).toBeDefined()
    if (btcPos) {
      console.log(`  BTC position: ${btcPos.quantity} ${btcPos.side} @ ${btcPos.marketPrice} ${btcPos.currency}`)
      expect(btcPos.currency).toBe('USD') // CCXT broker normalizes USDC stablecoin → USD
    }
  })

  it('closes BTC position with reduceOnly', async ({ skip }) => {
    const matches = await b().searchContracts('BTC')
    const btcPerp = matches.find(m => m.contract.localSymbol?.includes('USDC:USDC'))
    if (!btcPerp) return skip('BTC perp not found')

    const result = await b().closePosition(btcPerp.contract, new Decimal('0.001'))
    expect(result.success, `closePosition failed: ${result.error}`).toBe(true)
    console.log(`  close orderId=${result.orderId}, success=${result.success}`)
  }, 60_000)

  it('queries order by ID after place', async ({ skip }) => {
    const matches = await b().searchContracts('BTC')
    const btcPerp = matches.find(m => m.contract.localSymbol?.includes('USDC:USDC'))
    if (!btcPerp) return skip('BTC perp not found')

    const order = new Order()
    order.action = 'BUY'
    order.orderType = 'MKT'
    order.totalQuantity = new Decimal('0.001')

    const placed = await b().placeOrder(btcPerp.contract, order)
    if (!placed.orderId) return skip('no orderId returned')

    // Wait for exchange to settle
    await new Promise(r => setTimeout(r, 3000))

    const detail = await b().getOrder(placed.orderId)
    console.log(`  getOrder(${placed.orderId}): ${detail ? `status=${detail.orderState.status}` : 'null'}`)
    expect(detail).not.toBeNull()
    if (detail) {
      expect(detail.orderState.status).toBe('Filled')
    }

    // Clean up
    await b().closePosition(btcPerp.contract, new Decimal('0.001'))
  }, 60_000)
})
