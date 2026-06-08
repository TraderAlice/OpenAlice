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
    getDividends: vi.fn(async () => []),
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

describe('createEquityTools — equityGetDividends', () => {
  let client: EquityClientLike
  let tools: ReturnType<typeof createEquityTools>

  beforeEach(() => {
    client = makeMockEquityClient()
    tools = createEquityTools(client)
  })

  it('fetches US dividends via yfinance, symbol unchanged', async () => {
    await exec(tools.equityGetDividends, { symbol: 'AAPL' })
    expect(client.getDividends).toHaveBeenCalledWith(
      expect.objectContaining({ symbol: 'AAPL', provider: 'yfinance' }),
    )
  })

  it('keeps an explicit Taiwan suffix and routes to yfinance (twse has no dividend feed)', async () => {
    await exec(tools.equityGetDividends, { symbol: '0056.TW' })
    expect(client.getDividends).toHaveBeenCalledWith(
      expect.objectContaining({ symbol: '0056.TW', provider: 'yfinance' }),
    )
  })

  it('appends .TW to a bare Taiwan code so Yahoo resolves it', async () => {
    await exec(tools.equityGetDividends, { symbol: '00878' })
    expect(client.getDividends).toHaveBeenCalledWith(
      expect.objectContaining({ symbol: '00878.TW', provider: 'yfinance' }),
    )
  })

  it('passes through a date range when provided', async () => {
    await exec(tools.equityGetDividends, { symbol: 'AAPL', start_date: '2024-01-01', end_date: '2024-12-31' })
    expect(client.getDividends).toHaveBeenCalledWith(
      expect.objectContaining({ symbol: 'AAPL', provider: 'yfinance', start_date: '2024-01-01', end_date: '2024-12-31' }),
    )
  })

  it('returns only the most recent `limit` distributions, newest last', async () => {
    const rows = [
      { symbol: '0056.TW', ex_dividend_date: '2025-07-21', amount: 0.866 },
      { symbol: '0056.TW', ex_dividend_date: '2025-10-23', amount: 0.866 },
      { symbol: '0056.TW', ex_dividend_date: '2026-01-22', amount: 0.866 },
      { symbol: '0056.TW', ex_dividend_date: '2026-04-23', amount: 1.0 },
    ]
    ;(client.getDividends as any).mockResolvedValueOnce(rows)
    const out = await exec(tools.equityGetDividends, { symbol: '0056.TW', limit: 2 })
    expect(out).toEqual(rows.slice(-2))
  })
})
