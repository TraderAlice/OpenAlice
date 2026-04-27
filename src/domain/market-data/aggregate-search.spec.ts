import { describe, expect, it, vi } from 'vitest'
import { aggregateSymbolSearch } from './aggregate-search.js'

function deps(overrides: Record<string, unknown> = {}) {
  return {
    symbolIndex: { search: vi.fn().mockReturnValue([]) },
    equityClient: { search: vi.fn().mockResolvedValue([]) },
    fixedIncomeClient: { search: vi.fn().mockResolvedValue([]) },
    cryptoClient: { search: vi.fn().mockResolvedValue([]) },
    currencyClient: { search: vi.fn().mockResolvedValue([]) },
    commodityCatalog: { search: vi.fn().mockReturnValue([]) },
    ...overrides,
  } as never
}

describe('aggregateSymbolSearch', () => {
  it('includes fixed-income results from the configured client', async () => {
    const fixedIncomeClient = {
      search: vi.fn().mockResolvedValue([
        { symbol: 'AL30', name: 'Bonar 2030', market: 'argentina', source: 'iol' },
      ]),
    }

    const result = await aggregateSymbolSearch(deps({ fixedIncomeClient }), 'AL30', 10, { market: 'argentina' })

    expect(fixedIncomeClient.search).toHaveBeenCalledWith({
      query: 'AL30',
      limit: 10,
      market: 'argentina',
    })
    expect(result).toEqual([
      expect.objectContaining({
        symbol: 'AL30',
        assetClass: 'fixed_income',
      }),
    ])
  })

  it('keeps equity discovery working when fixed-income discovery fails', async () => {
    const result = await aggregateSymbolSearch(
      deps({
        equityClient: { search: vi.fn().mockResolvedValue([{ symbol: 'GGAL.BA', name: 'Grupo Financiero Galicia' }]) },
        fixedIncomeClient: { search: vi.fn().mockRejectedValue(new Error('IOL unavailable')) },
      }),
      'GGAL',
      10,
      { market: 'argentina' },
    )

    expect(result).toEqual([
      expect.objectContaining({
        symbol: 'GGAL.BA',
        assetClass: 'equity',
      }),
    ])
  })
})
