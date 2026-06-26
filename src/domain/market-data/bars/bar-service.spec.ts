/**
 * Federated bar service — deterministic unit tests (mocked clients, no network).
 * Real-provider accuracy is covered by bars.bbProvider.spec.ts (gated).
 */
import { describe, it, expect, vi } from 'vitest'
import { createBarService, parseBarId, formatBarId } from './index.js'
import type { BarServiceDeps, UtaBarGateway } from './types.js'
import type {
  EquityClientLike, CryptoClientLike, CurrencyClientLike, CommodityClientLike,
} from '../client/types.js'
import type { Bar } from '@traderalice/uta-protocol'

// One unsorted batch with a null-OHLC row that must be filtered out.
const RAW = [
  { date: '2024-01-03', open: 3, high: 4, low: 2, close: 3.5, volume: 30 },
  { date: '2024-01-01', open: 1, high: 2, low: 0.5, close: 1.5, volume: 10 },
  { date: '2024-01-02', open: 2, high: 3, low: 1.5, close: 2.5, volume: 20 },
  { date: '2024-01-04', open: null, high: 5, low: 3, close: null, volume: 40 },
]

function makeDeps(over: Partial<BarServiceDeps> = {}): BarServiceDeps {
  const equityHist = vi.fn(async () => RAW)
  const cryptoHist = vi.fn(async () => RAW)
  const currencyHist = vi.fn(async () => RAW)
  const commoditySpot = vi.fn(async () => RAW)
  return {
    marketSearch: {
      symbolIndex: { search: () => [{ symbol: 'AAPL', name: 'Apple Inc.' }] },
      cryptoClient: { search: async () => [] },
      currencyClient: { search: async () => [] },
      commodityCatalog: { search: () => [] },
    } as never,
    equityClient: { getHistorical: equityHist } as unknown as EquityClientLike,
    cryptoClient: { getHistorical: cryptoHist } as unknown as CryptoClientLike,
    currencyClient: { getHistorical: currencyHist } as unknown as CurrencyClientLike,
    commodityClient: { getSpotPrices: commoditySpot } as unknown as CommodityClientLike,
    utaManager: { has: async () => false, get: async () => undefined, searchContracts: async () => [] },
    vendorProviders: { equity: 'yfinance', crypto: 'yfinance', currency: 'yfinance', commodity: 'yfinance' },
    ...over,
  }
}

describe('barId helpers', () => {
  it('round-trips', () => {
    expect(formatBarId('yfinance', 'AAPL')).toBe('yfinance|AAPL')
    expect(parseBarId('yfinance|AAPL')).toEqual({ sourceId: 'yfinance', nativeSymbol: 'AAPL' })
  })
  it('splits on the FIRST | only (nativeKey may contain |)', () => {
    expect(parseBarId('bybit-main|ETH/USDT:USDT')).toEqual({ sourceId: 'bybit-main', nativeSymbol: 'ETH/USDT:USDT' })
    expect(parseBarId('a|b|c')).toEqual({ sourceId: 'a', nativeSymbol: 'b|c' })
  })
  it('rejects malformed', () => {
    expect(parseBarId('AAPL')).toBeNull()
    expect(parseBarId('|AAPL')).toBeNull()
  })
})

