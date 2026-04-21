import { beforeEach, describe, expect, it, vi } from 'vitest'
import { YFinanceEquitySearchFetcher } from './equity-search.js'
import { searchYahooFinance } from '../utils/helpers.js'

vi.mock('../utils/helpers.js', () => ({
  searchYahooFinance: vi.fn(),
}))

const searchMock = vi.mocked(searchYahooFinance)

describe('YFinanceEquitySearchFetcher', () => {
  beforeEach(() => {
    searchMock.mockReset()
  })

  it('maps Yahoo equity search results', async () => {
    searchMock.mockResolvedValue([
      {
        symbol: 'AAPL',
        shortname: 'Apple Inc.',
        quoteType: 'EQUITY',
        typeDisp: 'Equity',
        exchange: 'NMS',
        exchDisp: 'NASDAQ',
      },
      {
        symbol: 'BTC-USD',
        shortname: 'Bitcoin USD',
        quoteType: 'CRYPTOCURRENCY',
        exchange: 'CCC',
      },
    ])

    const data = await YFinanceEquitySearchFetcher.extractData(
      { query: 'apple', is_symbol: false },
      null,
    )
    const result = YFinanceEquitySearchFetcher.transformData({ query: 'apple', is_symbol: false }, data)

    expect(result).toEqual([
      expect.objectContaining({
        symbol: 'AAPL',
        name: 'Apple Inc.',
        exchange: 'NMS',
        exchange_name: 'NASDAQ',
        quote_type: 'EQUITY',
        native_symbol: 'AAPL',
      }),
    ])
  })

  it('filters Argentine/BYMA searches to Buenos Aires tickers', async () => {
    searchMock.mockResolvedValue([
      {
        symbol: 'GGAL',
        shortname: 'Grupo Financiero Galicia ADR',
        quoteType: 'EQUITY',
        exchange: 'NMS',
        exchDisp: 'NASDAQ',
      },
      {
        symbol: 'GGAL.BA',
        shortname: 'Grupo Financiero Galicia S.A.',
        quoteType: 'EQUITY',
        exchange: 'BUE',
        exchDisp: 'Buenos Aires',
      },
    ])

    const data = await YFinanceEquitySearchFetcher.extractData(
      { query: 'galicia', is_symbol: false, market: 'merval' },
      null,
    )
    const result = YFinanceEquitySearchFetcher.transformData(
      { query: 'galicia', is_symbol: false, market: 'merval' },
      data,
    )

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      symbol: 'GGAL.BA',
      native_symbol: 'GGAL',
      market: 'argentina',
      exchange_name: 'Buenos Aires',
    })
  })
})
