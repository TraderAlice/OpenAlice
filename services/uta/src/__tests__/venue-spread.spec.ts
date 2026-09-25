/**
 * Cross-venue spread — `UTAManager.getVenueSpread`, driven end-to-end against
 * real MockBroker instances, one independent mark price per venue.
 *
 * The primitive is READ-ONLY, and these tests pin that boundary as hard as the
 * arithmetic: a venue is asked for its quote and nothing else. The edges are
 * the fail-closed ones — a leg that answers without a two-sided quote is
 * excluded rather than priced at 0, and legs that do not name the same
 * instrument are refused outright rather than compared.
 */
import { setTimeout as delay } from 'node:timers/promises'
import { describe, expect, it, vi } from 'vitest'
import type { Contract } from '@traderalice/ibkr'
import { BrokerError } from '@traderalice/uta-protocol'
import { MockBroker, makeContract } from '../domain/trading/brokers/mock/index.js'
import { UTAManager } from '../domain/trading/uta-manager.js'
import { UnifiedTradingAccount } from '../domain/trading/UnifiedTradingAccount.js'
import '../domain/trading/contract-ext.js'

const KEY = 'BTC/USDT:USDT'
const A = `venue-a|${KEY}`
const B = `venue-b|${KEY}`

/** Seed a venue with one tradeable BTC contract at a known mark price.
 *  MockBroker quotes both sides at markPrice ± 0.01. */
function seed(broker: MockBroker, markPrice: string, contract: Partial<Contract> = {}): void {
  broker.externalDeposit({
    nativeKey: KEY,
    quantity: 1,
    contract: { symbol: 'BTC', secType: 'CRYPTO', currency: 'USDT', ...contract, localSymbol: KEY },
  })
  broker.setMarkPrice(KEY, markPrice)
}

/** A quote whose two sides are unusable — what a keyless binance leg returns
 *  (`String(ticker.bid ?? 0)` upstream), with a real `last` alongside. */
const zeroSidedQuote = (aliceId: string) => ({
  contract: makeContract({ symbol: 'BTC', secType: 'CRYPTO', currency: 'USDT', localSymbol: KEY, aliceId }),
  last: '80100', bid: '0', ask: '0', volume: '0', timestamp: new Date(),
})

async function makeManager(...brokers: MockBroker[]): Promise<UTAManager> {
  const mgr = new UTAManager()
  for (const broker of brokers) {
    const uta = new UnifiedTradingAccount(broker)
    mgr.add(uta)
    // Settle the initial connect so health is decided before the test reads.
    await uta.waitForConnect().catch(() => {})
  }
  return mgr
}

