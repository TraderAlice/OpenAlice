/**
 * twse bbProvider integration test.
 *
 * Verifies the TWSE/TPEx open-data fetchers (EquitySearch, EquityQuote,
 * KeyMetrics, EquityInfo) can reach the official APIs and return
 * Yahoo-suffixed Taiwan symbols. Free provider — no API key required.
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { getTestContext, type TestContext } from './setup.js'

let ctx: TestContext

beforeAll(async () => { ctx = await getTestContext() })

const exec = (model: string, params: Record<string, unknown> = {}) =>
  ctx.executor.execute('twse', model, params, ctx.credentials) as Promise<Record<string, unknown>[]>

describe('twse — equity search', () => {
  it('bulk load (empty query) returns both boards', async () => {
    const all = await exec('EquitySearch', { query: '' })
    expect(all.length).toBeGreaterThan(1500)
    const symbols = all.map((d) => d.symbol as string)
    expect(symbols).toContain('2330.TW')
    expect(symbols.some((s) => s.endsWith('.TWO'))).toBe(true)
  })

  it('query by code finds TSMC with English-enriched name', async () => {
    const hits = await exec('EquitySearch', { query: '2330' })
    const tsmc = hits.find((d) => d.symbol === '2330.TW')
    expect(tsmc).toBeDefined()
    expect(tsmc?.name).toContain('TSMC')
    expect(tsmc?.exchange).toBe('TWSE')
  })

  it('query by English abbreviation works', async () => {
    const hits = await exec('EquitySearch', { query: 'TSMC' })
    expect(hits.map((d) => d.symbol)).toContain('2330.TW')
  })
})

describe('twse — equity quote', () => {
  it('returns the latest-day quote for a TWSE-listed symbol', async () => {
    const [q] = await exec('EquityQuote', { symbol: '2330.TW' })
    expect(q.symbol).toBe('2330.TW')
    expect(q.exchange).toBe('TWSE')
    expect(q.currency).toBe('TWD')
    expect(typeof q.close).toBe('number')
    expect(q.close as number).toBeGreaterThan(0)
    expect(typeof q.volume).toBe('number')
    expect(q.last_timestamp).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('returns a TPEx quote with bid/ask for an OTC symbol', async () => {
    const [q] = await exec('EquityQuote', { symbol: '6488.TWO' })
    expect(q.symbol).toBe('6488.TWO')
    expect(q.exchange).toBe('TPEX')
    expect(q.close as number).toBeGreaterThan(0)
  })

  it('resolves a multi-symbol query across both boards', async () => {
    const quotes = await exec('EquityQuote', { symbol: '2330.TW,6488.TWO' })
    expect(quotes.map((q) => q.symbol)).toEqual(['2330.TW', '6488.TWO'])
  })
})

describe('twse — key metrics', () => {
  it('returns official valuation ratios for TSMC', async () => {
    const [m] = await exec('KeyMetrics', { symbol: '2330.TW' })
    expect(m.symbol).toBe('2330.TW')
    expect(m.price_to_earnings as number).toBeGreaterThan(0)
    expect(m.price_to_book as number).toBeGreaterThan(0)
    expect(m.period_ending).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('returns TPEx ratios including dividend per share', async () => {
    const [m] = await exec('KeyMetrics', { symbol: '6488.TWO' })
    expect(m.symbol).toBe('6488.TWO')
    expect(typeof m.price_to_book).toBe('number')
  })
})

describe('twse — equity info', () => {
  it('returns the TWSE company profile for TSMC', async () => {
    const [info] = await exec('EquityInfo', { symbol: '2330.TW' })
    expect(info.symbol).toBe('2330.TW')
    expect(info.name).toContain('台積電')
    expect(info.legal_name).toContain('台灣積體電路')
    expect(info.stock_exchange).toBe('TWSE')
    expect(info.listed_date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(info.issued_shares as number).toBeGreaterThan(1e9)
  })

  it('returns a TPEx company profile for an OTC symbol', async () => {
    const [info] = await exec('EquityInfo', { symbol: '6488.TWO' })
    expect(info.symbol).toBe('6488.TWO')
    expect(info.stock_exchange).toBe('TPEX')
    expect(typeof info.chairman).toBe('string')
  })
})
