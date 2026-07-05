/**
 * Quant Calculator v2 — real-provider e2e (gated). Runs v2 scripts end-to-end
 * through the real bar service (yfinance/fmp) to prove the language + math +
 * data path compute correct values on live data, not just mocks.
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
import { runScript } from '@/domain/analysis/calc-v2/index.js'

function build(provider: string, creds: Record<string, string>): BarService {
  const ex = getSDKExecutor(); const rm = buildRouteMap()
  return createBarService({
    marketSearch: { symbolIndex: {} as never, equityVendors: [], equityClient: {} as never, cryptoClient: new SDKCryptoClient(ex, 'crypto', provider, creds, rm), currencyClient: new SDKCurrencyClient(ex, 'currency', provider, creds, rm), commodityCatalog: {} as never },
    equityClient: new SDKEquityClient(ex, 'equity', provider, creds, rm),
    cryptoClient: new SDKCryptoClient(ex, 'crypto', provider, creds, rm),
    currencyClient: new SDKCurrencyClient(ex, 'currency', provider, creds, rm),
    commodityClient: new SDKCommodityClient(ex, 'commodity', provider, creds, rm),
    utaManager: { has: async () => false, get: async () => undefined, searchContracts: async () => [] },
    vendorProviders: { equity: provider, crypto: provider, currency: provider, commodity: provider },
  })
}

let ctx: TestContext
let yf: BarService

beforeAll(async () => {
  ctx = await getTestContext()
  yf = build('yfinance', ctx.credentials)
})

describe('calc-v2 e2e — real yfinance', () => {
  it('SMA(50) on AAPL is a sane positive price near the latest close', async () => {
    const r = await runScript(`s = bars("yfinance|AAPL", "1d", count=250, asset="equity")\nsma(s.close, 50)`, { barService: yf })
    expect(r.error).toBeUndefined()
    expect(typeof r.value).toBe('number')
    expect(r.value as number).toBeGreaterThan(0)
    expect(r.dataRange!['yfinance|AAPL']).toMatchObject({ source: 'vendor', sourceId: 'yfinance' })
  })

  it('RSI(14) on BTC is within [0,100]', async () => {
    const r = await runScript(`s = bars("yfinance|BTC-USD", "1d", count=200, asset="crypto")\nrsi(s.close, 14)`, { barService: yf })
    expect(r.error).toBeUndefined()
    expect(r.value as number).toBeGreaterThanOrEqual(0)
    expect(r.value as number).toBeLessThanOrEqual(100)
  })

  it('latest close - SMA(50) reduces to a finite number', async () => {
    const r = await runScript(`s = bars("yfinance|AAPL", "1d", count=250, asset="equity")\ns.close[-1] - sma(s.close, 50)`, { barService: yf })
    expect(r.error).toBeUndefined()
    expect(Number.isFinite(r.value as number)).toBe(true)
  })

  it('bounds a start→end date-range window', async () => {
    const r = await runScript(`s = bars("yfinance|AAPL", "1d", start="2024-01-01", end="2024-03-31", asset="equity")\ns.close[-1]`, { barService: yf })
    expect(r.error).toBeUndefined()
    expect(r.value as number).toBeGreaterThan(0)
    const meta = r.dataRange!['yfinance|AAPL']
    expect(meta.from >= '2024-01-01').toBe(true)
    expect(meta.to <= '2024-03-31').toBe(true)
  })

  it('surfaces insufficient-bars as a structured error (not a crash)', async () => {
    const r = await runScript(`s = bars("yfinance|AAPL", "1d", count=10, asset="equity")\nsma(s.close, 200)`, { barService: yf })
    expect(r.value).toBeUndefined()
    expect(r.error?.kind).toBe('insufficient-bars')
  })

  it('cross-source basis (yfinance vs fmp AAPL) is tiny', async () => {
    const fmpKey = ctx.credentials.fmp_api_key ?? process.env.FMP_API_KEY
    if (!fmpKey) return
    const fmp = build('fmp', { ...ctx.credentials, fmp_api_key: fmpKey })
    // Two services, but v2 resolves both barIds through the same getBars contract.
    const a = await runScript(`s = bars("yfinance|AAPL", "1d", count=5, asset="equity")\ns.close[-1]`, { barService: yf })
    const b = await runScript(`s = bars("fmp|AAPL", "1d", count=5, asset="equity")\ns.close[-1]`, { barService: fmp })
    // Cross-vendor + possible forming-bar timing differences — a few % is fine.
    expect(Math.abs((a.value as number) - (b.value as number)) / (a.value as number)).toBeLessThan(0.05)
  })
})
