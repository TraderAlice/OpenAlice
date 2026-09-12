/**
 * Economy tool unit tests — schema / passthrough / error.
 *
 * Mirrors the trading.spec.ts pattern: don't hit the network, mock the
 * EconomyClientLike surface, and verify the three things that can break
 * silently when you turn a domain function into an AI tool:
 *   1. Input schema accepts valid args + rejects invalid ones (zod check)
 *   2. Args land at the client unchanged + provider is pinned to federal_reserve
 *   3. Errors from the client propagate (no swallowing)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { EconomyClientLike, CommodityClientLike } from '@/domain/market-data/client/types'
import { createEconomyTools } from './economy.js'

function makeMockEconomyClient(): EconomyClientLike {
  return {
    getCalendar: vi.fn(async () => []),
    fredSearch: vi.fn(async () => []),
    fredSeries: vi.fn(async () => []),
    fredRegional: vi.fn(async () => []),
    getBlsSearch: vi.fn(async () => []),
    getBlsSeries: vi.fn(async () => []),
    getCPI: vi.fn(async () => []),
    getInterestRates: vi.fn(async () => []),
    getCompositeLeadingIndicator: vi.fn(async () => []),
    getRetailPrices: vi.fn(async () => []),
    getHousePriceIndex: vi.fn(async () => []),
    getSharePriceIndex: vi.fn(async () => []),
    getBalanceOfPayments: vi.fn(async () => []),
    getFomcDocuments: vi.fn(async () => []),
    getCentralBankHoldings: vi.fn(async () => []),
    getPrimaryDealerPositioning: vi.fn(async () => []),
    getPortInfo: vi.fn(async () => []),
    getPortVolume: vi.fn(async () => []),
    getChokepointInfo: vi.fn(async () => []),
    getChokepointVolume: vi.fn(async () => []),
  }
}

function makeMockCommodityClient(): CommodityClientLike {
  return {
    getSpotPrices: vi.fn(async () => []),
    getPetroleumStatus: vi.fn(async () => []),
    getEnergyOutlook: vi.fn(async () => []),
  }
}

// Helper to bypass Vercel AI's tool execute typing — same pattern as trading.spec.ts
const exec = (t: any, args: unknown) => (t.execute as Function)(args)

describe('createEconomyTools — economyFredSearch', () => {
  let client: EconomyClientLike
  let commodity: CommodityClientLike
  let tools: ReturnType<typeof createEconomyTools>

  beforeEach(() => {
    client = makeMockEconomyClient()
    commodity = makeMockCommodityClient()
    tools = createEconomyTools(client, commodity)
  })

  it('passes query through and pins provider to federal_reserve', async () => {
    await exec(tools.economyFredSearch, { query: 'GDP' })
    expect(client.fredSearch).toHaveBeenCalledWith({ query: 'GDP', provider: 'federal_reserve' })
  })

  it('forwards optional limit when present', async () => {
    await exec(tools.economyFredSearch, { query: 'GDP', limit: 5 })
    expect(client.fredSearch).toHaveBeenCalledWith({ query: 'GDP', provider: 'federal_reserve', limit: 5 })
  })

  it('omits limit from params when not provided (does not send undefined)', async () => {
    await exec(tools.economyFredSearch, { query: 'GDP' })
    const callArg = (client.fredSearch as any).mock.calls[0][0]
    expect('limit' in callArg).toBe(false)
  })

  it('returns the client result unchanged', async () => {
    const fixture = [{ series_id: 'GDP', title: 'Gross Domestic Product' }] as any
    ;(client.fredSearch as any).mockResolvedValueOnce(fixture)
    const result = await exec(tools.economyFredSearch, { query: 'GDP' })
    expect(result).toBe(fixture)
  })

  it('propagates client errors instead of swallowing', async () => {
    ;(client.fredSearch as any).mockRejectedValueOnce(new Error('upstream 500'))
    await expect(exec(tools.economyFredSearch, { query: 'GDP' })).rejects.toThrow('upstream 500')
  })

  it('schema rejects missing query', () => {
    const schema = (tools.economyFredSearch as any).inputSchema
    expect(schema.safeParse({}).success).toBe(false)
  })

  it('schema rejects non-positive limit', () => {
    const schema = (tools.economyFredSearch as any).inputSchema
    expect(schema.safeParse({ query: 'GDP', limit: 0 }).success).toBe(false)
    expect(schema.safeParse({ query: 'GDP', limit: -1 }).success).toBe(false)
    expect(schema.safeParse({ query: 'GDP', limit: 1.5 }).success).toBe(false)
  })
})

describe('createEconomyTools — economyFredSeries', () => {
  let client: EconomyClientLike
  let commodity: CommodityClientLike
  let tools: ReturnType<typeof createEconomyTools>

  beforeEach(() => {
    client = makeMockEconomyClient()
    commodity = makeMockCommodityClient()
    tools = createEconomyTools(client, commodity)
  })

  it('passes single symbol + provider', async () => {
    await exec(tools.economyFredSeries, { symbol: 'GDP' })
    expect(client.fredSeries).toHaveBeenCalledWith({ symbol: 'GDP', provider: 'federal_reserve' })
  })

  it('passes comma-separated symbols verbatim (multi-series merge)', async () => {
    await exec(tools.economyFredSeries, { symbol: 'GDP,UNRATE' })
    expect(client.fredSeries).toHaveBeenCalledWith({ symbol: 'GDP,UNRATE', provider: 'federal_reserve' })
  })

  it('forwards date range and limit', async () => {
    await exec(tools.economyFredSeries, {
      symbol: 'GDP', start_date: '2020-01-01', end_date: '2024-12-31', limit: 12,
    })
    expect(client.fredSeries).toHaveBeenCalledWith({
      symbol: 'GDP', provider: 'federal_reserve',
      start_date: '2020-01-01', end_date: '2024-12-31', limit: 12,
    })
  })

  it('forwards frequency when provided', async () => {
    await exec(tools.economyFredSeries, { symbol: 'GDP', frequency: 'm' })
    expect(client.fredSeries).toHaveBeenCalledWith({
      symbol: 'GDP', provider: 'federal_reserve', frequency: 'm',
    })
  })

  it('schema rejects missing symbol', () => {
    const schema = (tools.economyFredSeries as any).inputSchema
    expect(schema.safeParse({}).success).toBe(false)
  })
})

describe('createEconomyTools — economyFredRegional', () => {
  let client: EconomyClientLike
  let commodity: CommodityClientLike
  let tools: ReturnType<typeof createEconomyTools>

  beforeEach(() => {
    client = makeMockEconomyClient()
    commodity = makeMockCommodityClient()
    tools = createEconomyTools(client, commodity)
  })

  it('passes symbol + provider with no extras', async () => {
    await exec(tools.economyFredRegional, { symbol: 'WIPCPI' })
    expect(client.fredRegional).toHaveBeenCalledWith({ symbol: 'WIPCPI', provider: 'federal_reserve' })
  })

  it('forwards date and region_type when present', async () => {
    await exec(tools.economyFredRegional, {
      symbol: 'WIPCPI', date: '2024-01-01', region_type: 'state',
    })
    expect(client.fredRegional).toHaveBeenCalledWith({
      symbol: 'WIPCPI', provider: 'federal_reserve',
      date: '2024-01-01', region_type: 'state',
    })
  })

  it('schema rejects missing symbol', () => {
    const schema = (tools.economyFredRegional as any).inputSchema
    expect(schema.safeParse({}).success).toBe(false)
  })
})

describe('createEconomyTools — economyBlsSearch', () => {
  let client: EconomyClientLike
  let commodity: CommodityClientLike
  let tools: ReturnType<typeof createEconomyTools>

  beforeEach(() => {
    client = makeMockEconomyClient()
    commodity = makeMockCommodityClient()
    tools = createEconomyTools(client, commodity)
  })

  it('passes query through and pins provider to bls', async () => {
    await exec(tools.economyBlsSearch, { query: 'unemployment' })
    expect(client.getBlsSearch).toHaveBeenCalledWith({ query: 'unemployment', provider: 'bls' })
  })

  it('forwards optional limit when provided', async () => {
    await exec(tools.economyBlsSearch, { query: 'CPI', limit: 5 })
    expect(client.getBlsSearch).toHaveBeenCalledWith({ query: 'CPI', provider: 'bls', limit: 5 })
  })

  it('schema rejects missing query', () => {
    const schema = (tools.economyBlsSearch as any).inputSchema
    expect(schema.safeParse({}).success).toBe(false)
  })
})

describe('createEconomyTools — economyBlsSeries', () => {
  let client: EconomyClientLike
  let commodity: CommodityClientLike
  let tools: ReturnType<typeof createEconomyTools>

  beforeEach(() => {
    client = makeMockEconomyClient()
    commodity = makeMockCommodityClient()
    tools = createEconomyTools(client, commodity)
  })

  it('passes single symbol + provider', async () => {
    await exec(tools.economyBlsSeries, { symbol: 'LNS14000000' })
    expect(client.getBlsSeries).toHaveBeenCalledWith({ symbol: 'LNS14000000', provider: 'bls' })
  })

  it('passes comma-separated symbols verbatim', async () => {
    await exec(tools.economyBlsSeries, { symbol: 'LNS14000000,CUUR0000SA0' })
    expect(client.getBlsSeries).toHaveBeenCalledWith({ symbol: 'LNS14000000,CUUR0000SA0', provider: 'bls' })
  })

  it('forwards date range when provided', async () => {
    await exec(tools.economyBlsSeries, {
      symbol: 'LNS14000000', start_date: '2020-01-01', end_date: '2024-12-31',
    })
    expect(client.getBlsSeries).toHaveBeenCalledWith({
      symbol: 'LNS14000000', provider: 'bls',
      start_date: '2020-01-01', end_date: '2024-12-31',
    })
  })

  it('does NOT touch commodityClient', async () => {
    await exec(tools.economyBlsSeries, { symbol: 'LNS14000000' })
    expect(commodity.getEnergyOutlook).not.toHaveBeenCalled()
    expect(commodity.getPetroleumStatus).not.toHaveBeenCalled()
  })

  it('schema rejects missing symbol', () => {
    const schema = (tools.economyBlsSeries as any).inputSchema
    expect(schema.safeParse({}).success).toBe(false)
  })

  it('propagates client errors', async () => {
    ;(client.getBlsSeries as any).mockRejectedValueOnce(new Error('bls 503'))
    await expect(exec(tools.economyBlsSeries, { symbol: 'LNS14000000' })).rejects.toThrow('bls 503')
  })
})

describe('createEconomyTools — economyEnergyOutlook', () => {
  let economy: EconomyClientLike
  let commodity: CommodityClientLike
  let tools: ReturnType<typeof createEconomyTools>

  beforeEach(() => {
    economy = makeMockEconomyClient()
    commodity = makeMockCommodityClient()
    tools = createEconomyTools(economy, commodity)
  })

  it('passes category through and pins provider to eia', async () => {
    await exec(tools.economyEnergyOutlook, { category: 'crude_oil_price' })
    expect(commodity.getEnergyOutlook).toHaveBeenCalledWith({ category: 'crude_oil_price', provider: 'eia' })
  })

  it('forwards date range when provided', async () => {
    await exec(tools.economyEnergyOutlook, {
      category: 'natural_gas_price', start_date: '2024-01-01', end_date: '2024-12-31',
    })
    expect(commodity.getEnergyOutlook).toHaveBeenCalledWith({
      category: 'natural_gas_price', provider: 'eia',
      start_date: '2024-01-01', end_date: '2024-12-31',
    })
  })

  it('schema rejects unknown category (zod enum)', () => {
    const schema = (tools.economyEnergyOutlook as any).inputSchema
    expect(schema.safeParse({ category: 'bitcoin_price' }).success).toBe(false)
  })

  it('schema rejects missing category', () => {
    const schema = (tools.economyEnergyOutlook as any).inputSchema
    expect(schema.safeParse({}).success).toBe(false)
  })

  it('does NOT touch economyClient', async () => {
    await exec(tools.economyEnergyOutlook, { category: 'crude_oil_price' })
    expect(economy.fredSearch).not.toHaveBeenCalled()
    expect(economy.fredSeries).not.toHaveBeenCalled()
    expect(economy.fredRegional).not.toHaveBeenCalled()
  })

  it('propagates client errors instead of swallowing', async () => {
    ;(commodity.getEnergyOutlook as any).mockRejectedValueOnce(new Error('eia 403'))
    await expect(exec(tools.economyEnergyOutlook, { category: 'crude_oil_price' })).rejects.toThrow('eia 403')
  })
})

describe('createEconomyTools — economyPetroleumStatus', () => {
  let economy: EconomyClientLike
  let commodity: CommodityClientLike
  let tools: ReturnType<typeof createEconomyTools>

  beforeEach(() => {
    economy = makeMockEconomyClient()
    commodity = makeMockCommodityClient()
    tools = createEconomyTools(economy, commodity)
  })

  it('passes category through and pins provider to eia', async () => {
    await exec(tools.economyPetroleumStatus, { category: 'crude_oil_stocks' })
    expect(commodity.getPetroleumStatus).toHaveBeenCalledWith({ category: 'crude_oil_stocks', provider: 'eia' })
  })

  it('schema rejects unknown category', () => {
    const schema = (tools.economyPetroleumStatus as any).inputSchema
    expect(schema.safeParse({ category: 'gold_inventory' }).success).toBe(false)
  })

  it('does NOT touch economyClient', async () => {
    await exec(tools.economyPetroleumStatus, { category: 'crude_oil_stocks' })
    expect(economy.fredSearch).not.toHaveBeenCalled()
  })
})

describe('createEconomyTools — toolset surface', () => {
  it('exposes the FRED + BLS + EIA + OECD + PortWatch tools', () => {
    const tools = createEconomyTools(makeMockEconomyClient(), makeMockCommodityClient())
    expect(Object.keys(tools).sort()).toEqual([
      'economyBlsSearch',
      'economyBlsSeries',
      'economyChokepointVolume',
      'economyCountryCpi',
      'economyCountryHousePrices',
      'economyCountryRates',
      'economyCountryRetail',
      'economyCountrySharePrices',
      'economyDealerPositioning',
      'economyEnergyOutlook',
      'economyEuroAreaBop',
      'economyFedBalanceSheet',
      'economyFomcDocuments',
      'economyFredRegional',
      'economyFredSearch',
      'economyFredSeries',
      'economyLeadingIndicator',
      'economyPetroleumStatus',
      'economyPortSearch',
      'economyPortVolume',
    ])
  })

  it('every tool has a description and inputSchema', () => {
    const tools = createEconomyTools(makeMockEconomyClient(), makeMockCommodityClient()) as Record<string, any>
    for (const [name, t] of Object.entries(tools)) {
      expect(t.description, `${name} description`).toBeTruthy()
      expect(t.inputSchema, `${name} inputSchema`).toBeDefined()
    }
  })
})
