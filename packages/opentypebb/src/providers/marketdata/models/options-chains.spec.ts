import { afterEach, describe, expect, it, vi } from 'vitest'
import { EmptyDataError, RateLimitedError } from '../../../core/provider/utils/errors.js'
import { MarketDataOptionsChainsFetcher } from './options-chains.js'

afterEach(() => vi.unstubAllGlobals())

describe('MarketData options chains', () => {
  it('accepts cached HTTP 203, authenticates by header, and maps parallel arrays', async () => {
    const expiration = Math.floor(new Date('2026-09-18T20:00:00Z').getTime() / 1000)
    const updated = Math.floor(new Date('2026-07-20T20:00:00Z').getTime() / 1000)
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
      s: 'ok',
      optionSymbol: ['MSTR260918P00095000'],
      underlying: ['MSTR'],
      expiration: [expiration],
      side: ['put'],
      strike: [95],
      dte: [60],
      ask: [12.4], askSize: [8], bid: [11.8], bidSize: [6], mid: [12.1], last: [12],
      volume: [101], openInterest: [8991], underlyingPrice: [110], updated: [updated],
      iv: [0.75], delta: [-0.42], gamma: [0.02], theta: [-0.08], vega: [0.11],
    }), { status: 203 }))
    vi.stubGlobal('fetch', fetchMock)

    const rows = await MarketDataOptionsChainsFetcher.fetchData({
      symbol: 'mstr', date: '2026-07-20', expiration: '2026-09-18',
      side: 'put', strike_min: 90, strike_max: 100,
    }, { marketdata_api_key: 'secret-token' }) as Record<string, unknown>[]

    const [url, init] = fetchMock.mock.calls[0]!
    expect(String(url)).toContain('/options/chain/MSTR/')
    expect(String(url)).toContain('date=2026-07-20')
    expect(String(url)).toContain('expiration=2026-09-18')
    expect(String(url)).toContain('strike=90-100')
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer secret-token')
    expect(rows[0]).toMatchObject({
      underlying_symbol: 'MSTR', contract_symbol: 'MSTR260918P00095000',
      eod_date: '2026-07-20', expiration: '2026-09-18', option_type: 'put',
      strike: 95, bid: 11.8, ask: 12.4, open_interest: 8991,
      implied_volatility: 0.75, source: 'marketdata',
    })
  })

  it('preserves a missing requested date instead of silently shifting it', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      s: 'no_data', prevTime: 1784505600, nextTime: 1784764800,
    }))))

    await expect(MarketDataOptionsChainsFetcher.fetchData(
      { symbol: 'MSTR', date: '2026-07-20' },
      { marketdata_api_key: 'secret-token' },
    )).rejects.toBeInstanceOf(EmptyDataError)
  })

  it('reports credit exhaustion as rate limiting', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 429 })))
    await expect(MarketDataOptionsChainsFetcher.fetchData(
      { symbol: 'MSTR', date: '2026-07-20' },
      { marketdata_api_key: 'secret-token' },
    )).rejects.toBeInstanceOf(RateLimitedError)
  })
})
