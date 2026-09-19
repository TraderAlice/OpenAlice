import { describe, it, expect } from 'vitest'
import { createReferenceRoutes } from './reference.js'
import type { EngineContext } from '../../core/types.js'
import type { ReferenceDataService } from '../../domain/market-data/reference/types.js'

const ROW = {
  symbol: 'NVDA', name: 'NVIDIA', price: 1000, change: 50, percent_change: 5.2, volume: 1e8,
  avg_volume: 5e7, relative_volume: 2, turnover: 0.04, dollar_volume: 1e11,
}

function mkCtx(overrides?: Partial<ReferenceDataService>): EngineContext {
  const reference: ReferenceDataService = {
    movers: async () => ({
      gainers: [ROW], losers: [], active: [ROW],
      undervaluedGrowth: [ROW], growthTech: [], smallCaps: [], undervaluedLarge: [],
      meta: { provider: 'yfinance', asOf: '2026-06-10T00:00:00.000Z' },
    }),
    calendar: async () => ({
      economicEvents: [{
        date: '2026-06-12 12:30:00', country: 'US', category: 'Employment', event: 'Nonfarm Payrolls',
        importance: 'High', source: 'BLS', currency: 'USD', unit: 'K', consensus: 150,
        previous: 139, revised: null, actual: null,
      }],
      earnings: [{ report_date: '2026-06-12', symbol: 'AAPL', name: 'Apple', eps_previous: 1.2, eps_consensus: 1.4 }],
      ipos: [], dividends: [],
      window: { start: '2026-06-10', end: '2026-06-24' },
      meta: { provider: 'fmp', asOf: '2026-06-10T00:00:00.000Z' },
    }),
    macro: async () => ({
      cards: [{ id: 'DFF', label: 'Fed Funds Rate', unit: 'percent' as const, points: [{ date: '2026-06-09', value: 5.25 }], latest: 5.25, latestDate: '2026-06-09', change: 0.01 }],
      meta: { provider: 'federal_reserve', asOf: '2026-06-10T00:00:00.000Z' },
    }),
    termStructure: async () => ({
      curves: [{ symbol: 'BTC', spot: 100000, points: [{ expiration: '2026-09-25', price: 102500, daysToExpiry: 107, annualizedBasis: 8.5 }] }],
      meta: { provider: 'deribit', asOf: '2026-06-10T00:00:00.000Z' },
    }),
    valuation: async () => ({
      cards: [{ id: 'pe_month', label: 'S&P 500 PE', unit: 'index' as const, points: [{ date: '2026-06-08', value: 31.8 }], latest: 31.8, latestDate: '2026-06-08', change: 0.4 }],
      meta: { provider: 'multpl', asOf: '2026-06-10T00:00:00.000Z' },
    }),
    globalMacro: async () => ({
      rows: [{
        country: 'united_states', label: 'United States',
        cpiYoy: { value: 3.2, date: '2026-04-01' },
        shortRate: { value: 3.72, date: '2026-04-01' },
        cli: { value: 100.9, date: '2026-05-01' },
        housePrice: { value: 154.0, date: '2025-10-01' },
        sharePrice: { value: 216.1, date: '2026-05-01' },
      }],
      meta: { provider: 'oecd', asOf: '2026-06-10T00:00:00.000Z' },
    }),
    fed: async () => ({
      cards: [{ id: 'WALCL', label: 'Total Assets', unit: 'count' as const, points: [{ date: '2026-06-03', value: 6.6e12 }], latest: 6.6e12, latestDate: '2026-06-03', change: -1e9 }],
      documents: [{ date: '2026-06-17', title: 'FOMC Statement — 2026-06-17', type: 'statement', url: 'https://www.federalreserve.gov/x' }],
      meta: { provider: 'fred+nyfed+federalreserve.gov', asOf: '2026-06-10T00:00:00.000Z' },
    }),
    shipping: async () => ({
      curves: [{ key: 'suez', name: 'Suez Canal', points: [{ date: '2026-06-07', tons: 1.69e6, vessels: 39 }], latest: { date: '2026-06-07', tons: 1.69e6, vessels: 39 } }],
      meta: { provider: 'imf-portwatch', asOf: '2026-06-10T00:00:00.000Z' },
    }),
    ...overrides,
  }
  return { reference } as unknown as EngineContext
}

describe('reference routes', () => {
  it('GET /movers returns the board with explicit provider meta', async () => {
    const res = await createReferenceRoutes(mkCtx()).request('/movers')
    const body = await res.json()
    expect(body.gainers[0].symbol).toBe('NVDA')
    expect(body.meta.provider).toBe('yfinance')
  })

  it('GET /calendar returns the board with the window', async () => {
    const res = await createReferenceRoutes(mkCtx()).request('/calendar')
    const body = await res.json()
    expect(body.economicEvents[0].event).toBe('Nonfarm Payrolls')
    expect(body.earnings[0].symbol).toBe('AAPL')
    expect(body.window.start).toBe('2026-06-10')
    expect(body.meta.provider).toBe('fmp')
  })

  it('GET /calendar fails loud (502) when the provider key is missing', async () => {
    const ctx = mkCtx({ calendar: async () => { throw new Error('FMP API key required') } })
    const res = await createReferenceRoutes(ctx).request('/calendar')
    expect(res.status).toBe(502)
    expect((await res.json()).error).toMatch(/FMP/)
  })

  it('GET /macro returns the regime cards', async () => {
    const res = await createReferenceRoutes(mkCtx()).request('/macro')
    const body = await res.json()
    expect(body.cards[0].id).toBe('DFF')
    expect(body.meta.provider).toBe('federal_reserve')
  })

  it('GET /term-structure returns the curves', async () => {
    const res = await createReferenceRoutes(mkCtx()).request('/term-structure')
    const body = await res.json()
    expect(body.curves[0].symbol).toBe('BTC')
    expect(body.curves[0].points[0].annualizedBasis).toBe(8.5)
  })

  it('GET /valuation returns the strip', async () => {
    const res = await createReferenceRoutes(mkCtx()).request('/valuation')
    const body = await res.json()
    expect(body.cards[0].id).toBe('pe_month')
    expect(body.meta.provider).toBe('multpl')
  })

  it('GET /fed returns cards + documents', async () => {
    const res = await createReferenceRoutes(mkCtx()).request('/fed')
    const body = await res.json()
    expect(body.cards[0].id).toBe('WALCL')
    expect(body.documents[0].type).toBe('statement')
  })

  it('GET /shipping returns the chokepoint curves', async () => {
    const res = await createReferenceRoutes(mkCtx()).request('/shipping')
    const body = await res.json()
    expect(body.curves[0].name).toBe('Suez Canal')
  })

  it('GET /movers surfaces a failure as { error } with 502, not a crash', async () => {
    const ctx = mkCtx({ movers: async () => { throw new Error('upstream down') } })
    const res = await createReferenceRoutes(ctx).request('/movers')
    expect(res.status).toBe(502)
    expect((await res.json()).error).toMatch(/upstream/)
  })
})