describe('UTAManager.getVenueSpread', () => {
  it('reads the venues and reports the executable and mid spreads', async () => {
    const a = new MockBroker({ id: 'venue-a' })
    const b = new MockBroker({ id: 'venue-b' })
    seed(a, '80000')
    seed(b, '80100')
    const mgr = await makeManager(a, b)

    const result = await mgr.getVenueSpread([A, B])

    expect(result.pairingKey).toBe('BTC|USDT|SPOT')
    expect(result.legs.map((leg) => leg.source)).toEqual(['venue-a', 'venue-b'])
    expect(result.legs.map((leg) => [leg.bid, leg.ask, leg.last])).toEqual([
      ['79999.99', '80000.01', '80000'],
      ['80099.99', '80100.01', '80100'],
    ])
    expect(result.legs.every((leg) => leg.error === undefined)).toBe(true)
    expect(result.legs[0].localSymbol).toBe(KEY)
    expect(result.legs[0].aliceId).toBe(A)
    // Sell the higher bid, buy the lower ask: buying on venue-a (80,000.01)
    // and selling on venue-b (80,099.99) is worth 99.98.
    expect(result.executableSpread).toEqual({
      buyOn: 'venue-a',
      sellOn: 'venue-b',
      buyAt: '80000.01',
      sellAt: '80099.99',
      abs: '99.98',
      bps: '12.4897',
    })
    expect(result.midSpread).toEqual({
      lowAt: 'venue-a',
      highAt: 'venue-b',
      abs: '100',
      bps: '12.4922',
    })
  })

  it('stamps the envelope before dispatch and reports per-leg timing', async () => {
    const a = new MockBroker({ id: 'venue-a' })
    const b = new MockBroker({ id: 'venue-b' })
    seed(a, '80000')
    seed(b, '80100')
    const mgr = await makeManager(a, b)

    const result = await mgr.getVenueSpread([A, B])

    // The envelope is taken before the fan-out, so it never postdates a leg.
    expect(Date.parse(result.asOf)).toBeLessThanOrEqual(Date.parse(result.legs[0].observedAt))
    expect(Number.isFinite(result.skewMs)).toBe(true)
    expect(result.skewMs).toBeGreaterThanOrEqual(0)
    expect(result.legs.every((leg) => Number.isFinite(leg.latencyMs) && leg.latencyMs >= 0)).toBe(true)
  })

  it('attributes latency to the slow leg, and skew to the fan-out', async () => {
    const fast = new MockBroker({ id: 'venue-a' })
    const slow = new MockBroker({ id: 'venue-b' })
    seed(fast, '80000')
    seed(slow, '80100')
    const mgr = await makeManager(fast, slow)
    const realGetQuote = slow.getQuote.bind(slow)
    vi.spyOn(slow, 'getQuote').mockImplementation(async (contract) => {
      await delay(60)
      return realGetQuote(contract)
    })

    const result = await mgr.getVenueSpread([A, B])
    const [legA, legB] = result.legs

    // Each leg is timed on its own read, not on the shared envelope.
    expect(legB.latencyMs).toBeGreaterThanOrEqual(50)
    expect(legA.latencyMs).toBeLessThan(40)
    // And the fan-out skew reflects the slow leg finishing last.
    expect(result.skewMs).toBeGreaterThanOrEqual(50)
  })

  it('reads quotes and touches nothing else on any venue', async () => {
    const a = new MockBroker({ id: 'venue-a' })
    const b = new MockBroker({ id: 'venue-b' })
    seed(a, '80000')
    seed(b, '80100')
    const mgr = await makeManager(a, b)
    a.resetCalls()
    b.resetCalls()

    await mgr.getVenueSpread([A, B])

    // The whole contract of this primitive: read-only. Any order path
    // (placeOrder / modifyOrder / cancelOrder / closePosition) would show up
    // here as an extra recorded call.
    expect(a.calls().map((call) => call.method)).toEqual(['getQuote'])
    expect(b.calls().map((call) => call.method)).toEqual(['getQuote'])
  })

  it('reports a failing venue as an errored leg without failing the call', async () => {
    const a = new MockBroker({ id: 'venue-a' })
    const b = new MockBroker({ id: 'venue-b' })
    const c = new MockBroker({ id: 'venue-c' })
    seed(a, '80000')
    seed(b, '80100')
    seed(c, '80200')
    const mgr = await makeManager(a, b, c)
    vi.spyOn(c, 'getQuote').mockRejectedValue(new BrokerError('NETWORK', 'venue-c unreachable'))

    const result = await mgr.getVenueSpread([A, B, `venue-c|${KEY}`])

    expect(result.legs).toHaveLength(3)
    expect(result.legs[2].source).toBe('venue-c')
    expect(result.legs[2].error).toMatch(/venue-c unreachable/)
    expect(result.legs[2].bid).toBeNull()
    expect(result.legs[2].ask).toBeNull()
    // The two venues that answered still produce a spread.
    expect(result.executableSpread?.buyOn).toBe('venue-a')
    expect(result.executableSpread?.sellOn).toBe('venue-b')
    expect(result.executableSpread?.abs).toBe('99.98')
  })

  it('reports an aliceId naming no known account as an errored leg', async () => {
    const a = new MockBroker({ id: 'venue-a' })
    const b = new MockBroker({ id: 'venue-b' })
    seed(a, '80000')
    seed(b, '80100')
    const mgr = await makeManager(a, b)

    const result = await mgr.getVenueSpread([A, `ghost|${KEY}`, B])

    expect(result.legs[1].source).toBe('')
    expect(result.legs[1].error).toMatch(/No UTA matches/)
    expect(result.executableSpread?.abs).toBe('99.98')
  })

  it('soft-fails a venue whose account is not healthy, without failing the call', async () => {
    const a = new MockBroker({ id: 'venue-a' })
    const b = new MockBroker({ id: 'venue-b' })
    const sick = new MockBroker({ id: 'venue-sick' })
    seed(a, '80000')
    seed(b, '80100')
    seed(sick, '80200')
    // Connects fine, but its private account read fails: reachable below the
    // account's target → the UTA is not `healthy` (issue #390's degraded case).
    sick.setFailMethod('getAccount')
    const mgr = await makeManager(a, b, sick)
    expect(mgr.get('venue-sick')?.health).not.toBe('healthy')

    const result = await mgr.getVenueSpread([A, B, `venue-sick|${KEY}`])

    expect(result.legs[2].error).toMatch(/Account is "/)
    expect(result.legs[2].bid).toBeNull()
    expect(result.legs[2].ask).toBeNull()
    expect(result.executableSpread?.sellOn).toBe('venue-b')
  })

  it('excludes a venue that answers without a two-sided quote', async () => {
    const a = new MockBroker({ id: 'venue-a' })
    const z = new MockBroker({ id: 'venue-z' })
    const b = new MockBroker({ id: 'venue-b' })
    seed(a, '80000')
    seed(b, '80200')
    const mgr = await makeManager(a, z, b)
    vi.spyOn(z, 'getQuote').mockResolvedValue(zeroSidedQuote(`venue-z|${KEY}`))

    const result = await mgr.getVenueSpread([A, `venue-z|${KEY}`, B])
    const zeroLeg = result.legs[1]

    // It answered — so it is not an error — but a "0" side is no quote, not a
    // free venue, and `last` is never substituted for the missing side.
    expect(zeroLeg.source).toBe('venue-z')
    expect(zeroLeg.bid).toBeNull()
    expect(zeroLeg.ask).toBeNull()
    expect(zeroLeg.last).toBe('80100')
    expect(zeroLeg.error).toBeUndefined()
    // The two venues that do quote both sides still produce the spread:
    // buy venue-a at 80,000.01, sell venue-b at 80,199.99.
    expect(result.executableSpread).toEqual({
      buyOn: 'venue-a',
      sellOn: 'venue-b',
      buyAt: '80000.01',
      sellAt: '80199.99',
      abs: '199.98',
      bps: '24.9663',
    })
    expect(result.midSpread?.lowAt).toBe('venue-a')
    expect(result.midSpread?.highAt).toBe('venue-b')
  })

  it('refuses a spread when only one venue quotes both sides', async () => {
    const a = new MockBroker({ id: 'venue-a' })
    const z = new MockBroker({ id: 'venue-z' })
    seed(a, '80000')
    const mgr = await makeManager(a, z)
    vi.spyOn(z, 'getQuote').mockResolvedValue(zeroSidedQuote(`venue-z|${KEY}`))

    const result = await mgr.getVenueSpread([A, `venue-z|${KEY}`])

    // Not patched together from the one-sided venue: refused.
    expect(result.pairingKey).toBe('BTC|USDT|SPOT')
    expect(result.executableSpread).toBeNull()
    expect(result.midSpread).toBeNull()
  })

  it('refuses legs that do not name the same instrument, listing each key', async () => {
    const a = new MockBroker({ id: 'venue-a' })
    const b = new MockBroker({ id: 'venue-b' })
    seed(a, '80000')
    seed(b, '80100', { secType: 'CRYPTO_PERP' })
    const mgr = await makeManager(a, b)

    const err = await mgr.getVenueSpread([A, B]).catch((thrown: unknown) => thrown)

    expect(err).toBeInstanceOf(BrokerError)
    expect((err as BrokerError).message).toMatch(/do not name the same instrument/)
    expect((err as BrokerError).message).toContain('BTC|USDT|SPOT')
    expect((err as BrokerError).message).toContain('BTC|USDT|PERP')
    // Permanent: re-issuing the same request cannot fix it, so callers must
    // not be told to retry.
    expect((err as BrokerError).permanent).toBe(true)
  })

  it('refuses the call when fewer than two venues answer, naming the reason', async () => {
    const a = new MockBroker({ id: 'venue-a' })
    const b = new MockBroker({ id: 'venue-b' })
    seed(a, '80000')
    seed(b, '80100')
    const mgr = await makeManager(a, b)
    vi.spyOn(b, 'getQuote').mockRejectedValue(new BrokerError('NETWORK', 'venue-b unreachable'))

    const err = await mgr.getVenueSpread([A, B]).catch((thrown: unknown) => thrown)

    expect((err as BrokerError).message).toMatch(/read 1 of 2 venues/)
    expect((err as BrokerError).message).toContain(`venue-b|${KEY} (venue-b unreachable)`)
    expect((err as BrokerError).permanent).toBe(true)
  })

  it('refuses aliceId counts outside 2..8', async () => {
    const a = new MockBroker({ id: 'venue-a' })
    const b = new MockBroker({ id: 'venue-b' })
    seed(a, '80000')
    seed(b, '80100')
    const mgr = await makeManager(a, b)

    await expect(mgr.getVenueSpread([A])).rejects.toThrow(/got 1/)
    await expect(mgr.getVenueSpread([A, B, A, B, A, B, A, B, A])).rejects.toThrow(/got 9/)
  })
})
