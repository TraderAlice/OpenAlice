import { expect, it, vi } from 'vitest'
import { YFinanceEquitySearchFetcher } from './equity-search.js'

vi.mock('../utils/helpers.js', () => ({
  searchYahooFinance: vi.fn().mockResolvedValue([
    { symbol: 'AAPL', quoteType: 'EQUITY', longname: 'Apple Inc.', exchDisp: 'NASDAQ' },
    { symbol: '1306.T', quoteType: 'ETF', shortname: 'NEXT FUNDS TOPIX ETF', exchDisp: 'Tokyo' },
    { symbol: '^N225', quoteType: 'INDEX', shortname: 'Nikkei 225', exchDisp: 'Osaka' },
    { symbol: '^GSPC', quoteType: 'index', shortname: 'S&P 500', exchDisp: 'SNP' },
    { symbol: 'BTC-USD', quoteType: 'CRYPTOCURRENCY', shortname: 'Bitcoin USD' },
    { symbol: 'JPY=X', quoteType: 'CURRENCY', shortname: 'USD/JPY' },
    { symbol: '', quoteType: 'EQUITY', shortname: 'Blank Symbol' },
  ]),
}))

it('accepts EQUITY, ETF, and INDEX quote types (case-insensitively) and excludes non-equity types', async () => {
  const query = YFinanceEquitySearchFetcher.transformQuery({ query: 'test' })
  const raw = await YFinanceEquitySearchFetcher.extractData(query, null)
  const items = YFinanceEquitySearchFetcher.transformData(query, raw)

  expect(items.map((item) => ({ symbol: item.symbol, quote_type: item.quote_type }))).toEqual([
    { symbol: 'AAPL', quote_type: 'EQUITY' },
    { symbol: '1306.T', quote_type: 'ETF' },
    { symbol: '^N225', quote_type: 'INDEX' },
    { symbol: '^GSPC', quote_type: 'index' },
  ])
})