describe('getBars — vendor branch', () => {
  it('filters null-OHLC bars, sorts ascending, builds meta', async () => {
    const svc = createBarService(makeDeps())
    const { bars, meta } = await svc.getBars({ symbol: 'AAPL', assetClass: 'equity' }, { interval: '1d' })
    expect(bars.map((b) => b.date)).toEqual(['2024-01-01', '2024-01-02', '2024-01-03']) // 01-04 dropped + sorted
    expect(meta).toMatchObject({
      symbol: 'AAPL', from: '2024-01-01', to: '2024-01-03', bars: 3,
      source: 'vendor', sourceId: 'yfinance', barId: 'yfinance|AAPL', provider: 'yfinance', barCapability: 'delayed',
    })
  })

  it('routes each asset class to its client with the configured provider', async () => {
    const deps = makeDeps({ vendorProviders: { equity: 'fmp', crypto: 'yfinance', currency: 'yfinance', commodity: 'fmp' } })
    const svc = createBarService(deps)
    await svc.getBars({ symbol: 'AAPL', assetClass: 'equity' }, { interval: '1d' })
    await svc.getBars({ symbol: 'BTC', assetClass: 'crypto' }, { interval: '1h' })
    await svc.getBars({ symbol: 'gold', assetClass: 'commodity' }, { interval: '1d' })
    expect(deps.equityClient.getHistorical).toHaveBeenCalledWith(expect.objectContaining({ symbol: 'AAPL', interval: '1d', provider: 'fmp' }))
    expect(deps.cryptoClient.getHistorical).toHaveBeenCalledWith(expect.objectContaining({ symbol: 'BTC', interval: '1h', provider: 'yfinance' }))
    expect(deps.commodityClient.getSpotPrices).toHaveBeenCalledWith(expect.objectContaining({ symbol: 'gold', provider: 'fmp' }))
  })

  it('truncates to `count` (keeps most recent)', async () => {
    const svc = createBarService(makeDeps())
    const { bars } = await svc.getBars({ symbol: 'AAPL', assetClass: 'equity' }, { interval: '1d', count: 2 })
    expect(bars.map((b) => b.date)).toEqual(['2024-01-02', '2024-01-03'])
  })

  it('freshness contract: marks data stale when it does not reach the asOf anchor', async () => {
    const svc = createBarService(makeDeps())
    // RAW ends 2024-01-03. Anchor AT the last bar → current.
    const cur = await svc.getBars({ symbol: 'AAPL', assetClass: 'equity' }, { interval: '1d', end: '2024-01-03' })
    expect(cur.meta).toMatchObject({ asOf: '2024-01-03', isLatestActual: true, staleTradingDays: 0 })
    // Anchor a week later (3 trading days past the last bar) → stale + LOUD.
    const stale = await svc.getBars({ symbol: 'AAPL', assetClass: 'equity' }, { interval: '1d', end: '2024-01-08' })
    expect(stale.meta).toMatchObject({ asOf: '2024-01-08', isLatestActual: false, staleTradingDays: 3 })
  })

  it('caps at MAX_BARS', async () => {
    const big = Array.from({ length: 6000 }, (_, i) => ({
      date: `2000-01-01T${String(i).padStart(5, '0')}`, open: 1, high: 1, low: 1, close: 1, volume: 1,
    }))
    const deps = makeDeps({ equityClient: { getHistorical: async () => big } as unknown as EquityClientLike })
    const svc = createBarService(deps)
    const { bars } = await svc.getBars({ symbol: 'X', assetClass: 'equity' }, { interval: '1m' })
    expect(bars.length).toBe(5000)
  })
})

describe('getBars — barId forms', () => {
  it('vendor barId routes to the vendor client (needs assetClass)', async () => {
    const deps = makeDeps()
    const svc = createBarService(deps)
    const { meta } = await svc.getBars({ barId: 'yfinance|AAPL', assetClass: 'equity' }, { interval: '1d' })
    expect(meta.barId).toBe('yfinance|AAPL')
    expect(deps.equityClient.getHistorical).toHaveBeenCalled()
  })

  it('vendor barId without assetClass throws a clear error', async () => {
    const svc = createBarService(makeDeps())
    await expect(svc.getBars({ barId: 'yfinance|AAPL' }, { interval: '1d' })).rejects.toThrow(/needs an assetClass/)
  })

  it('invalid barId throws', async () => {
    const svc = createBarService(makeDeps())
    await expect(svc.getBars({ barId: 'AAPL', assetClass: 'equity' }, { interval: '1d' })).rejects.toThrow(/Invalid barId/)
  })
})

