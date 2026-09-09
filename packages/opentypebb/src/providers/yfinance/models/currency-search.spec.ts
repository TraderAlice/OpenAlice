import { expect, it, vi } from 'vitest'
import { YFinanceCurrencySearchFetcher } from './currency-search.js'

vi.mock('../utils/helpers.js', () => ({
  searchYahooFinance: vi.fn().mockResolvedValue([
    { symbol: 'JPY=X', quoteType: 'CURRENCY', shortname: 'USD/JPY' },
    { symbol: 'EURGBP=X', quoteType: 'CURRENCY', shortname: 'EUR/GBP' },
    { symbol: 'EURUSD=X', quoteType: 'CURRENCY', shortname: 'EUR/USD' },
    { symbol: 'JPY', quoteType: 'EQUITY' },
  ]),
}))

it('normalizes abbreviated USD-base pairs without changing crosses or including equities', async () => {
  const query = YFinanceCurrencySearchFetcher.transformQuery({ query: 'JPY' })
  const raw = await YFinanceCurrencySearchFetcher.extractData(query, null)
  const pairs = YFinanceCurrencySearchFetcher.transformData(query, raw)
  expect(pairs.map(pair => pair.symbol)).toEqual(['USDJPY', 'EURGBP', 'EURUSD'])
})
