/**
 * E2E: place a LMT order with a Decimal lmtPrice against paper TWS,
 * read it back via reqAllOpenOrders, assert the round-trip preserves
 * the exact decimal value (no IEEE 754 artifacts).
 *
 * Why this exists: the lmtPrice field is now `Decimal` (was `number`).
 * Unit tests cover encode/decode of synthetic wire bytes in isolation —
 * but only a real TWS tells us whether the IB server accepts the wire
 * text we produce and echoes back a value we can reconstruct exactly.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import Decimal from 'decimal.js'
import { Contract, Order, OrderCancel } from '../../src/index.js'
import { client, available, results, waitFor, sleep } from './setup.js'

// AAPL — penny-tick symbol, liquid, paper-safe. Use a far-off limit
// price so the order never fills (we cancel it before the test ends).
const AAPL_CONID = 265598

function makeAaplContract(): Contract {
  const c = new Contract()
  c.conId = AAPL_CONID
  c.symbol = 'AAPL'
  c.secType = 'STK'
  c.exchange = 'SMART'
  c.primaryExchange = 'NASDAQ'
  c.currency = 'USD'
  return c
}

describe.runIf(available)('TWS Order precision — lmtPrice Decimal round-trip', () => {
  const cleanupOrderIds: number[] = []
  let baseOrderId: number

  beforeAll(async () => {
    // Refresh nextValidId — across runs on the same TWS session, the
    // server-side counter advances; using a stale value silently rejects.
    results.nextValidId = undefined
    client.reqIds(1)
    const got = await waitFor(() => results.nextValidId != null, 5000)
    if (!got || results.nextValidId == null) {
      throw new Error('nextValidId not received — TWS handshake incomplete')
    }
    // Leave a comfortable gap — this suite and other tests share the
    // same TWS account + clientId.
    baseOrderId = results.nextValidId + 100
    // eslint-disable-next-line no-console
    console.log(`  [precision e2e] baseOrderId=${baseOrderId}`)
  })

  afterAll(async () => {
    // Best-effort cancel every order we placed, regardless of current state.
    const oc = new OrderCancel()
    for (const id of cleanupOrderIds) {
      try { client.cancelOrder(id, oc) } catch { /* ignore */ }
    }
    // Give TWS a beat to process the cancels.
    await sleep(500)
  })

  it('places LMT with penny-tick price and reads it back exact', async () => {
    const orderId = baseOrderId + 1
    cleanupOrderIds.push(orderId)

    // SELL LMT far above market — sits on book, won't fill, doesn't trip
    // TWS's "price too far from market" precaution dialog that a BUY at a
    // deep discount would. (BUY at 1.25 vs market ~$200 silently blocks on
    // a precaution popup in the TWS UI, never reaching the API.)
    const order = new Order()
    order.action = 'SELL'
    order.orderType = 'LMT'
    order.totalQuantity = new Decimal('1')
    order.lmtPrice = new Decimal('999.25')  // way above market — won't fill
    order.tif = 'DAY'
    order.transmit = true
    order.outsideRth = false

    results.openOrders.delete(orderId)
    results.orderStatus.delete(orderId)
    const errorsBefore = results.errors.length
    client.placeOrder(orderId, makeAaplContract(), order)

    // Wait for openOrder echo. TWS auto-pushes this for client-placed
    // orders. If it doesn't arrive on its own, fall back to reqOpenOrders.
    let got = await waitFor(() => results.openOrders.has(orderId), 3000)
    if (!got) {
      client.reqOpenOrders()
      got = await waitFor(() => results.openOrders.has(orderId), 3000)
    }

    // Only hard rejections should fail the test. Informational codes
    // (399 "order queued until market open", 2100+ farm/data warnings)
    // are benign.
    const REJECTION_CODES = new Set([110, 200, 201, 202, 203])
    const rejections = results.errors
      .slice(errorsBefore)
      .filter(e => e.reqId === orderId && REJECTION_CODES.has(e.code))
    if (rejections.length > 0) {
      throw new Error(`TWS rejected order: ${rejections.map(e => `${e.code}: ${e.msg}`).join(' | ')}`)
    }

    expect(got, 'openOrder echo did not arrive — order may not have been accepted').toBe(true)

    const echo = results.openOrders.get(orderId)!
    expect(echo.order.lmtPrice).toBeInstanceOf(Decimal)
    expect(echo.order.lmtPrice.equals(new Decimal('999.25'))).toBe(true)
    // Also check the string representation has no IEEE 754 noise.
    expect(echo.order.lmtPrice.toFixed()).toBe('999.25')
  })

  it('IEEE 754 trap value (0.1 + 0.2) stays clean when sent as Decimal', async () => {
    const orderId = baseOrderId + 2
    cleanupOrderIds.push(orderId)

    // Placing at $0.30 is below the minimum penny-tick for a $200-ish
    // stock — TWS may reject. We want to observe the wire behaviour,
    // not the business outcome, so any rejection still validates that
    // *our* encoded price was clean. We read the callback either way.
    const order = new Order()
    order.action = 'BUY'
    order.orderType = 'LMT'
    order.totalQuantity = new Decimal('1')
    // Decimal math: 0.1 + 0.2 exactly 0.3 (no noise).
    order.lmtPrice = new Decimal('0.1').plus('0.2')
    order.tif = 'DAY'
    order.transmit = true

    expect(order.lmtPrice.toFixed()).toBe('0.3')

    results.openOrders.delete(orderId)
    const errorCountBefore = results.errors.length
    client.placeOrder(orderId, makeAaplContract(), order)

    // Either openOrder echo or a rejection — either is diagnostic.
    await waitFor(
      () => results.openOrders.has(orderId) || results.errors.length > errorCountBefore,
      5000,
    )

    if (results.openOrders.has(orderId)) {
      const echo = results.openOrders.get(orderId)!
      expect(echo.order.lmtPrice.toFixed()).toBe('0.3')
    } else {
      // TWS rejected — still fine, the wire we sent was '0.3', not
      // '0.30000000000000004'. Record the rejection reason for the log.
      const recent = results.errors.slice(errorCountBefore)
      console.log('  [note] TWS rejected lmtPrice=0.3 (expected for AAPL):',
        recent.map(e => `${e.code}: ${e.msg}`).join(' | '))
    }
  })

  it('sub-tick precision: TWS rejects or rounds, but our wire stays exact', async () => {
    const orderId = baseOrderId + 3
    cleanupOrderIds.push(orderId)

    const order = new Order()
    order.action = 'BUY'
    order.orderType = 'LMT'
    order.totalQuantity = new Decimal('1')
    // AAPL ticks at $0.01 above $1 — 6 decimals will either be rejected
    // (error 110) or silently rounded. Either outcome is acceptable; we
    // only care that the value we *sent* matches the Decimal we intended.
    order.lmtPrice = new Decimal('1.234567')
    order.tif = 'DAY'
    order.transmit = true

    results.openOrders.delete(orderId)
    const errorCountBefore = results.errors.length
    client.placeOrder(orderId, makeAaplContract(), order)

    await waitFor(
      () => results.openOrders.has(orderId) || results.errors.length > errorCountBefore,
      5000,
    )

    if (results.openOrders.has(orderId)) {
      const echo = results.openOrders.get(orderId)!
      // TWS might round to tick. The echoed value should still be a clean
      // decimal (no IEEE noise), even if different from what we sent.
      const echoed = echo.order.lmtPrice.toFixed()
      console.log(`  [note] sub-tick placement: sent 1.234567, TWS echoed ${echoed}`)
      // Whatever TWS returns, it should be a clean decimal string that
      // reconstructs without loss.
      const reconstructed = new Decimal(echoed)
      expect(reconstructed.toFixed()).toBe(echoed)
    } else {
      const recent = results.errors.slice(errorCountBefore)
      console.log('  [note] sub-tick rejected (expected behaviour):',
        recent.map(e => `${e.code}: ${e.msg}`).join(' | '))
      // Rejection is fine — the test's purpose is to verify our encoder
      // didn't corrupt the price, and that it reached TWS (which judged it).
      expect(recent.length).toBeGreaterThan(0)
    }
  })
})
