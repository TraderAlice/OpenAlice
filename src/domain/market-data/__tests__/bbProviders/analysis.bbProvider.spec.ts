/**
 * Analysis tool e2e test — calculateIndicator full pipeline.
 *
 * Tests the complete chain: SDK client → OHLCV fetch → calculator → { value, dataRange }.
 * Uses real provider APIs (yfinance free, FMP with key).
 */

import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { getTestContext, hasCredential, type TestContext } from './setup.js'
import { getSDKExecutor } from '@/domain/market-data/client/typebb/executor.js'
import { buildRouteMap } from '@/domain/market-data/client/typebb/route-map.js'
import { SDKEquityClient } from '@/domain/market-data/client/typebb/equity-client.js'
import { SDKCryptoClient } from '@/domain/market-data/client/typebb/crypto-client.js'
import { SDKCurrencyClient } from '@/domain/market-data/client/typebb/currency-client.js'
import { SDKCommodityClient } from '@/domain/market-data/client/typebb/commodity-client.js'
import { createAnalysisTools } from '@/tool/analysis.js'

let ctx: TestContext
let calculateIndicator: ReturnType<typeof createAnalysisTools>['calculateIndicator']

beforeAll(async () => {
  ctx = await getTestContext()
  const executor = getSDKExecutor()
  const routeMap = buildRouteMap()
  const creds = ctx.credentials

  const equityClient = new SDKEquityClient(executor, 'equity', 'yfinance', creds, routeMap)
  const cryptoClient = new SDKCryptoClient(executor, 'crypto', 'yfinance', creds, routeMap)
  const currencyClient = new SDKCurrencyClient(executor, 'currency', 'yfinance', creds, routeMap)
  const commodityClient = new SDKCommodityClient(executor, 'commodity', 'yfinance', creds, routeMap)

  const tools = createAnalysisTools(equityClient, cryptoClient, currencyClient, commodityClient)
  calculateIndicator = tools.calculateIndicator
})

const run = async (asset: string, formula: string, precision?: number) =>
  calculateIndicator.execute!({ asset: asset as 'equity', formula, precision }, { toolCallId: 'test', messages: [] as any, abortSignal: undefined as any }) as any

describe('analysis e2e — equity (yfinance)', () => {
  it('CLOSE latest price', async () => {
    const result = await run('equity', "CLOSE('AAPL', '1d')[-1]")
    expect(typeof result.value).toBe('number')
    expect(result.value).toBeGreaterThan(0)
    expect(result.dataRange).toHaveProperty('AAPL')
    expect(result.dataRange.AAPL.bars).toBeGreaterThan(100)
  })

  it('SMA(50)', async () => {
    const result = await run('equity', "SMA(CLOSE('AAPL', '1d'), 50)")
    expect(typeof result.value).toBe('number')
    expect(result.value).toBeGreaterThan(0)
  })

  it('RSI(14)', async () => {
    const result = await run('equity', "RSI(CLOSE('AAPL', '1d'), 14)")
    expect(result.value).toBeGreaterThanOrEqual(0)
    expect(result.value).toBeLessThanOrEqual(100)
  })

  it('dataRange.to is recent', async () => {
    const result = await run('equity', "CLOSE('AAPL', '1d')[-1]")
    const to = new Date(result.dataRange.AAPL.to)
    const daysAgo = (Date.now() - to.getTime()) / (1000 * 60 * 60 * 24)
    expect(daysAgo).toBeLessThan(7) // should be within last week
  })
})

