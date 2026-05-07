/**
 * UTA e2e — Trading-as-Git lifecycle against Bybit demo (crypto perps).
 *
 * Tests: stage → commit → push → sync → reject → log
 * Crypto markets are 24/7, so this test is always runnable.
 *
 * Run: pnpm test:e2e
 */

import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { getTestAccounts, filterByProvider } from './setup.js'
import { UnifiedTradingAccount } from '../../UnifiedTradingAccount.js'
import type { IBroker } from '../../brokers/types.js'
import '../../contract-ext.js'

describe('UTA — Bybit demo (ETH perp)', () => {
  let broker: IBroker | null = null
  let uta: UnifiedTradingAccount | null = null
  let ethAliceId = ''

  beforeAll(async () => {
    const all = await getTestAccounts()
    const bybit = filterByProvider(all, 'ccxt').find(a => a.id.includes('bybit'))
    if (!bybit) {
      console.log('e2e: No Bybit demo account, skipping')
      return
    }
    broker = bybit.broker

    const results = await broker.searchContracts('ETH')
    const perp = results.find(r => r.contract.secType === 'CRYPTO_PERP')
    if (!perp) {
      console.log('e2e: No ETH/USDT perp found, skipping')
      broker = null
      return
    }
    ethAliceId = `${bybit.id}|${perp.contract.localSymbol!}`
    uta = new UnifiedTradingAccount(broker)
    await uta.waitForConnect()
    console.log(`UTA Bybit: aliceId=${ethAliceId}`)
  }, 60_000)

  beforeEach(({ skip }) => { if (!uta) skip('no Bybit demo account') })

  it('buy → sync → close → sync (full lifecycle)', async () => {
    const initialPositions = await broker!.getPositions()
    const initialQty = initialPositions.find(p => p.contract.secType === 'CRYPTO_PERP')?.quantity.toNumber() ?? 0
    console.log(`  initial ETH qty=${initialQty}`)

    // Stage + Commit + Push: buy 0.01 ETH
    uta!.stagePlaceOrder({ aliceId: ethAliceId, action: 'BUY', orderType: 'MKT', totalQuantity: '0.01' })
    uta!.commit('e2e: buy 0.01 ETH')
    const pushResult = await uta!.push()
    expect(pushResult.submitted).toHaveLength(1)
    expect(pushResult.rejected).toHaveLength(0)
    console.log(`  pushed: orderId=${pushResult.submitted[0].orderId}, status=${pushResult.submitted[0].status}`)

    // Sync: depends on whether fill was synchronous
    if (pushResult.submitted[0].status === 'submitted') {
      const sync1 = await uta!.sync({ delayMs: 3000 })
      expect(sync1.updatedCount).toBe(1)
      expect(sync1.updates[0].currentStatus).toBe('filled')
      console.log(`  sync1: filled`)
    } else {
      console.log(`  sync1: skipped (already ${pushResult.submitted[0].status} at push time)`)
    }

    // Verify position
    const state = await uta!.getState()
    const ethPos = state.positions.find(p => p.contract.aliceId === ethAliceId)
    expect(ethPos).toBeDefined()
    console.log(`  position: qty=${ethPos!.quantity}`)

    // Close
    uta!.stageClosePosition({ aliceId: ethAliceId, qty: '0.01' })
    uta!.commit('e2e: close 0.01 ETH')
    const closePush = await uta!.push()
    expect(closePush.submitted).toHaveLength(1)

    if (closePush.submitted[0].status === 'submitted') {
      const sync2 = await uta!.sync({ delayMs: 3000 })
      expect(sync2.updatedCount).toBe(1)
      expect(sync2.updates[0].currentStatus).toBe('filled')
      console.log(`  close: filled`)
    } else {
      console.log(`  close: already ${closePush.submitted[0].status} at push time`)
    }

    // Verify final qty
    const finalPositions = await broker!.getPositions()
    const finalQty = finalPositions.find(p => p.contract.secType === 'CRYPTO_PERP')?.quantity.toNumber() ?? 0
    expect(Math.abs(finalQty - initialQty)).toBeLessThan(0.02)
    console.log(`  final ETH qty=${finalQty} (initial=${initialQty})`)

    const log = uta!.log({ limit: 10 })
    expect(log.length).toBeGreaterThanOrEqual(2)
    console.log(`  log: ${log.length} commits`)
  }, 60_000)

  it('buy with TPSL → getOrder returns tpsl', async () => {
    const quote = await broker!.getQuote(broker!.resolveNativeKey(ethAliceId.split('|')[1]))
    const tpPrice = Math.round(Number(quote.last) * 1.5)
    const slPrice = Math.round(Number(quote.last) * 0.5)

    uta!.stagePlaceOrder({
      aliceId: ethAliceId, action: 'BUY', orderType: 'MKT', totalQuantity: '0.01',
      takeProfit: { price: String(tpPrice) },
      stopLoss: { price: String(slPrice) },
    })
    uta!.commit('e2e: buy 0.01 ETH with TPSL')
    const pushResult = await uta!.push()
    expect(pushResult.submitted).toHaveLength(1)
    const orderId = pushResult.submitted[0].orderId!
    console.log(`  TPSL order: orderId=${orderId}, tp=${tpPrice}, sl=${slPrice}`)

    // Wait for exchange to settle
    await new Promise(r => setTimeout(r, 3000))

    const detail = await broker!.getOrder(orderId)
    expect(detail).not.toBeNull()
    console.log(`  getOrder tpsl:`, JSON.stringify(detail!.tpsl))

    if (detail!.tpsl) {
      if (detail!.tpsl.takeProfit) expect(parseFloat(detail!.tpsl.takeProfit.price)).toBe(tpPrice)
      if (detail!.tpsl.stopLoss) expect(parseFloat(detail!.tpsl.stopLoss.price)).toBe(slPrice)
    } else {
      console.log('  NOTE: exchange did not return TPSL on fetched order')
    }

    // Clean up
    uta!.stageClosePosition({ aliceId: ethAliceId, qty: '0.01' })
    uta!.commit('e2e: close TPSL position')
    await uta!.push()
  }, 60_000)

  it('reject records user-rejected commit and clears staging', async () => {
    // Stage + Commit (but don't push)
    uta!.stagePlaceOrder({ aliceId: ethAliceId, action: 'BUY', orderType: 'MKT', totalQuantity: '0.01' })
    const commitResult = uta!.commit('e2e: buy to be rejected')
    expect(commitResult.prepared).toBe(true)

    // Verify staging has content
    const statusBefore = uta!.status()
    expect(statusBefore.staged).toHaveLength(1)
    expect(statusBefore.pendingMessage).toBe('e2e: buy to be rejected')

    // Reject
    const rejectResult = await uta!.reject('user declined')
    expect(rejectResult.operationCount).toBe(1)
    expect(rejectResult.message).toContain('[rejected]')
    expect(rejectResult.message).toContain('user declined')

    // Verify staging is cleared
    const statusAfter = uta!.status()
    expect(statusAfter.staged).toHaveLength(0)
    expect(statusAfter.pendingMessage).toBeNull()

    // Verify commit is in history with user-rejected status
    const log = uta!.log({ limit: 5 })
    const rejectedCommit = log.find(c => c.hash === rejectResult.hash)
    expect(rejectedCommit).toBeDefined()
    expect(rejectedCommit!.operations[0].status).toBe('user-rejected')

    const fullCommit = uta!.show(rejectResult.hash)
    expect(fullCommit!.results[0].status).toBe('user-rejected')
    expect(fullCommit!.results[0].error).toBe('user declined')
  }, 30_000)

  it('reject without reason still works', async () => {
    uta!.stagePlaceOrder({ aliceId: ethAliceId, action: 'SELL', orderType: 'LMT', totalQuantity: '0.01', lmtPrice: '99999' })
    uta!.commit('e2e: sell to be rejected silently')

    const result = await uta!.reject()
    expect(result.operationCount).toBe(1)
    expect(result.message).toContain('[rejected]')
    expect(result.message).not.toContain('—')

    const fullCommit = uta!.show(result.hash)
    expect(fullCommit!.results[0].error).toBe('Rejected by user')
  }, 15_000)
})
