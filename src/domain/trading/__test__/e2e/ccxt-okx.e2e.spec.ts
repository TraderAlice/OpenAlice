/**
 * CcxtBroker e2e — real calls against OKX demo trading.
 *
 * Reads Alice's config, picks the first OKX account whose preset
 * resolves to a paper/demo mode (isPaperPreset === true). If none
 * configured, the entire suite skips.
 *
 * OKX is the spot-synthesis canary. fetchPositions() on OKX returns
 * derivative positions only (SWAP/FUTURES/MARGIN/OPTION); spot
 * holdings live in fetchBalance(). CcxtBroker.fetchSpotHoldings
 * synthesizes them into Position records — these tests exercise
 * that path with a real account.
 *
 * Required configuration in data/config/accounts.json:
 *   {
 *     "id": "okx-test",
 *     "presetId": "okx",
 *     "enabled": true,
 *     "guards": [],
 *     "presetConfig": {
 *       "mode": "demo",
 *       "apiKey": "...",
 *       "secret": "...",
 *       "password": "..."
 *     }
 *   }
 *
 * OKX demo seeds the account with ~100k USDT — plenty of headroom for
 * the small test trades below.
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
  const okx = filterByProvider(all, 'ccxt').find(a => a.id.includes('okx'))
  if (!okx) {
    console.log('e2e: No OKX demo account configured, skipping')
    return
  }
  broker = okx.broker
  console.log(`e2e: ${okx.label} connected`)
}, 60_000)

describe('CcxtBroker — OKX e2e', () => {
  beforeEach(({ skip }) => { if (!broker) skip('no OKX account') })

  /** Narrow broker type — beforeEach guarantees non-null via skip(). */
  function b(): IBroker { return broker! }

  // ==================== Connectivity ====================

  it('fetches account info with positive equity (demo seeds ~100k USDT)', async () => {
    const account = await b().getAccount()
    expect(account.baseCurrency).toBe('USD')
    expect(Number(account.netLiquidation)).toBeGreaterThan(0)
    console.log(`  equity: $${Number(account.netLiquidation).toFixed(2)}, cash: $${Number(account.totalCashValue).toFixed(2)}`)
  })

  it('fetches positions (derivative + spot synthesized)', async () => {
    const positions = await b().getPositions()
    expect(Array.isArray(positions)).toBe(true)
    console.log(`  ${positions.length} open positions`)
    for (const p of positions) {
      expect(p.currency).toBeDefined()
      expect(Number(p.marketPrice), `marketPrice missing for ${p.contract.symbol}`).toBeGreaterThan(0)
      // marketValue = qty × markPrice (within Decimal rounding)
      expect(Number(p.marketValue)).toBeCloseTo(p.quantity.toNumber() * Number(p.marketPrice), 2)
      // Spot positions carry no settle suffix in localSymbol (e.g. "BTC/USDT");
      // perps carry it (e.g. "BTC/USDT:USDT"). Either is acceptable here.
      console.log(`    ${p.contract.localSymbol}: ${p.side} ${p.quantity} @ ${p.marketPrice} ${p.currency}`)
    }
  })

  // ==================== Markets / search ====================

  it('searches BTC contracts and finds spot + perp', async () => {
    const results = await b().searchContracts('BTC')
    expect(results.length).toBeGreaterThan(0)
    const spot = results.find(r => r.contract.localSymbol === 'BTC/USDT')
    const perp = results.find(r => r.contract.localSymbol === 'BTC/USDT:USDT')
    expect(spot, 'BTC/USDT spot not found').toBeDefined()
    expect(perp, 'BTC/USDT:USDT perp not found').toBeDefined()
    console.log(`  found ${results.length} BTC contracts (spot + perp present)`)
  })

  it('searches ETH contracts and finds a perpetual', async () => {
    const results = await b().searchContracts('ETH')
    expect(results.length).toBeGreaterThan(0)
    const perp = results.find(r => r.contract.localSymbol === 'ETH/USDT:USDT')
    expect(perp).toBeDefined()
    console.log(`  found ${results.length} ETH contracts, perp: ${perp!.contract.localSymbol}`)
  })

  // ==================== Spot synthesis (OKX-unique) ====================

  it('places small spot BTC buy (~$50) → BTC appears as a long Position via fetchSpotHoldings', async ({ skip }) => {
    const matches = await b().searchContracts('BTC')
    const btcSpot = matches.find(m => m.contract.localSymbol === 'BTC/USDT')
    if (!btcSpot) return skip('BTC/USDT spot not found')

    // OKX spot minimums for BTC/USDT are ~5 USDT — $50 notional is comfortably above.
    const order = new Order()
    order.action = 'BUY'
    order.orderType = 'MKT'
    order.cashQty = new Decimal('50')

    const placeResult = await b().placeOrder(btcSpot.contract, order)
    expect(placeResult.success, `placeOrder failed: ${placeResult.error}`).toBe(true)
    console.log(`  spot buy: orderId=${placeResult.orderId}, status=${placeResult.orderState?.status}`)

    // Give OKX a moment to update balance — fetchBalance is what feeds spot synthesis
    await new Promise(r => setTimeout(r, 3000))

    const positions = await b().getPositions()
    const btcSpotPos = positions.find(p => p.contract.localSymbol === 'BTC/USDT')
    expect(btcSpotPos, `BTC spot position not synthesized. Positions: ${positions.map(p => p.contract.localSymbol).join(', ')}`).toBeDefined()
    if (btcSpotPos) {
      expect(btcSpotPos.side).toBe('long')
      expect(Number(btcSpotPos.quantity)).toBeGreaterThan(0)
      expect(Number(btcSpotPos.marketValue)).toBeGreaterThan(0)
      // Spot synthesis sets avgCost = markPrice (we can't reconstruct historic cost)
      expect(btcSpotPos.unrealizedPnL).toBe('0')
      console.log(`  BTC spot synthesized: ${btcSpotPos.quantity} @ $${btcSpotPos.marketPrice}, value=$${btcSpotPos.marketValue}`)
    }
  }, 30_000)

  it('sells back the spot BTC → position drops out', async ({ skip }) => {
    const positions = await b().getPositions()
    const btcSpot = positions.find(p => p.contract.localSymbol === 'BTC/USDT')
    if (!btcSpot) return skip('no BTC spot position to sell')

    const order = new Order()
    order.action = 'SELL'
    order.orderType = 'MKT'
    order.totalQuantity = btcSpot.quantity

    const result = await b().placeOrder(btcSpot.contract, order)
    expect(result.success, `sell failed: ${result.error}`).toBe(true)
    console.log(`  spot sell: orderId=${result.orderId}, qty=${btcSpot.quantity}`)

    await new Promise(r => setTimeout(r, 3000))

    const after = await b().getPositions()
    const btcAfter = after.find(p => p.contract.localSymbol === 'BTC/USDT')
    // Allow for dust remainders below the dust threshold; the position
    // should at minimum have shrunk dramatically.
    if (btcAfter) {
      expect(Number(btcAfter.quantity)).toBeLessThan(Number(btcSpot.quantity) * 0.1)
    }
    console.log(`  after sell: ${btcAfter ? `${btcAfter.quantity} (dust)` : 'gone'}`)
  }, 30_000)

  // ==================== Derivative trading ====================
  //
  // OKX accounts default to "Cash" mode which forbids derivatives. Perp
  // trading requires switching the account to Single-currency Margin /
  // Multi-currency Margin / Portfolio Margin in the OKX UI. When the
  // account is in Cash mode, OKX rejects perp orders with code 51010
  // ("You can't complete this request under your current account mode").
  // We detect that error and skip — cash-mode demo accounts still cover
  // every spot path above; margin-mode accounts get full coverage.

  /** True if a CCXT/OKX error string is the cash-mode rejection. */
  function isCashModeError(err: string | undefined): boolean {
    return !!err && (err.includes('"sCode":"51010"') || err.includes('current account mode'))
  }

  /** Place an ETH perp buy and return the result, or null if cash-mode skip. */
  async function tryPerpBuy(): Promise<{ orderId: string | undefined; cashMode: boolean }> {
    const matches = await b().searchContracts('ETH')
    const ethPerp = matches.find(m => m.contract.localSymbol === 'ETH/USDT:USDT')
    if (!ethPerp) throw new Error('ETH/USDT perp not found')

    const order = new Order()
    order.action = 'BUY'
    order.orderType = 'MKT'
    order.totalQuantity = new Decimal('0.01')

    const result = await b().placeOrder(ethPerp.contract, order)
    if (!result.success && isCashModeError(result.error)) {
      return { orderId: undefined, cashMode: true }
    }
    if (!result.success) throw new Error(`placeOrder failed: ${result.error}`)
    return { orderId: result.orderId, cashMode: false }
  }

  it('places market buy 0.01 ETH perp → execution returned', async ({ skip }) => {
    const { orderId, cashMode } = await tryPerpBuy()
    if (cashMode) return skip('OKX account in Cash mode — switch to a margin mode for perp coverage')
    expect(orderId).toBeDefined()
    console.log(`  perp buy: orderId=${orderId}`)
  }, 30_000)

  it('verifies ETH perp position exists separately from any ETH spot', async ({ skip }) => {
    const positions = await b().getPositions()
    const ethPerp = positions.find(p => p.contract.localSymbol === 'ETH/USDT:USDT')
    if (!ethPerp) return skip('no ETH perp position (preceding buy was skipped or perp closed)')
    // Distinct contract identity: spot is "ETH/USDT", perp is "ETH/USDT:USDT".
    // Same underlying, different products — must not be merged.
    expect(ethPerp.contract.localSymbol).toBe('ETH/USDT:USDT')
    console.log(`  ETH perp: ${ethPerp.quantity} ${ethPerp.side} @ ${ethPerp.marketPrice} ${ethPerp.currency}`)
  })

  it('closes ETH perp position with reduceOnly', async ({ skip }) => {
    const matches = await b().searchContracts('ETH')
    const ethPerp = matches.find(m => m.contract.localSymbol === 'ETH/USDT:USDT')
    if (!ethPerp) return skip('ETH/USDT perp not found')

    const result = await b().closePosition(ethPerp.contract, new Decimal('0.01'))
    if (!result.success && isCashModeError(result.error)) {
      return skip('OKX account in Cash mode — no perp position to close')
    }
    // OKX 51205 is "Reduce Only is not available" — happens when there's no
    // open perp position to reduce. Treat as skip here for the same reason.
    if (!result.success && /51205|Reduce Only is not available/i.test(result.error ?? '')) {
      return skip('no open perp position to close (preceding buy was skipped)')
    }
    expect(result.success, `closePosition failed: ${result.error}`).toBe(true)
    console.log(`  close perp orderId=${result.orderId}`)
  }, 30_000)

  // ==================== Order query ====================

  it('queries order by ID after place', async ({ skip }) => {
    const { orderId, cashMode } = await tryPerpBuy()
    if (cashMode) return skip('OKX account in Cash mode — perp path skipped')
    if (!orderId) return skip('no orderId returned')

    // OKX needs a moment for the order to settle into queryable state
    await new Promise(r => setTimeout(r, 3000))

    const detail = await b().getOrder(orderId)
    console.log(`  getOrder(${orderId}): ${detail ? `status=${detail.orderState.status}` : 'null'}`)
    expect(detail).not.toBeNull()
    if (detail) {
      expect(detail.orderState.status).toBe('Filled')
    }

    // Clean up — find the perp again so we have its contract
    const matches = await b().searchContracts('ETH')
    const ethPerp = matches.find(m => m.contract.localSymbol === 'ETH/USDT:USDT')
    if (ethPerp) await b().closePosition(ethPerp.contract, new Decimal('0.01'))
  }, 30_000)
})
