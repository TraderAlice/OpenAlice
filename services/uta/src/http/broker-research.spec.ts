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
