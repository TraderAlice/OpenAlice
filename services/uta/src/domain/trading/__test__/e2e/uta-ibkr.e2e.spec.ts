/**
 * UTA — IBKR paper lifecycle e2e.
 *
 * Two groups:
 * - Order lifecycle (any time): limit order stage → commit → push → cancel
 * - Full fill flow (market hours): market order → fill → verify → close
 *
 * Run: OPENALICE_UTA_LIVE_PAPER=1 pnpm test:uta:live-paper
 */

import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { getTestAccounts, filterByProvider } from './setup.js'
import { contractEvidence, recordLivePaperEvidence } from './live-paper-evidence.js'
import { UnifiedTradingAccount } from '../../UnifiedTradingAccount.js'
import type { IBroker } from '../../brokers/types.js'
import '../../contract-ext.js'

let broker: IBroker | null = null
let uta: UnifiedTradingAccount | null = null
let marketOpen = false

beforeAll(async () => {
  const all = await getTestAccounts()
  const ibkr = filterByProvider(all, 'ibkr')[0]
  if (!ibkr) return
  broker = ibkr.broker
  uta = new UnifiedTradingAccount(broker)
  await uta.waitForConnect()
  const clock = await broker.getMarketClock()
  marketOpen = clock.isOpen
  console.log(`UTA IBKR: market ${marketOpen ? 'OPEN' : 'CLOSED'}`)
}, 60_000)

// ==================== FX identity → staging contract (any time) ====================

describe('UTA — IBKR FX identity staging', () => {
  beforeEach(({ skip }) => { if (!uta) skip('no IBKR paper account') })

  it('round-trips an FX leaf as conId identity while keeping symbol display-only', async () => {
    const results = await broker!.searchContracts('USD.CHF')
    const leaf = results.find(result =>
      result.contract.conId > 0 &&
      result.contract.secType === 'CASH' &&
      result.contract.currency === 'CHF',
    )
    expect(leaf, 'USD.CHF leaf not returned by IBKR search').toBeDefined()

    const nativeKey = broker!.getNativeKey(leaf!.contract)
    const aliceId = `${uta!.id}|${nativeKey}`
    let committed = false
    try {
      const staged = uta!.stagePlaceOrder({
        aliceId,
        symbol: 'USDCHF',
        action: 'BUY',
        orderType: 'LMT',
        lmtPrice: '0.1',
        totalQuantity: '25000',
        tif: 'DAY',
      })
      expect(staged.staged).toBe(true)

      const operation = uta!.status().staged[0]
      expect(operation.action).toBe('placeOrder')
      if (operation.action !== 'placeOrder') throw new Error('expected staged placeOrder')
      expect(operation.contract.conId).toBe(leaf!.contract.conId)
      expect(operation.contract.symbol).toBe('USDCHF')
      expect(operation.contract.exchange).toBe('')
      expect(operation.contract.currency).toBe('')

      const commit = uta!.commit('e2e: verify USD.CHF conId staging boundary')
      expect(commit.prepared).toBe(true)
      committed = true
      await recordLivePaperEvidence({
        scenario: 'uta-ibkr-usd-chf-identity-staging',
        phase: 'prepared-not-pushed',
        contract: contractEvidence(leaf!.contract),
        request: contractEvidence(operation.contract),
        note: 'UTA carries conId identity plus display symbol; IbkrBroker resolves canonical routing at push.',
      })
    } finally {
      if (committed || uta!.status().staged.length > 0) {
        await uta!.reject('e2e: staging-boundary smoke cleanup')
      }
      expect(uta!.status().staged).toHaveLength(0)
      expect(uta!.status().pendingHash).toBeNull()
    }
  }, 30_000)
})

// ==================== Order lifecycle (any time) ====================

describe('UTA — IBKR order lifecycle', () => {
  beforeEach(({ skip }) => { if (!uta) skip('no IBKR paper account') })

  it('limit order: stage → commit → push → cancel', async () => {
    // Discover AAPL contract to get conId-based aliceId
    const results = await broker!.searchContracts('AAPL')
    expect(results.length).toBeGreaterThan(0)
    const nativeKey = broker!.getNativeKey(results[0].contract)
    const aliceId = `${uta!.id}|${nativeKey}`
    console.log(`  resolved: nativeKey=${nativeKey}, aliceId=${aliceId}`)

    // Stage a limit buy at $1 (won't fill)
    const addResult = uta!.stagePlaceOrder({
      aliceId,
      symbol: 'AAPL',
      action: 'BUY',
      orderType: 'LMT',
      lmtPrice: '1.00',
      totalQuantity: '1',
      tif: 'GTC',
    })
    expect(addResult.staged).toBe(true)

    const commitResult = uta!.commit('e2e: limit buy 1 AAPL @ $1')
    expect(commitResult.prepared).toBe(true)
    console.log(`  committed: hash=${commitResult.hash}`)

    const pushResult = await uta!.push()
    console.log(`  pushed: submitted=${pushResult.submitted.length}, status=${pushResult.submitted[0]?.status}`)
    expect(pushResult.submitted).toHaveLength(1)
    expect(pushResult.rejected).toHaveLength(0)
    expect(pushResult.submitted[0].orderId).toBeDefined()

    const orderId = pushResult.submitted[0].orderId!

    // Cancel the order
    uta!.stageCancelOrder({ orderId })
    uta!.commit('e2e: cancel limit order')
    const cancelPush = await uta!.push()
    console.log(`  cancel pushed: submitted=${cancelPush.submitted.length}, status=${cancelPush.submitted[0]?.status}`)
    expect(cancelPush.submitted).toHaveLength(1)

    // Verify log has 2 commits
    expect(uta!.log().length).toBeGreaterThanOrEqual(2)
  }, 30_000)
})

