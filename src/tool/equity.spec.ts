/**
 * Equity tool unit tests — Taiwan-symbol detection + provider routing.
 *
 * Mirrors the economy.spec.ts pattern: don't hit the network, mock the
 * EquityClientLike surface, and verify the provider-selection logic that
 * routes Taiwan-listed symbols to the `twse` provider (TWSE/TPEx open data)
 * while everything else stays on yfinance.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { EquityClientLike } from '@/domain/market-data/client/types'
import { createEquityTools, isTaiwanSymbol } from './equity.js'

function makeMockEquityClient(): EquityClientLike {
  return {
    search: vi.fn(async () => []),
    getHistorical: vi.fn(async () => []),
    getProfile: vi.fn(async () => []),
    getKeyMetrics: vi.fn(async () => []),
    getIncomeStatement: vi.fn(async () => []),
    getBalanceSheet: vi.fn(async () => []),
    getCashFlow: vi.fn(async () => []),
    getFinancialRatios: vi.fn(async () => []),
    getEstimateConsensus: vi.fn(async () => []),
    getCalendarEarnings: vi.fn(async () => []),
    getInsiderTrading: vi.fn(async () => []),
    getGainers: vi.fn(async () => []),
    getLosers: vi.fn(async () => []),
    getActive: vi.fn(async () => []),
  }
}

// Bypass Vercel AI's tool execute typing — same pattern as economy.spec.ts
const exec = (t: any, args: unknown) => (t.execute as Function)(args)

describe('isTaiwanSymbol', () => {
  it('matches Yahoo-suffixed Taiwan symbols (case-insensitive)', () => {
    expect(isTaiwanSymbol('2330.TW')).toBe(true)
    expect(isTaiwanSymbol('6488.TWO')).toBe(true)
    expect(isTaiwanSymbol('2330.tw')).toBe(true)
  })

  it('matches bare numeric listing codes (stocks + ETFs)', () => {
    expect(isTaiwanSymbol('2330')).toBe(true)
    expect(isTaiwanSymbol('0050')).toBe(true)
    expect(isTaiwanSymbol('00878')).toBe(true)
    expect(isTaiwanSymbol('911616')).toBe(true)
  })

  it('does not match US tickers or other suffixes', () => {
    expect(isTaiwanSymbol('AAPL')).toBe(false)
    expect(isTaiwanSymbol('MSFT')).toBe(false)
    expect(isTaiwanSymbol('BRK.B')).toBe(false)
    expect(isTaiwanSymbol('7203.T')).toBe(false) // Tokyo, not Taiwan
  })
})

describe('createEquityTools — equityGetProfile provider routing', () => {
  let client: EquityClientLike
  let tools: ReturnType<typeof createEquityTools>

  beforeEach(() => {
    client = makeMockEquityClient()
    tools = createEquityTools(client)
  })

  it('routes Taiwan symbols to the twse provider', async () => {
    await exec(tools.equityGetProfile, { symbol: '2330.TW' })
    expect(client.getProfile).toHaveBeenCalledWith({ symbol: '2330.TW', provider: 'twse' })
    expect(client.getKeyMetrics).toHaveBeenCalledWith({ symbol: '2330.TW', limit: 1, provider: 'twse' })
  })

  it('routes bare Taiwan codes to the twse provider', async () => {
    await exec(tools.equityGetProfile, { symbol: '2330' })
    expect(client.getProfile).toHaveBeenCalledWith({ symbol: '2330', provider: 'twse' })
  })

  it('keeps US symbols on yfinance', async () => {
    await exec(tools.equityGetProfile, { symbol: 'AAPL' })
    expect(client.getProfile).toHaveBeenCalledWith({ symbol: 'AAPL', provider: 'yfinance' })
    expect(client.getKeyMetrics).toHaveBeenCalledWith({ symbol: 'AAPL', limit: 1, provider: 'yfinance' })
  })
})

describe('createEquityTools — equityGetRatios Taiwan short-circuit', () => {
  let client: EquityClientLike
  let tools: ReturnType<typeof createEquityTools>

  beforeEach(() => {
    client = makeMockEquityClient()
    tools = createEquityTools(client)
  })

  it('short-circuits Taiwan symbols with a pointer to equityGetProfile', async () => {
    const out = await exec(tools.equityGetRatios, { symbol: '2330.TW' })
    expect(client.getFinancialRatios).not.toHaveBeenCalled()
    expect(out).toMatchObject({ ratios: [] })
    expect(out.message).toContain('equityGetProfile')
  })

  it('still routes US symbols to the fmp ratios provider', async () => {
    await exec(tools.equityGetRatios, { symbol: 'AAPL' })
    expect(client.getFinancialRatios).toHaveBeenCalledWith(
      expect.objectContaining({ symbol: 'AAPL', provider: 'fmp' }),
    )
  })
})
