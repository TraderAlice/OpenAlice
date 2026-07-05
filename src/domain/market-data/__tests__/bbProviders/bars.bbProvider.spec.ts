/**
 * Federated bar service — real-provider e2e (gated; yfinance free, FMP via
 * FMP_API_KEY env). Asserts each asset class returns sane bars + correct source
 * metadata, and that two independent vendors agree on a liquid close.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { getTestContext, type TestContext } from './setup.js'
import { getSDKExecutor } from '@/domain/market-data/client/typebb/executor.js'
import { buildRouteMap } from '@/domain/market-data/client/typebb/route-map.js'
import { SDKEquityClient } from '@/domain/market-data/client/typebb/equity-client.js'
import { SDKCryptoClient } from '@/domain/market-data/client/typebb/crypto-client.js'
import { SDKCurrencyClient } from '@/domain/market-data/client/typebb/currency-client.js'
import { SDKCommodityClient } from '@/domain/market-data/client/typebb/commodity-client.js'
import { createBarService, type BarService } from '@/domain/market-data/bars/index.js'
import type { AssetClass } from '@/domain/market-data/aggregate-search.js'

function build(provider: string, creds: Record<string, string>): BarService {
  const executor = getSDKExecutor()
  const routeMap = buildRouteMap()
  const equityClient = new SDKEquityClient(executor, 'equity', provider, creds, routeMap)
  const cryptoClient = new SDKCryptoClient(executor, 'crypto', provider, creds, routeMap)
  const currencyClient = new SDKCurrencyClient(executor, 'currency', provider, creds, routeMap)
  const commodityClient = new SDKCommodityClient(executor, 'commodity', provider, creds, routeMap)
  return createBarService({
    marketSearch: { symbolIndex: {} as never, equityVendors: [], equityClient: {} as never, cryptoClient, currencyClient, commodityCatalog: {} as never },
    equityClient, cryptoClient, currencyClient, commodityClient,
    utaManager: { has: async () => false, get: async () => undefined, searchContracts: async () => [] },
    vendorProviders: { equity: provider, crypto: provider, currency: provider, commodity: provider },
  })
}

let ctx: TestContext
let yf: BarService
let fmpKey: string | undefined

beforeAll(async () => {
  ctx = await getTestContext()
  yf = build('yfinance', ctx.credentials)
  // From data/config/market-data.json (providerKeys.fmp) via buildSDKCredentials,
  // or FMP_API_KEY env as a fallback.
  fmpKey = ctx.credentials.fmp_api_key ?? process.env.FMP_API_KEY
})

const cases: Array<{ asset: AssetClass; symbol: string }> = [
  { asset: 'equity', symbol: 'AAPL' },
  { asset: 'crypto', symbol: 'BTC-USD' },
  { asset: 'currency', symbol: 'EURUSD=X' },
  { asset: 'commodity', symbol: 'gold' },
]

describe('bar service e2e — yfinance per asset class', () => {
  for (const { asset, symbol } of cases) {
    it(`${asset} ${symbol}: sane bars + source meta`, async () => {
      const { bars, meta } = await yf.getBars({ symbol, assetClass: asset }, { interval: '1d' })
      expect(bars.length).toBeGreaterThan(100)
      expect(meta).toMatchObject({
        symbol, bars: bars.length, source: 'vendor', sourceId: 'yfinance',
        barId: `yfinance|${symbol}`, provider: 'yfinance', barCapability: 'delayed',
      })
      const last = bars[bars.length - 1]
      expect(last.close).toBeGreaterThan(0)
      // sorted ascending
      expect(meta.from <= meta.to).toBe(true)
    })
  }

  it('count truncates to the requested window', async () => {
    const { bars } = await yf.getBars({ symbol: 'AAPL', assetClass: 'equity' }, { interval: '1d', count: 30 })
    expect(bars.length).toBeLessThanOrEqual(30)
    expect(bars.length).toBeGreaterThan(0)
  })
})

describe('bar service e2e — FMP + cross-source agreement', () => {
  it('fmp equity AAPL: sane bars + fmp barId', async (t) => {
    if (!fmpKey) return t.skip()
    const fmp = build('fmp', { ...ctx.credentials, fmp_api_key: fmpKey })
    const { bars, meta } = await fmp.getBars({ symbol: 'AAPL', assetClass: 'equity' }, { interval: '1d' })
    expect(bars.length).toBeGreaterThan(100)
    expect(meta).toMatchObject({ source: 'vendor', sourceId: 'fmp', barId: 'fmp|AAPL' })
    expect(bars[bars.length - 1].close).toBeGreaterThan(0)
  })

  it('yfinance and fmp agree on AAPL latest close within 2%', async (t) => {
    if (!fmpKey) return t.skip()
    const fmp = build('fmp', { ...ctx.credentials, fmp_api_key: fmpKey })
    const yfRes = await yf.getBars({ symbol: 'AAPL', assetClass: 'equity' }, { interval: '1d', count: 5 })
    const fmpRes = await fmp.getBars({ symbol: 'AAPL', assetClass: 'equity' }, { interval: '1d', count: 5 })
    const a = yfRes.bars[yfRes.bars.length - 1].close
    const b = fmpRes.bars[fmpRes.bars.length - 1].close
    expect(Math.abs(a - b) / a).toBeLessThan(0.02)
  })
})
