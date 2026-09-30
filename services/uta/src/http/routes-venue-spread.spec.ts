import { describe, it, expect, vi } from 'vitest'
import { BrokerError } from '@traderalice/uta-protocol'
import { createTradingRoutes } from './routes-trading.js'
import type { UTAEngineContext } from '../types.js'

/** An envelope the route must carry to the wire unchanged: decimal strings
 *  everywhere, ISO timestamps, and a null spread when detection failed. */
function spreadFixture(aliceIds: string[]) {
  return {
    asOf: '2026-09-23T00:00:00.000Z',
    skewMs: 41,
    pairingKey: 'BTC|USDT|PERP',
    legs: aliceIds.map((aliceId, index) => ({
      source: aliceId.split('|')[0],
      aliceId,
      localSymbol: 'BTC/USDT:USDT',
      bid: index === 0 ? '86204.1' : null,
      ask: index === 0 ? '86204.2' : null,
      last: '86204.1',
      observedAt: '2026-09-23T00:00:00.010Z',
      latencyMs: 165 + index,
    })),
    executableSpread: null,
    midSpread: null,
  }
}

function setup() {
  const getVenueSpread = vi.fn(async (aliceIds: string[]) => spreadFixture(aliceIds))
  const routes = createTradingRoutes({ utaManager: { getVenueSpread } } as unknown as UTAEngineContext)
  const post = (body: unknown) =>
    routes.request('/venue-spread', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    })
  return { getVenueSpread, post }
}

const IDS = ['okx-readonly|BTC/USDT:USDT', 'bybit-readonly|BTC/USDT:USDT']

describe('cross-venue spread HTTP boundary', () => {
  it('carries the spread across the wire unchanged', async () => {
    const { getVenueSpread, post } = setup()

    const res = await post({ aliceIds: IDS })

    expect(res.status).toBe(200)
    expect(getVenueSpread).toHaveBeenCalledWith(IDS)
    const body = await res.json()
    // Money stays a decimal string and times stay ISO across the boundary;
    // a JSON round-trip must not turn either into a number/Date.
    expect(body.pairingKey).toBe('BTC|USDT|PERP')
    expect(body.skewMs).toBe(41)
    expect(body.legs[0].bid).toBe('86204.1')
    expect(body.legs[1].bid).toBeNull()
    expect(body.legs[0].observedAt).toBe('2026-09-23T00:00:00.010Z')
    expect(body.executableSpread).toBeNull()
  })

  it('rejects a request that is not 2..8 aliceIds before touching the manager', async () => {
    const { getVenueSpread, post } = setup()

    expect((await post({ aliceIds: [IDS[0]] })).status).toBe(400)
    expect((await post({ aliceIds: [...IDS, ...IDS, ...IDS, ...IDS, ...IDS] })).status).toBe(400)
    expect((await post({ aliceIds: [] })).status).toBe(400)
    expect((await post({})).status).toBe(400)
    expect((await post('not json at all')).status).toBe(400)

    expect(getVenueSpread).not.toHaveBeenCalled()
  })

  it('answers a pairing refusal as a non-retryable 4xx, not a 5xx', async () => {
    const getVenueSpread = vi.fn(async () => {
      throw new BrokerError('CONFIG', 'getVenueSpread legs do not name the same instrument: BTC|USDT|SPOT, BTC|USDT|PERP')
    })
    const routes = createTradingRoutes({ utaManager: { getVenueSpread } } as unknown as UTAEngineContext)

    const res = await routes.request('/venue-spread', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ aliceIds: IDS }),
    })

    // Retrying the identical request cannot fix a mismatched instrument set.
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ code: 'CONFIG', transient: false })
  })
})
