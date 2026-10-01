import { describe, it, expect, vi } from 'vitest'
import { createTradingRoutes } from './routes-trading.js'
import type { UTAEngineContext } from '../types.js'

function setup() {
  const read = vi.fn().mockResolvedValue({ snapshots: {}, nextPageToken: 'next', metadata: { feed: 'indicative' } })
  const account = {
    id: 'alpaca', health: 'healthy', broker: { getOptionChain: read, getOptionContracts: read, getOrderBook: read },
    contractFromAliceId: (id: string) => {
      if (!id.startsWith('alpaca|')) throw new Error('Wrong account')
      return { secType: id.includes('BTC') ? 'CRYPTO' : 'STK', symbol: id.split('|')[1] }
    },
  }
  const routes = createTradingRoutes({ utaManager: { get: () => account } } as unknown as UTAEngineContext)
  const post = (route: string, body: unknown) => routes.request(`/uta/alpaca/contract/${route}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  return { read, post }
}
describe('Broker research HTTP boundary', () => {
  it('passes filters/feed/pagination unchanged without losing metadata', async () => {
    const { read, post } = setup()
    const res = await post('option-chain', { aliceId: 'alpaca|SPY', expiration: '2026-09-18', feed: 'opra', pageToken: 'cursor' })
    expect(res.status).toBe(200)
    expect(read).toHaveBeenCalledWith('SPY', { expiration: '2026-09-18', feed: 'opra', pageToken: 'cursor' })
    expect(await res.json()).toMatchObject({ nextPageToken: 'next', metadata: { feed: 'indicative' } })
  })
  it('rejects invalid limits before touching the broker', async () => {
    const { read, post } = setup()
    expect((await post('option-contracts', { aliceId: 'alpaca|SPY', limit: 1001 })).status).toBe(400)
    expect(read).not.toHaveBeenCalled()
  })
  it('does not accept a cross-account aliceId or a crypto underlying', async () => {
    const { read, post } = setup()
    expect((await post('option-chain', { aliceId: 'other|SPY' })).status).not.toBe(200)
    expect((await post('option-chain', { aliceId: 'alpaca|BTC/USD' })).status).not.toBe(200)
    expect(read).not.toHaveBeenCalled()
  })
  it('resolves depth contracts through the account and bounds requested levels', async () => {
    const { read, post } = setup()
    expect((await post('order-book', { aliceId: 'alpaca|BTC/USD', limit: 2 })).status).toBe(200)
    expect(read).toHaveBeenCalledWith({ symbol: 'BTC/USD', secType: 'CRYPTO' }, 2)
  })
})

describe('Funding-rate HTTP boundary', () => {
  const ALICE_ID = 'bybit-main|BTC_USDT.USDT'
  // The venue's native symbol is NOT the aliceId tail: 'BTC_USDT.USDT' is the
  // venue's own id form, and only the account knows what it resolves to. The
  // 2026-05 regression was exactly this — a route stamping the raw aliceId onto
  // a fresh Contract handed the broker a symbol it could not resolve.
  const resolvedContract = { symbol: 'BTC', localSymbol: 'BTC/USDT:USDT', secType: 'CRYPTO_PERP' }

  function setupFunding() {
    const rate = vi.fn().mockResolvedValue({ contract: resolvedContract, fundingRate: 0.0001, timestamp: new Date(0) })
    const history = vi.fn().mockResolvedValue({ contract: resolvedContract, rates: [], timestamp: new Date(0) })
    const account = {
      id: 'bybit-main', health: 'healthy', broker: { getFundingRate: rate, getFundingRateHistory: history },
      contractFromAliceId: (aliceId: string) => {
        if (aliceId !== ALICE_ID) throw new Error(`Unexpected aliceId ${aliceId}`)
        return resolvedContract
      },
    }
    const routes = createTradingRoutes({ utaManager: { get: () => account } } as unknown as UTAEngineContext)
    const post = (route: string, body: unknown) => routes.request(`/uta/bybit-main/contract/${route}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    })
    return { rate, history, post }
  }

  it('resolves the contract through the account before reading the rate', async () => {
    const { rate, post } = setupFunding()

    const res = await post('funding-rate', { aliceId: ALICE_ID })

    expect(res.status).toBe(200)
    const [contractArg] = rate.mock.calls[0]
    expect(contractArg).toBe(resolvedContract)
    expect(contractArg.localSymbol).toBe('BTC/USDT:USDT')
    expect(JSON.stringify(contractArg)).not.toContain('BTC_USDT.USDT')
  })

  it('forwards start/limit unchanged with the account-resolved contract', async () => {
    const { history, post } = setupFunding()

    const res = await post('funding-rate-history', { aliceId: ALICE_ID, start: '2026-09-01T00:00:00.000Z', limit: 7 })

    expect(res.status).toBe(200)
    expect(history).toHaveBeenCalledWith(resolvedContract, { start: '2026-09-01T00:00:00.000Z', limit: 7 })
  })

  it('rejects malformed bodies before touching the broker', async () => {
    const { rate, history, post } = setupFunding()

    expect((await post('funding-rate', {})).status).toBe(400)
    expect((await post('funding-rate', { aliceId: '' })).status).toBe(400)
    expect((await post('funding-rate', null)).status).toBe(400)
    expect((await post('funding-rate-history', { aliceId: ALICE_ID, limit: 1001 })).status).toBe(400)
    expect((await post('funding-rate-history', { aliceId: ALICE_ID, start: 'yesterday' })).status).toBe(400)

    expect(rate).not.toHaveBeenCalled()
    expect(history).not.toHaveBeenCalled()
  })

  it('surfaces a broker pack without the capability instead of answering with an empty rate', async () => {
    const account = { id: 'alpaca', health: 'healthy', broker: {}, contractFromAliceId: () => resolvedContract }
    const routes = createTradingRoutes({ utaManager: { get: () => account } } as unknown as UTAEngineContext)
    const post = (route: string, body: unknown) => routes.request(`/uta/alpaca/contract/${route}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    })

    for (const route of ['funding-rate', 'funding-rate-history']) {
      const res = await post(route, { aliceId: 'alpaca|BTC/USD' })
      expect(res.status, route).not.toBe(200)
      expect((await res.json()).error, route).toMatch(/not supported by this broker pack/)
    }
  })
})
