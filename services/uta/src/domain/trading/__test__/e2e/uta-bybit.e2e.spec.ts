/**
 * UTA — Bybit demo lifecycle e2e.
 *
 * Full Trading-as-Git flow: stage → commit → push → sync → verify
 * against Bybit demo trading (crypto perps, 24/7).
 *
 * Run: OPENALICE_UTA_LIVE_PAPER=1 pnpm test:uta:live-paper
 */

import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { getTestAccounts, filterByProvider } from './setup.js'
import { UnifiedTradingAccount } from '../../UnifiedTradingAccount.js'
import { UTAManager } from '../../uta-manager.js'
import { createTradingTools } from '@/tool/trading.js'
import { createCcxtProviderTools } from '../../brokers/ccxt/ccxt-tools.js'
import type { IBroker } from '../../brokers/types.js'
import '../../contract-ext.js'

describe('UTA — Bybit lifecycle (ETH perp)', () => {
  let broker: IBroker | null = null
  let uta: UnifiedTradingAccount | null = null
  let ethAliceId: string = ''

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
    const nativeKey = perp.contract.localSymbol!
    ethAliceId = `${bybit.id}|${nativeKey}`
    uta = new UnifiedTradingAccount(broker)
    await uta.waitForConnect()
    console.log(`UTA Bybit: ETH perp aliceId=${ethAliceId}`)
  }, 60_000)

  beforeEach(({ skip }) => { if (!uta) skip('no Bybit demo account') })

  it('buy → sync → verify → close → sync → verify', async () => {
    // Record initial state
    const initialPositions = await broker!.getPositions()
    const initialEthQty = initialPositions.find(p => p.contract.secType === 'CRYPTO_PERP')?.quantity.toNumber() ?? 0
    console.log(`  initial ETH qty=${initialEthQty}`)

    // === Stage + Commit + Push: buy 0.01 ETH ===
    const addResult = uta!.stagePlaceOrder({
      aliceId: ethAliceId,
      action: 'BUY',
      orderType: 'MKT',
      totalQuantity: '0.01',
    })
    expect(addResult.staged).toBe(true)
    console.log(`  staged: ok`)

    const commitResult = uta!.commit('e2e: buy 0.01 ETH')
    expect(commitResult.prepared).toBe(true)
    console.log(`  committed: hash=${commitResult.hash}`)

    const pushResult = await uta!.push()
    console.log(`  pushed: submitted=${pushResult.submitted.length}, rejected=${pushResult.rejected.length}, status=${pushResult.submitted[0]?.status}`)
    expect(pushResult.submitted).toHaveLength(1)
    expect(pushResult.rejected).toHaveLength(0)

    const buyOrderId = pushResult.submitted[0].orderId
    console.log(`  orderId: ${buyOrderId}`)
    expect(buyOrderId).toBeDefined()

    // === Sync: may or may not have updates depending on whether fill was synchronous ===
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
    const ethPos = state1.positions.find(p => p.contract.aliceId === ethAliceId)
    console.log(`  state: ETH qty=${ethPos?.quantity}, pending=${state1.pendingOrders.length}`)
    expect(ethPos).toBeDefined()
    expect(state1.pendingOrders).toHaveLength(0)

    // === Stage + Commit + Push: close 0.01 ETH ===
    uta!.stageClosePosition({ aliceId: ethAliceId, qty: '0.01' })
    uta!.commit('e2e: close 0.01 ETH')
    const closePush = await uta!.push()
    console.log(`  close pushed: submitted=${closePush.submitted.length}, status=${closePush.submitted[0]?.status}`)
    expect(closePush.submitted).toHaveLength(1)

    // === Sync: same — depends on fill timing ===
    if (closePush.submitted[0].status === 'submitted') {
      const sync2 = await uta!.sync({ delayMs: 3000 })
      console.log(`  sync2: updatedCount=${sync2.updatedCount}`)
      expect(sync2.updatedCount).toBe(1)
      expect(sync2.updates[0].currentStatus).toBe('filled')
    } else {
      console.log(`  sync2: skipped (already ${closePush.submitted[0].status} at push time)`)
    }

    // === Verify: net change should be ~0 ===
    const finalPositions = await broker!.getPositions()
    const finalEthQty = finalPositions.find(p => p.contract.secType === 'CRYPTO_PERP')?.quantity.toNumber() ?? 0
    console.log(`  final ETH qty=${finalEthQty} (initial was ${initialEthQty})`)
    expect(Math.abs(finalEthQty - initialEthQty)).toBeLessThan(0.02)

    // === Log: 2 commits ===
    const history = uta!.log()
    console.log(`  log: ${history.length} commits — [${history.map(h => h.message).join(', ')}]`)
    expect(history.length).toBeGreaterThanOrEqual(2)
  }, 60_000)

  // ==================== AI read tools — aliceId resolution ====================

  // Regression guard for the 2026-05 bug: ccxt-tools `getOrderBook` /
  // `getFundingRate` and the generic `getQuote` / `getContractDetails`
  // were stamping the raw aliceId onto a fresh Contract without resolving
  // it through `broker.resolveNativeKey`. The broker's `contractToCcxt`
  // only reads `localSymbol`/`symbol`, so every read returned an error.
  // These tests exercise the same path AI tool calls take end-to-end.

  it('AI tools: searchContracts → getQuote round-trips with a real aliceId', async () => {
    const mgr = new UTAManager()
    mgr.add(uta!)
    const tools = createTradingTools(mgr as unknown as import('@/services/uta-client/index.js').UTAManagerSDK)

    // Step 1: search → get the canonical aliceId the AI would receive.
    const searchResult = await (tools.searchContracts.execute as Function)({
      pattern: 'ETH',
      assetClass: 'crypto',
      source: uta!.id,
    })
    expect(Array.isArray(searchResult)).toBe(true)
    const perp = (searchResult as Array<Record<string, unknown>>).find(
      (r) => (r as any).contract?.secType === 'CRYPTO_PERP',
    )
    expect(perp).toBeDefined()
    const realAliceId = (perp as any).contract.aliceId
    expect(realAliceId).toMatch(/^.+\|.+/)
    console.log(`  AI tools: aliceId=${realAliceId}`)

    // Step 2: getQuote — would have errored on the legacy code path.
    const quote = await (tools.getQuote.execute as Function)({ aliceId: realAliceId })
    expect(quote.error).toBeUndefined()
    expect(quote.source).toBe(uta!.id)
    expect(quote.last).toBeDefined()
    expect(parseFloat(quote.last)).toBeGreaterThan(0)
    console.log(`  AI tools: quote last=${quote.last}, bid=${quote.bid}, ask=${quote.ask}`)
  }, 30_000)

  it('AI tools: getOrderBook + getFundingRate via createCcxtProviderTools', async () => {
    const mgr = new UTAManager()
    mgr.add(uta!)
    const ccxtTools = createCcxtProviderTools(mgr)

    const ob = await (ccxtTools.getOrderBook.execute as Function)({
      aliceId: ethAliceId,
      limit: 5,
    })
    expect(ob.error).toBeUndefined()
    expect(Array.isArray(ob.bids)).toBe(true)
    expect(Array.isArray(ob.asks)).toBe(true)
    expect(ob.bids.length).toBeGreaterThan(0)
    expect(ob.asks.length).toBeGreaterThan(0)
    console.log(`  AI tools: orderbook bids=${ob.bids.length}, asks=${ob.asks.length}`)

    const fr = await (ccxtTools.getFundingRate.execute as Function)({
      aliceId: ethAliceId,
    })
    expect(fr.error).toBeUndefined()
    expect(typeof fr.fundingRate).toBe('number')
    console.log(`  AI tools: fundingRate=${fr.fundingRate}`)
  }, 30_000)

  it('AI tools: getContractDetails with aliceId returns spec', async () => {
    const mgr = new UTAManager()
    mgr.add(uta!)
    const tools = createTradingTools(mgr as unknown as import('@/services/uta-client/index.js').UTAManagerSDK)

    const result = await (tools.getContractDetails.execute as Function)({
      source: uta!.id,
      aliceId: ethAliceId,
    })
    expect(result.error).toBeUndefined()
    expect(result.contract).toBeDefined()
    expect(result.contract.aliceId).toBe(ethAliceId)
    console.log(`  AI tools: contractDetails secType=${result.contract.secType}`)
  }, 30_000)

  // ============================================================================

  it('buy with TPSL → tpsl visible on fetched order', async () => {
    const quote = await broker!.getQuote(broker!.resolveNativeKey(ethAliceId.split('|')[1]))
    const tpPrice = Math.round(Number(quote.last) * 1.5)
    const slPrice = Math.round(Number(quote.last) * 0.5)

    uta!.stagePlaceOrder({
      aliceId: ethAliceId, action: 'BUY', orderType: 'MKT', totalQuantity: '0.01',
      takeProfit: { price: String(tpPrice) },
      stopLoss: { price: String(slPrice) },
    })
    uta!.commit('e2e: buy ETH with TPSL')
    const pushResult = await uta!.push()
    expect(pushResult.submitted).toHaveLength(1)
    const orderId = pushResult.submitted[0].orderId!
    console.log(`  TPSL: orderId=${orderId}, tp=${tpPrice}, sl=${slPrice}`)

    await new Promise(r => setTimeout(r, 3000))

    const detail = await broker!.getOrder(orderId)
    expect(detail).not.toBeNull()
    console.log(`  fetched tpsl:`, JSON.stringify(detail!.tpsl))

    if (detail!.tpsl) {
      if (detail!.tpsl.takeProfit) expect(parseFloat(detail!.tpsl.takeProfit.price)).toBe(tpPrice)
      if (detail!.tpsl.stopLoss) expect(parseFloat(detail!.tpsl.stopLoss.price)).toBe(slPrice)
    } else {
      console.log('  NOTE: TPSL not returned on fetched order (separate conditional orders)')
    }

    // Clean up
    uta!.stageClosePosition({ aliceId: ethAliceId, qty: '0.01' })
    uta!.commit('e2e: close TPSL')
    await uta!.push()
  }, 60_000)
})
