/**
 * FMP bbProvider integration test.
 *
 * Verifies FMP fetchers can reach the API and return schema-compliant data.
 * Requires fmp_api_key in config — skips all tests if not configured.
 */

import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { getTestContext, hasCredential, type TestContext } from './setup.js'

let ctx: TestContext

beforeAll(async () => { ctx = await getTestContext() })

const exec = (model: string, params: Record<string, unknown> = {}) =>
  ctx.executor.execute('fmp', model, params, ctx.credentials) as Promise<unknown[]>

describe('fmp — equity', () => {
  beforeEach(({ skip }) => { if (!hasCredential(ctx.credentials, 'fmp')) skip('no fmp_api_key') })

  it('EquityHistorical', async () => { expect((await exec('EquityHistorical', { symbol: 'AAPL' })).length).toBeGreaterThan(0) })
  it('EquityQuote', async () => { expect((await exec('EquityQuote', { symbol: 'AAPL' })).length).toBeGreaterThan(0) })
  it('EquityInfo', async () => { expect((await exec('EquityInfo', { symbol: 'AAPL' })).length).toBeGreaterThan(0) })
  it('EquitySearch', async () => { expect((await exec('EquitySearch', { query: 'Apple' })).length).toBeGreaterThan(0) })
  it('EquityScreener', async () => { expect((await exec('EquityScreener', { market_cap_min: 1e11 })).length).toBeGreaterThan(0) }, 60_000)
  it('KeyMetrics', async () => { expect((await exec('KeyMetrics', { symbol: 'AAPL' })).length).toBeGreaterThan(0) })
  it('KeyExecutives', async () => { expect((await exec('KeyExecutives', { symbol: 'AAPL' })).length).toBeGreaterThan(0) })
  it('EquityPeers', async () => { expect((await exec('EquityPeers', { symbol: 'AAPL' })).length).toBeGreaterThan(0) })
})

describe('fmp — financials', () => {
  beforeEach(({ skip }) => { if (!hasCredential(ctx.credentials, 'fmp')) skip('no fmp_api_key') })

  it('IncomeStatement', async () => { expect((await exec('IncomeStatement', { symbol: 'AAPL' })).length).toBeGreaterThan(0) })
  it('BalanceSheet', async () => { expect((await exec('BalanceSheet', { symbol: 'AAPL' })).length).toBeGreaterThan(0) })
  it('CashFlowStatement', async () => { expect((await exec('CashFlowStatement', { symbol: 'AAPL' })).length).toBeGreaterThan(0) })
  it('FinancialRatios', async () => { expect((await exec('FinancialRatios', { symbol: 'AAPL' })).length).toBeGreaterThan(0) })
})

describe('fmp — calendar & events', () => {
  beforeEach(({ skip }) => { if (!hasCredential(ctx.credentials, 'fmp')) skip('no fmp_api_key') })

  it('CalendarEarnings', async () => { expect((await exec('CalendarEarnings')).length).toBeGreaterThan(0) })
  it('CalendarDividend', async () => { expect((await exec('CalendarDividend')).length).toBeGreaterThan(0) })
  it('CalendarIpo', async () => { expect((await exec('CalendarIpo')).length).toBeGreaterThan(0) })
})

describe('fmp — ownership', () => {
  beforeEach(({ skip }) => { if (!hasCredential(ctx.credentials, 'fmp')) skip('no fmp_api_key') })

  it('InsiderTrading', async () => { expect((await exec('InsiderTrading', { symbol: 'AAPL' })).length).toBeGreaterThan(0) })
  it.skip('InstitutionalOwnership — returns empty for most symbols', async () => { expect((await exec('InstitutionalOwnership', { symbol: 'AAPL' })).length).toBeGreaterThan(0) })
})

describe('fmp — discovery', () => {
  beforeEach(({ skip }) => { if (!hasCredential(ctx.credentials, 'fmp')) skip('no fmp_api_key') })

  it('EquityGainers', async () => { expect((await exec('EquityGainers')).length).toBeGreaterThan(0) })
  it('EquityLosers', async () => { expect((await exec('EquityLosers')).length).toBeGreaterThan(0) })
  it('EquityActive', async () => { expect((await exec('EquityActive')).length).toBeGreaterThan(0) })
})