describe('getBars — UTA branch', () => {
  // Bar.timestamp is typed Date, but it crosses the Alice↔UTA HTTP wire as an
  // ISO STRING (JSON has no Date) — the SDK does not revive it. Use the REAL
  // wire shape here so the conversion is exercised exactly as in production.
  const WIRE = [
    { timestamp: '2024-02-02T00:00:00.000Z', open: '2', high: '3', low: '1', close: '2.5', volume: '200' },
    { timestamp: '2024-02-01T00:00:00.000Z', open: '1', high: '2', low: '0.5', close: '1.5', volume: '100' },
  ] as unknown as Bar[]

  it('discriminates uta via gateway, converts string→number, tags realtime (Date arrives as string over the wire)', async () => {
    const getHistorical = vi.fn(async () => WIRE)
    const utaManager: UtaBarGateway = {
      has: async (id) => id === 'alpaca-paper',
      get: async () => ({ getHistorical }),
      searchContracts: async () => [],
    }
    const svc = createBarService(makeDeps({ utaManager }))
    const { bars, meta } = await svc.getBars({ barId: 'alpaca-paper|AAPL' }, { interval: '1d' })
    expect(bars).toEqual([
      { date: '2024-02-01', open: 1, high: 2, low: 0.5, close: 1.5, volume: 100 },
      { date: '2024-02-02', open: 2, high: 3, low: 1, close: 2.5, volume: 200 },
    ])
    expect(meta).toMatchObject({ source: 'uta', sourceId: 'alpaca-paper', barId: 'alpaca-paper|AAPL', barCapability: 'realtime' })
    expect(getHistorical).toHaveBeenCalledWith({ aliceId: 'alpaca-paper|AAPL' }, expect.objectContaining({ interval: '1d' }))
  })

  it('renders a daily broker bar date-only even when stamped at the session open (no 05:00 / DST noise)', async () => {
    // Alpaca stamps a daily bar at the premarket open (04:00/05:00 ET in UTC),
    // which also flips an hour across DST — render the calendar day, not an instant.
    const dailyWire = [
      { timestamp: '2026-02-17T05:00:00.000Z', open: '1', high: '2', low: '0.5', close: '1.5', volume: '100' },
      { timestamp: '2026-06-25T04:00:00.000Z', open: '2', high: '3', low: '1', close: '2.5', volume: '200' },
    ] as unknown as Bar[]
    const utaManager: UtaBarGateway = {
      has: async (id) => id === 'alpaca-paper',
      get: async () => ({ getHistorical: async () => dailyWire }),
      searchContracts: async () => [],
    }
    const svc = createBarService(makeDeps({ utaManager }))
    const { bars } = await svc.getBars({ barId: 'alpaca-paper|AAPL' }, { interval: '1d' })
    expect(bars.map((b) => b.date)).toEqual(['2026-02-17', '2026-06-25']) // date-only, no time, no DST flip
  })

  it('count-only request becomes a START WINDOW, not a broker `limit` (alpaca count-anchoring bug)', async () => {
    // A count-only request must reach the broker as a start-bounded window — NOT
    // as `limit: count` with no start. Alpaca's getBarsV2 anchors `limit` to a
    // default start and returns the FIRST N bars ascending, so `1d count=60`
    // collapsed to a single in-progress daily bar. We over-fetch a window and
    // tail-slice instead. Regression guard for the 2026-06-25 repro.
    const getHistorical = vi.fn(async (_ref: unknown, params: { start?: Date; limit?: number }) => {
      void params
      return WIRE
    })
    const utaManager: UtaBarGateway = {
      has: async (id) => id === 'alpaca-paper',
      get: async () => ({ getHistorical }),
      searchContracts: async () => [],
    }
    const svc = createBarService(makeDeps({ utaManager }))
    await svc.getBars({ barId: 'alpaca-paper|AAPL' }, { interval: '1d', count: 60 })
    const params = getHistorical.mock.calls[0][1]
    expect(params.start).toBeInstanceOf(Date)       // count → synthesized start window
    expect(params.limit).toBeUndefined()            // count is NOT forwarded as limit
  })
})

