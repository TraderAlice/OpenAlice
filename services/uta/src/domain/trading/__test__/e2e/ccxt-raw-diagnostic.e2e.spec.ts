/**
 * Raw CCXT diagnostic — uses the shared broker's exchange instance.
 * Purpose: understand what Bybit demoTrading actually returns.
 * This performs a market buy with best-effort close and is deliberately
 * excluded from the aggregate paper sweep.
 * Run: OPENALICE_UTA_LIVE_PAPER=1 pnpm test:live:bybit-diagnostic
 */

import { describe, it, beforeAll, beforeEach } from 'vitest'
import type { Exchange } from 'ccxt'
import { getTestAccounts, filterByProvider } from './setup.js'

let exchange: Exchange | null = null

beforeAll(async () => {
  const all = await getTestAccounts()
  const bybit = filterByProvider(all, 'ccxt').find(a => a.id.includes('bybit'))
  if (!bybit) { console.log('No Bybit account, skipping diagnostic'); return }
  exchange = (bybit.broker as any).exchange
  console.log(`Diagnostic: using ${bybit.label}'s exchange (${Object.keys(exchange!.markets).length} markets)`)
}, 60_000)

describe('Raw CCXT Bybit diagnostic', () => {
  beforeEach(({ skip }) => { if (!exchange) skip('no Bybit account') })

  /** Narrow exchange type — beforeEach guarantees non-null via skip(). */
  function e(): Exchange { return exchange! }

  it('createOrder → inspect full response', async () => {

    const result = await e().createOrder('ETH/USDT:USDT', 'market', 'buy', 0.01)
    console.log('\n=== createOrder response ===')
    console.log(JSON.stringify({
      id: result.id,
      clientOrderId: result.clientOrderId,
      status: result.status,
      symbol: result.symbol,
      type: result.type,
      side: result.side,
      amount: result.amount,
      filled: result.filled,
      remaining: result.remaining,
      average: result.average,
      price: result.price,
      cost: result.cost,
      datetime: result.datetime,
      timestamp: result.timestamp,
      fee: result.fee,
      info: result.info, // raw exchange response
    }, null, 2))

    // Clean up
    await e().createOrder('ETH/USDT:USDT', 'market', 'sell', 0.01, undefined, { reduceOnly: true }).catch(() => {})
  }, 15_000)

  it('fetchClosedOrders → inspect ids and format', async () => {


    const closed = await e().fetchClosedOrders('ETH/USDT:USDT', undefined, 5)
    console.log(`\n=== fetchClosedOrders: ${closed.length} orders ===`)
    for (const o of closed) {
      console.log(JSON.stringify({
        id: o.id,
        clientOrderId: o.clientOrderId,
        status: o.status,
        symbol: o.symbol,
        side: o.side,
        amount: o.amount,
        filled: o.filled,
        average: o.average,
        datetime: o.datetime,
      }))
    }
  }, 15_000)

  it('fetchOpenOrders → inspect', async () => {


    const open = await e().fetchOpenOrders('ETH/USDT:USDT')
    console.log(`\n=== fetchOpenOrders: ${open.length} orders ===`)
    for (const o of open) {
      console.log(JSON.stringify({
        id: o.id,
        status: o.status,
        symbol: o.symbol,
        side: o.side,
        amount: o.amount,
      }))
    }
  }, 15_000)

  it('compare orderId format: spot vs perp', async () => {


    const hasSpot = !!e().markets['ETH/USDT']
    const hasPerp = !!e().markets['ETH/USDT:USDT']
    console.log(`\n=== spot ETH/USDT exists: ${hasSpot}, perp ETH/USDT:USDT exists: ${hasPerp} ===`)

    if (hasPerp) {
      const perpOrder = await e().createOrder('ETH/USDT:USDT', 'market', 'buy', 0.01)
      console.log(`perp orderId: ${perpOrder.id} (type: ${typeof perpOrder.id})`)
      await e().createOrder('ETH/USDT:USDT', 'market', 'sell', 0.01, undefined, { reduceOnly: true }).catch(() => {})
    }

    if (hasSpot) {
      try {
        const spotOrder = await e().createOrder('ETH/USDT', 'market', 'buy', 0.01)
        console.log(`spot orderId: ${spotOrder.id} (type: ${typeof spotOrder.id})`)
      } catch (err: any) {
        console.log(`spot order failed: ${err.message}`)
      }
    }
  }, 30_000)

  it('check market.id vs market.symbol for ETH perps', async () => {

    const candidates = Object.values(e().markets).filter(
      m => m.base === 'ETH' && m.quote === 'USDT',
    )
    console.log('\n=== ETH/USDT markets ===')
    for (const m of candidates) {
      console.log(`  id=${m.id} symbol=${m.symbol} type=${m.type} settle=${m.settle}`)
    }
  })

  it('fetchClosedOrders: no limit vs with since', async () => {


    // 1. No limit — how many do we get?
    const noLimit = await e().fetchClosedOrders('ETH/USDT:USDT')
    console.log(`\n=== fetchClosedOrders (no limit): ${noLimit.length} orders ===`)
    if (noLimit.length > 0) {
      console.log(`  oldest: ${noLimit[0].datetime} id=${noLimit[0].id}`)
      console.log(`  newest: ${noLimit[noLimit.length - 1].datetime} id=${noLimit[noLimit.length - 1].id}`)
    }

    // 2. With since = 2 minutes ago
    const since = Date.now() - 2 * 60 * 1000
    const recent = await e().fetchClosedOrders('ETH/USDT:USDT', since)
    console.log(`\nfetchClosedOrders (since 2min ago): ${recent.length} orders`)
    for (const o of recent.slice(0, 5)) {
      console.log(`  id=${o.id} status=${o.status} datetime=${o.datetime}`)
    }

    // 3. Place an order, then query with since
    const placed = await e().createOrder('ETH/USDT:USDT', 'market', 'buy', 0.01)
    console.log(`\nplaced: ${placed.id}`)
    await new Promise(r => setTimeout(r, 500))

    const afterPlace = await e().fetchClosedOrders('ETH/USDT:USDT', Date.now() - 10_000)
    console.log(`fetchClosedOrders (since 10s ago): ${afterPlace.length} orders`)
    const found = afterPlace.find(o => o.id === placed.id)
    console.log(`match: ${found ? `FOUND status=${found.status}` : 'NOT FOUND'}`)

    // Clean up
    await e().createOrder('ETH/USDT:USDT', 'market', 'sell', 0.01, undefined, { reduceOnly: true }).catch(() => {})
  }, 30_000)
})