describe('fmp — crypto & currency', () => {
  beforeEach(({ skip }) => { if (!hasCredential(ctx.credentials, 'fmp')) skip('no fmp_api_key') })

  it('CryptoSearch', async () => { expect((await exec('CryptoSearch')).length).toBeGreaterThan(0) })
  it('CryptoHistorical', async () => { expect((await exec('CryptoHistorical', { symbol: 'BTCUSD' })).length).toBeGreaterThan(0) })
  it('CurrencyHistorical', async () => { expect((await exec('CurrencyHistorical', { symbol: 'EURUSD' })).length).toBeGreaterThan(0) })
  it('CurrencyPairs', async () => { expect((await exec('CurrencyPairs')).length).toBeGreaterThan(0) })
  it.skip('CurrencySnapshots — requires higher FMP tier', async () => { expect((await exec('CurrencySnapshots')).length).toBeGreaterThan(0) })
})

describe('fmp — ETF', () => {
  beforeEach(({ skip }) => { if (!hasCredential(ctx.credentials, 'fmp')) skip('no fmp_api_key') })

  it('EtfSearch', async () => { expect((await exec('EtfSearch', { query: 'SPY' })).length).toBeGreaterThan(0) })
  it('EtfInfo', async () => { expect((await exec('EtfInfo', { symbol: 'SPY' })).length).toBeGreaterThan(0) })
  it('EtfSectors', async () => { expect((await exec('EtfSectors', { symbol: 'SPY' })).length).toBeGreaterThan(0) })
  it.skip('EtfHoldings — requires higher FMP tier', async () => { expect((await exec('EtfHoldings', { symbol: 'SPY' })).length).toBeGreaterThan(0) })
})

describe('fmp — index', () => {
  beforeEach(({ skip }) => { if (!hasCredential(ctx.credentials, 'fmp')) skip('no fmp_api_key') })

  it('IndexHistorical', async () => { expect((await exec('IndexHistorical', { symbol: '^GSPC' })).length).toBeGreaterThan(0) })
  it.skip('IndexConstituents — requires higher FMP tier', async () => { expect((await exec('IndexConstituents', { symbol: 'dowjones' })).length).toBeGreaterThan(0) })
  // SP500Multiples — registered in multpl provider, not fmp
  it('RiskPremium', async () => { expect((await exec('RiskPremium')).length).toBeGreaterThan(0) })
})

describe('fmp — commodity (direct FMP tickers)', () => {
  beforeEach(({ skip }) => { if (!hasCredential(ctx.credentials, 'fmp')) skip('no fmp_api_key') })

  it('CommoditySpotPrice — GCUSD', async () => { expect((await exec('CommoditySpotPrice', { symbol: 'GCUSD' })).length).toBeGreaterThan(0) })
})

describe('fmp — commodity (canonical names via COMMODITY_MAP)', () => {
  beforeEach(({ skip }) => { if (!hasCredential(ctx.credentials, 'fmp')) skip('no fmp_api_key') })

  // Verified working on FMP Starter (2026-04-13)
  it('gold',   async () => { expect((await exec('CommoditySpotPrice', { symbol: 'gold' })).length).toBeGreaterThan(0) })
  it('silver', async () => { expect((await exec('CommoditySpotPrice', { symbol: 'silver' })).length).toBeGreaterThan(0) })
  it('brent',  async () => { expect((await exec('CommoditySpotPrice', { symbol: 'brent' })).length).toBeGreaterThan(0) })

  // Premium restricted on FMP Starter (verified 2026-04-13)
  it.skip('crude_oil — premium',   async () => { expect((await exec('CommoditySpotPrice', { symbol: 'crude_oil' })).length).toBeGreaterThan(0) })
  it.skip('natural_gas — premium', async () => { expect((await exec('CommoditySpotPrice', { symbol: 'natural_gas' })).length).toBeGreaterThan(0) })
  it.skip('copper — premium',     async () => { expect((await exec('CommoditySpotPrice', { symbol: 'copper' })).length).toBeGreaterThan(0) })
  it.skip('platinum — premium',   async () => { expect((await exec('CommoditySpotPrice', { symbol: 'platinum' })).length).toBeGreaterThan(0) })
  it.skip('corn — premium (USX)', async () => { expect((await exec('CommoditySpotPrice', { symbol: 'corn' })).length).toBeGreaterThan(0) })
  it.skip('wheat — premium (USX)', async () => { expect((await exec('CommoditySpotPrice', { symbol: 'wheat' })).length).toBeGreaterThan(0) })
})
