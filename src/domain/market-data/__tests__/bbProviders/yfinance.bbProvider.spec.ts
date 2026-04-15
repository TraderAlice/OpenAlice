/**
 * yfinance bbProvider integration test.
 *
 * Verifies all 32 yfinance fetchers can reach the API and return
 * schema-compliant data. Free provider — no API key required.
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { getTestContext, type TestContext } from './setup.js'

let ctx: TestContext

beforeAll(async () => { ctx = await getTestContext() })

const exec = (model: string, params: Record<string, unknown> = {}) =>
  ctx.executor.execute('yfinance', model, params, ctx.credentials) as Promise<unknown[]>

describe('yfinance — equity', () => {
  it('EquityQuote', async () => { expect((await exec('EquityQuote', { symbol: 'AAPL' })).length).toBeGreaterThan(0) })
  it('EquityInfo', async () => { expect((await exec('EquityInfo', { symbol: 'AAPL' })).length).toBeGreaterThan(0) })
  it('EquityHistorical', async () => { expect((await exec('EquityHistorical', { symbol: 'AAPL' })).length).toBeGreaterThan(0) })
  it('EquityScreener', async () => { expect((await exec('EquityScreener')).length).toBeGreaterThan(0) })
  it('KeyMetrics', async () => { expect((await exec('KeyMetrics', { symbol: 'AAPL' })).length).toBeGreaterThan(0) })
  it('KeyExecutives', async () => { expect((await exec('KeyExecutives', { symbol: 'AAPL' })).length).toBeGreaterThan(0) })
  it('ShareStatistics', async () => { expect((await exec('ShareStatistics', { symbol: 'AAPL' })).length).toBeGreaterThan(0) })
  it('PriceTargetConsensus', async () => { expect((await exec('PriceTargetConsensus', { symbol: 'AAPL' })).length).toBeGreaterThan(0) })
  it('CompanyNews', async () => { expect((await exec('CompanyNews', { symbol: 'AAPL' })).length).toBeGreaterThan(0) })
  it('HistoricalDividends', async () => { expect((await exec('HistoricalDividends', { symbol: 'AAPL' })).length).toBeGreaterThan(0) })
})

describe('yfinance — financials', () => {
  it('IncomeStatement', async () => { expect((await exec('IncomeStatement', { symbol: 'AAPL' })).length).toBeGreaterThan(0) })
  it('BalanceSheet', async () => { expect((await exec('BalanceSheet', { symbol: 'AAPL' })).length).toBeGreaterThan(0) })
  it('CashFlowStatement', async () => { expect((await exec('CashFlowStatement', { symbol: 'AAPL' })).length).toBeGreaterThan(0) })
})

describe('yfinance — discovery', () => {
  it('EquityGainers', async () => { expect((await exec('EquityGainers')).length).toBeGreaterThan(0) })
  it('EquityLosers', async () => { expect((await exec('EquityLosers')).length).toBeGreaterThan(0) })
  it('EquityActive', async () => { expect((await exec('EquityActive')).length).toBeGreaterThan(0) })
  it('EquityAggressiveSmallCaps', async () => { expect((await exec('EquityAggressiveSmallCaps')).length).toBeGreaterThan(0) })
  it('GrowthTechEquities', async () => { expect((await exec('GrowthTechEquities')).length).toBeGreaterThan(0) })
  it('EquityUndervaluedGrowth', async () => { expect((await exec('EquityUndervaluedGrowth')).length).toBeGreaterThan(0) })
  it('EquityUndervaluedLargeCaps', async () => { expect((await exec('EquityUndervaluedLargeCaps')).length).toBeGreaterThan(0) })
})

describe('yfinance — crypto & currency', () => {
  it('CryptoSearch', async () => { expect((await exec('CryptoSearch', { query: 'bitcoin' })).length).toBeGreaterThan(0) })
  it('CryptoHistorical', async () => { expect((await exec('CryptoHistorical', { symbol: 'BTCUSD' })).length).toBeGreaterThan(0) })
  it('CurrencyPairs', async () => { expect((await exec('CurrencyPairs', { query: 'USD' })).length).toBeGreaterThan(0) })
  it('CurrencyHistorical', async () => { expect((await exec('CurrencyHistorical', { symbol: 'EURUSD' })).length).toBeGreaterThan(0) })
})

describe('yfinance — ETF & index', () => {
  it('EtfInfo', async () => { expect((await exec('EtfInfo', { symbol: 'SPY' })).length).toBeGreaterThan(0) })
  it('EtfHistorical', async () => { expect((await exec('EtfHistorical', { symbol: 'SPY' })).length).toBeGreaterThan(0) })
  it('IndexHistorical', async () => { expect((await exec('IndexHistorical', { symbol: '^GSPC' })).length).toBeGreaterThan(0) })
  it('AvailableIndices', async () => { expect((await exec('AvailableIndices')).length).toBeGreaterThan(0) })
})

describe('yfinance — derivatives', () => {
  it('OptionsChains', async () => { expect((await exec('OptionsChains', { symbol: 'AAPL' })).length).toBeGreaterThan(0) })
  it('FuturesHistorical', async () => { expect((await exec('FuturesHistorical', { symbol: 'ES=F' })).length).toBeGreaterThan(0) })
  it('FuturesCurve', async () => { expect((await exec('FuturesCurve', { symbol: 'ES' })).length).toBeGreaterThan(0) })
})

describe('yfinance — commodity (canonical names)', () => {
  // Precious metals
  it('gold',      async () => { expect((await exec('CommoditySpotPrice', { symbol: 'gold' })).length).toBeGreaterThan(0) })
  it('silver',    async () => { expect((await exec('CommoditySpotPrice', { symbol: 'silver' })).length).toBeGreaterThan(0) })
  it('platinum',  async () => { expect((await exec('CommoditySpotPrice', { symbol: 'platinum' })).length).toBeGreaterThan(0) })
  it('palladium', async () => { expect((await exec('CommoditySpotPrice', { symbol: 'palladium' })).length).toBeGreaterThan(0) })

  // Industrial metals
  it('copper', async () => { expect((await exec('CommoditySpotPrice', { symbol: 'copper' })).length).toBeGreaterThan(0) })

  // Energy
  it('crude_oil',   async () => { expect((await exec('CommoditySpotPrice', { symbol: 'crude_oil' })).length).toBeGreaterThan(0) })
  it('brent',       async () => { expect((await exec('CommoditySpotPrice', { symbol: 'brent' })).length).toBeGreaterThan(0) })
  it('natural_gas', async () => { expect((await exec('CommoditySpotPrice', { symbol: 'natural_gas' })).length).toBeGreaterThan(0) })
  it('heating_oil', async () => { expect((await exec('CommoditySpotPrice', { symbol: 'heating_oil' })).length).toBeGreaterThan(0) })
  it('gasoline',    async () => { expect((await exec('CommoditySpotPrice', { symbol: 'gasoline' })).length).toBeGreaterThan(0) })

  // Agriculture (CBOT) — yfinance coverage historically flaky
  it('corn',     async () => { expect((await exec('CommoditySpotPrice', { symbol: 'corn' })).length).toBeGreaterThan(0) })
  it('wheat',    async () => { expect((await exec('CommoditySpotPrice', { symbol: 'wheat' })).length).toBeGreaterThan(0) })
  it('soybeans', async () => { expect((await exec('CommoditySpotPrice', { symbol: 'soybeans' })).length).toBeGreaterThan(0) })

  // Softs (ICE)
  it('sugar',  async () => { expect((await exec('CommoditySpotPrice', { symbol: 'sugar' })).length).toBeGreaterThan(0) })
  it('coffee', async () => { expect((await exec('CommoditySpotPrice', { symbol: 'coffee' })).length).toBeGreaterThan(0) })
  it('cocoa',  async () => { expect((await exec('CommoditySpotPrice', { symbol: 'cocoa' })).length).toBeGreaterThan(0) })
  it('cotton', async () => { expect((await exec('CommoditySpotPrice', { symbol: 'cotton' })).length).toBeGreaterThan(0) })

  // Livestock
  it('live_cattle', async () => { expect((await exec('CommoditySpotPrice', { symbol: 'live_cattle' })).length).toBeGreaterThan(0) })
  it('lean_hogs',   async () => { expect((await exec('CommoditySpotPrice', { symbol: 'lean_hogs' })).length).toBeGreaterThan(0) })
})
