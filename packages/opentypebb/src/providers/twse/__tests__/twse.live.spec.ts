/**
 * TWSE / TPEx provider — LIVE integration (hits the real official open-data
 * APIs). Proves the endpoint field-mapping + ROC-date / empty-string
 * normalization + Yahoo-suffix symbol roundtrip actually work against the live
 * shapes, not just fixtures. Network-dependent; run ad hoc.
 */
import { describe, it, expect } from 'vitest'
import { TWSEEquitySearchFetcher } from '../models/equity-search.js'
import { TWSEEquityQuoteFetcher } from '../models/equity-quote.js'
import { TWSEKeyMetricsFetcher } from '../models/key-metrics.js'
import { TWSEEquityInfoFetcher } from '../models/equity-info.js'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function run(F: any, params: any) {
  const q = F.transformQuery(params)
  const raw = await F.extractData(q, null)
  return F.transformData(q, raw)
}

// Network-dependent — run with TWSE_LIVE=1 (kept out of default CI).
describe.skipIf(!process.env.TWSE_LIVE)('twse provider — live', () => {
  it('search 台積 → 2330.TW (Chinese name)', async () => {
    const r = await run(TWSEEquitySearchFetcher, { query: '台積' })
    const tsmc = r.find((x: { symbol: string }) => x.symbol === '2330.TW')
    expect(tsmc).toBeTruthy()
    expect(tsmc.name).toContain('台積')
    expect(tsmc.exchange).toBe('TWSE')
  }, 25000)

  it('search 2330 → 2330.TW (code)', async () => {
    const r = await run(TWSEEquitySearchFetcher, { query: '2330' })
    expect(r[0].symbol).toBe('2330.TW')
  }, 25000)

  it('quote 2330.TW → sane OHLCV', async () => {
    const r = await run(TWSEEquityQuoteFetcher, { symbol: '2330.TW' })
    const q = r[0]
    expect(q.close).toBeGreaterThan(0)
    expect(q.open).toBeGreaterThan(0)
    expect(q.high).toBeGreaterThanOrEqual(q.low)
    expect(q.exchange).toBe('TWSE')
  }, 25000)

  it('key metrics 2330.TW → official P/E·yield·P/B', async () => {
    const r = await run(TWSEKeyMetricsFetcher, { symbol: '2330.TW' })
    const m = r[0]
    expect(m.pe_ratio).toBeGreaterThan(0)
    expect(m.price_to_book).toBeGreaterThan(0)
    expect(m).toHaveProperty('dividend_yield')
    expect(m.currency).toBe('TWD')
  }, 25000)

  it('info 2330.TW → company profile', async () => {
    const r = await run(TWSEEquityInfoFetcher, { symbol: '2330.TW' })
    const p = r[0]
    expect(p.name).toContain('台')
    expect(p.stock_exchange).toBe('TWSE')
    expect(p.listing_date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  }, 25000)

  it('OTC: search + quote a .TWO (上櫃)', async () => {
    const s = await run(TWSEEquitySearchFetcher, { query: '6488' })
    const otc = s.find((x: { symbol: string }) => x.symbol.endsWith('.TWO'))
    expect(otc).toBeTruthy()
    const q = await run(TWSEEquityQuoteFetcher, { symbol: otc.symbol })
    expect(q[0].close).toBeGreaterThan(0)
    expect(q[0].exchange).toBe('TPEx')
  }, 25000)
})