describe('searchBarSources — federated candidates', () => {
  it('maps vendor results to barId-tagged candidates', async () => {
    const svc = createBarService(makeDeps())
    const out = await svc.searchBarSources('AAPL')
    expect(out[0]).toMatchObject({
      barId: 'yfinance|AAPL', source: 'vendor', sourceId: 'yfinance', symbol: 'AAPL', assetClass: 'equity',
    })
    expect(out[0].label).toContain('AAPL')
    expect(out[0].label).toContain('delayed') // freshness surfaced in the label, not just the structured field
  })

  it('unions UTA broker hits (barId = aliceId, secType → assetClass)', async () => {
    const utaManager = {
      has: async () => true,
      get: async () => undefined,
      searchContracts: async () => [
        { source: 'alpaca-paper', contract: { aliceId: 'alpaca-paper|AAPL', symbol: 'AAPL', secType: 'STK' }, derivativeSecTypes: [] },
        { source: 'bybit-main', contract: { aliceId: 'bybit-main|BTC/USDT:USDT', symbol: 'BTC', secType: 'CRYPTO' }, derivativeSecTypes: [] },
      ],
    } as never
    const svc = createBarService(makeDeps({ utaManager }))
    const out = await svc.searchBarSources('AAPL')
    const uta = out.filter((c) => c.source === 'uta')
    expect(uta).toEqual([
      expect.objectContaining({ barId: 'alpaca-paper|AAPL', sourceId: 'alpaca-paper', symbol: 'AAPL', assetClass: 'equity', barCapability: 'realtime' }),
      expect.objectContaining({ barId: 'bybit-main|BTC/USDT:USDT', sourceId: 'bybit-main', symbol: 'BTC', assetClass: 'crypto', barCapability: 'realtime' }),
    ])
    expect(uta[0].label).toContain('realtime') // broker freshness shown in the label too
    // vendor side still present (redundancy)
    expect(out.some((c) => c.source === 'vendor')).toBe(true)
  })

  it('venue-decided assetClass wins over the secType heuristic (CCXT future ≠ commodity)', async () => {
    const utaManager = {
      has: async () => true,
      get: async () => undefined,
      searchContracts: async () => [
        // A CCXT dated future: secType FUT (would heuristically → commodity), but
        // the venue says crypto → crypto must win.
        { source: 'okx-readonly', contract: { aliceId: 'okx-readonly|BTC/USDT:USDT-240628', symbol: 'BTC', secType: 'FUT' }, derivativeSecTypes: [], assetClass: 'crypto' },
        // No venue hint → falls back to the secType heuristic (FUT → commodity).
        { source: 'ibkr', contract: { aliceId: 'ibkr|CL', symbol: 'CL', secType: 'FUT' }, derivativeSecTypes: [] },
      ],
    } as never
    const out = await createBarService(makeDeps({ utaManager })).searchBarSources('BTC')
    const uta = out.filter((c) => c.source === 'uta')
    expect(uta[0]).toMatchObject({ sourceId: 'okx-readonly', assetClass: 'crypto' })
    expect(uta[1]).toMatchObject({ sourceId: 'ibkr', assetClass: 'commodity' })
  })

  it('survives one side failing (vendor still returns if UTA throws)', async () => {
    const utaManager = {
      has: async () => true,
      get: async () => undefined,
      searchContracts: async () => { throw new Error('uta down') },
    } as never
    const svc = createBarService(makeDeps({ utaManager }))
    const out = await svc.searchBarSources('AAPL')
    expect(out.some((c) => c.source === 'vendor')).toBe(true)
    expect(out.some((c) => c.source === 'uta')).toBe(false)
  })
})
