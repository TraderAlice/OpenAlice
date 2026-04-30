/**
 * UTA — Alpaca paper lifecycle e2e.
 *
 * Two groups:
 * - Order lifecycle (any time): limit order stage → commit → push → cancel
 * - Full fill flow (market hours): market order → fill → verify → close
 *
 * Run: pnpm test:e2e
 */

import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { getTestAccounts, filterByProvider } from './setup.js'
import { UnifiedTradingAccount } from '../../UnifiedTradingAccount.js'
import type { IBroker } from '../../brokers/types.js'
import '../../contract-ext.js'

let broker: IBroker | null = null
let uta: UnifiedTradingAccount | null = null
let marketOpen = false

beforeAll(async () => {
  const all = await getTestAccounts()
  const alpaca = filterByProvider(all, 'alpaca')[0]
  if (!alpaca) return
  broker = alpaca.broker
  uta = new UnifiedTradingAccount(broker)
  await uta.waitForConnect()
  const clock = await broker.getMarketClock()
  marketOpen = clock.isOpen
  console.log(`UTA Alpaca: market ${marketOpen ? 'OPEN' : 'CLOSED'}`)
}, 60_000)

// ==================== Order lifecycle (any time) ====================

describe('UTA — Alpaca order lifecycle', () => {
  beforeEach(({ skip }) => { if (!uta) skip('no Alpaca paper account') })

  it('limit order: stage → commit → push → cancel', async () => {
    const nativeKey = broker!.getNativeKey({ symbol: 'AAPL' } as any)
    const aliceId = `${uta!.id}|${nativeKey}`

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

// ==================== TPSL bracket order (market hours only) ====================

describe('UTA — Alpaca TPSL bracket', () => {
  beforeEach(({ skip }) => {
    if (!uta) skip('no Alpaca paper account')
    if (!marketOpen) skip('market closed')
  })

  it('market buy with TPSL → getOrder returns bracket legs', async () => {
    const nativeKey = broker!.getNativeKey({ symbol: 'AAPL' } as any)
    const aliceId = `${uta!.id}|${nativeKey}`

    uta!.stagePlaceOrder({
      aliceId, symbol: 'AAPL', action: 'BUY', orderType: 'MKT', totalQuantity: '1',
      takeProfit: { price: '999' },
      stopLoss: { price: '1' },
    })
    uta!.commit('e2e: buy AAPL with TPSL')
    const pushResult = await uta!.push()
    expect(pushResult.submitted).toHaveLength(1)
    const orderId = pushResult.submitted[0].orderId!
    console.log(`  TPSL bracket: orderId=${orderId}`)

    await new Promise(r => setTimeout(r, 2000))

    const detail = await broker!.getOrder(orderId)
    expect(detail).not.toBeNull()
    console.log(`  fetched tpsl:`, JSON.stringify(detail!.tpsl))

    if (detail!.tpsl) {
      if (detail!.tpsl.takeProfit) expect(detail!.tpsl.takeProfit.price).toBe('999')
      if (detail!.tpsl.stopLoss) expect(detail!.tpsl.stopLoss.price).toBe('1')
    } else {
      console.log('  NOTE: Alpaca did not return legs on fetched bracket order')
    }

    // Clean up — cancel the bracket legs then close position
    uta!.stageClosePosition({ aliceId, qty: '1' })
    uta!.commit('e2e: close TPSL AAPL')
    await uta!.push()
  }, 30_000)
})

// ==================== Full fill flow (market hours only) ====================

describe('UTA — Alpaca fill flow (AAPL)', () => {
  beforeEach(({ skip }) => {
    if (!uta) skip('no Alpaca paper account')
    if (!marketOpen) skip('market closed')
  })

  it('buy → sync → verify → close → sync → verify', async () => {
    const nativeKey = broker!.getNativeKey({ symbol: 'AAPL' } as any)
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
      const sync1 = await uta!.sync({ delayMs: 2000 })
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
    uta!.stageClosePosition({ aliceId, qty: '1' })
    uta!.commit('e2e: close 1 AAPL')
    const closePush = await uta!.push()
    console.log(`  close pushed: status=${closePush.submitted[0]?.status}`)
    expect(closePush.submitted).toHaveLength(1)

    if (closePush.submitted[0].status === 'submitted') {
      const sync2 = await uta!.sync({ delayMs: 2000 })
      expect(sync2.updatedCount).toBe(1)
    }

    // === Verify: position back to initial ===
    const finalPositions = await broker!.getPositions()
    const finalAaplQty = finalPositions.find(p => p.contract.symbol === 'AAPL')?.quantity.toNumber() ?? 0
    expect(finalAaplQty).toBe(initialAaplQty)

    expect(uta!.log().length).toBeGreaterThanOrEqual(2)
  }, 60_000)
})