describe('analysis e2e — crypto (yfinance)', () => {
  it('CLOSE latest + dataRange', async () => {
    const result = await run('crypto', "CLOSE('BTCUSD', '1d')[-1]")
    expect(typeof result.value).toBe('number')
    expect(result.value).toBeGreaterThan(0)
    expect(result.dataRange).toHaveProperty('BTCUSD')
  })

  it('SMA(50)', async () => {
    const result = await run('crypto', "SMA(CLOSE('BTCUSD', '1d'), 50)")
    expect(typeof result.value).toBe('number')
    expect(result.value).toBeGreaterThan(0)
  })

  it('RSI(14)', async () => {
    const result = await run('crypto', "RSI(CLOSE('BTCUSD', '1d'), 14)")
    expect(result.value).toBeGreaterThanOrEqual(0)
    expect(result.value).toBeLessThanOrEqual(100)
  })

  it('BBANDS(20, 2)', async () => {
    const result = await run('crypto', "BBANDS(CLOSE('BTCUSD', '1d'), 20, 2)")
    const v = result.value as Record<string, number>
    expect(v).toHaveProperty('upper')
    expect(v).toHaveProperty('middle')
    expect(v).toHaveProperty('lower')
  })

  it('ETHUSD CLOSE latest', async () => {
    const result = await run('crypto', "CLOSE('ETHUSD', '1d')[-1]")
    expect(typeof result.value).toBe('number')
    expect(result.value).toBeGreaterThan(0)
  })
})

describe('analysis e2e — commodity canonical names (yfinance)', () => {
  it('gold — CLOSE latest', async () => {
    const result = await run('commodity', "CLOSE('gold', '1d')[-1]")
    expect(typeof result.value).toBe('number')
    expect(result.value).toBeGreaterThan(0)
    expect(result.dataRange).toHaveProperty('gold')
    expect(result.dataRange.gold.bars).toBeGreaterThan(100)
  })

  it('gold — RSI(14)', async () => {
    const result = await run('commodity', "RSI(CLOSE('gold', '1d'), 14)")
    expect(result.value).toBeGreaterThanOrEqual(0)
    expect(result.value).toBeLessThanOrEqual(100)
  })

  it('crude_oil — CLOSE latest', async () => {
    const result = await run('commodity', "CLOSE('crude_oil', '1d')[-1]")
    expect(typeof result.value).toBe('number')
    expect(result.value).toBeGreaterThan(0)
    expect(result.dataRange).toHaveProperty('crude_oil')
  })

  it('dataRange.to is recent (not 2022)', async () => {
    const result = await run('commodity', "CLOSE('gold', '1d')[-1]")
    const to = new Date(result.dataRange.gold.to)
    const year = to.getFullYear()
    expect(year).toBeGreaterThanOrEqual(2026) // catches the FMP-2022-data bug
  })
})

describe('analysis e2e — commodity with FMP', () => {
  beforeEach(({ skip }) => { if (!hasCredential(ctx.credentials, 'fmp')) skip('no fmp_api_key') })

  it('gold via FMP canonical name', async () => {
    // Rebuild clients with FMP as commodity provider
    const executor = getSDKExecutor()
    const routeMap = buildRouteMap()
    const commodityClientFmp = new SDKCommodityClient(executor, 'commodity', 'fmp', ctx.credentials, routeMap)
    const equityClient = new SDKEquityClient(executor, 'equity', 'yfinance', ctx.credentials, routeMap)
    const cryptoClient = new SDKCryptoClient(executor, 'crypto', 'yfinance', ctx.credentials, routeMap)
    const currencyClient = new SDKCurrencyClient(executor, 'currency', 'yfinance', ctx.credentials, routeMap)

    const tools = createAnalysisTools(equityClient, cryptoClient, currencyClient, commodityClientFmp)
    const result: any = await tools.calculateIndicator.execute!(
      { asset: 'commodity', formula: "CLOSE('gold', '1d')[-1]" },
      { toolCallId: 'test', messages: [] as any, abortSignal: undefined as any },
    )

    expect(typeof result.value).toBe('number')
    expect(result.value).toBeGreaterThan(0)
    expect(result.dataRange.gold.bars).toBeGreaterThan(100)
    // Verify it's current data, not 2022
    const year = new Date(result.dataRange.gold.to).getFullYear()
    expect(year).toBeGreaterThanOrEqual(2026)
  })
})