// ==================== TPSL param pass-through (any time) ====================

describe('UTA — IBKR TPSL pass-through', () => {
  beforeEach(({ skip }) => { if (!uta) skip('no IBKR paper account') })

  it('tpsl param does not break order placement', async () => {
    const results = await broker!.searchContracts('AAPL')
    const nativeKey = broker!.getNativeKey(results[0].contract)
    const aliceId = `${uta!.id}|${nativeKey}`

    // Stage limit order with TPSL — IBKR ignores tpsl but it should not error
    uta!.stagePlaceOrder({
      aliceId, symbol: 'AAPL', action: 'BUY', orderType: 'LMT',
      lmtPrice: '1.00', totalQuantity: '1', tif: 'GTC',
      takeProfit: { price: '300' },
      stopLoss: { price: '100' },
    })
    uta!.commit('e2e: IBKR limit with TPSL (ignored)')
    const pushResult = await uta!.push()
    console.log(`  pushed with TPSL: submitted=${pushResult.submitted.length}, status=${pushResult.submitted[0]?.status}`)
    expect(pushResult.submitted).toHaveLength(1)
    expect(pushResult.rejected).toHaveLength(0)

    // Clean up
    const orderId = pushResult.submitted[0].orderId!
    uta!.stageCancelOrder({ orderId })
    uta!.commit('e2e: cancel TPSL order')
    await uta!.push()
  }, 30_000)
})

// ==================== Full fill flow (market hours only) ====================

describe('UTA — IBKR fill flow (AAPL)', () => {
  beforeEach(({ skip }) => {
    if (!uta) skip('no IBKR paper account')
    if (!marketOpen) skip('market closed')
  })

  it('buy → sync → verify → close → sync → verify', async () => {
    // Discover AAPL contract to get conId-based aliceId
    const results = await broker!.searchContracts('AAPL')
    const nativeKey = broker!.getNativeKey(results[0].contract)
    const aliceId = `${uta!.id}|${nativeKey}`

    // Record initial state
    const initialPositions = await broker!.getPositions()
    const initialAaplQty = initialPositions.find(p => p.contract.symbol === 'AAPL')?.quantity.toNumber() ?? 0
    console.log(`  initial AAPL qty=${initialAaplQty}`)

    // === Stage + Commit + Push: buy 1 AAPL ===
    const addResult = uta!.stagePlaceOrder({
      aliceId,
      symbol: 'AAPL',
      action: 'BUY',
      orderType: 'MKT',
      totalQuantity: '1',
    })
    expect(addResult.staged).toBe(true)

    const commitResult = uta!.commit('e2e: buy 1 AAPL')
    expect(commitResult.prepared).toBe(true)
    console.log(`  committed: hash=${commitResult.hash}`)

    const pushResult = await uta!.push()
    console.log(`  pushed: submitted=${pushResult.submitted.length}, status=${pushResult.submitted[0]?.status}`)
    expect(pushResult.submitted).toHaveLength(1)
    expect(pushResult.rejected).toHaveLength(0)
    expect(pushResult.submitted[0].orderId).toBeDefined()

    // === Sync: depends on whether fill was synchronous ===
    if (pushResult.submitted[0].status === 'submitted') {
      const sync1 = await uta!.sync({ delayMs: 3000 })
      console.log(`  sync1: updatedCount=${sync1.updatedCount}`)
      expect(sync1.updatedCount).toBe(1)
      expect(sync1.updates[0].currentStatus).toBe('filled')
    } else {
      console.log(`  sync1: skipped (already ${pushResult.submitted[0].status} at push time)`)
    }

    // === Verify: position exists ===
    const state1 = await uta!.getState()
    const aaplPos = state1.positions.find(p => p.contract.symbol === 'AAPL')
    expect(aaplPos).toBeDefined()
    expect(aaplPos!.quantity.toNumber()).toBe(initialAaplQty + 1)

    // === Close 1 AAPL ===
    // Wait for TWS to update positions after the buy fill
    await new Promise(r => setTimeout(r, 3000))
    uta!.stageClosePosition({ aliceId, qty: '1' })
    uta!.commit('e2e: close 1 AAPL')
    const closePush = await uta!.push()
    console.log(`  close pushed: status=${closePush.submitted[0]?.status}`)
    expect(closePush.submitted).toHaveLength(1)

    if (closePush.submitted[0].status === 'submitted') {
      const sync2 = await uta!.sync({ delayMs: 3000 })
      expect(sync2.updatedCount).toBe(1)
    }

    // === Verify: position back to initial ===
    const finalPositions = await broker!.getPositions()
    const finalAaplQty = finalPositions.find(p => p.contract.symbol === 'AAPL')?.quantity.toNumber() ?? 0
    expect(finalAaplQty).toBe(initialAaplQty)

    expect(uta!.log().length).toBeGreaterThanOrEqual(2)
  }, 60_000)
})
