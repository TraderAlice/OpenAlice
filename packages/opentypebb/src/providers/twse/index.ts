/**
 * TWSE / TPEx Provider.
 *
 * Source: openapi.twse.com.tw (上市) + www.tpex.org.tw/openapi (上櫃) — free,
 * no API key. Opt-in incremental vendor for Taiwan equities: official
 * Chinese/English search over the full company directory, daily quotes, key
 * metrics (P/E · yield · P/B) and company profiles — the特質化 depth yfinance
 * doesn't serve for Taiwan names.
 *
 * Symbols are Yahoo-suffixed (`2330.TW` / `6488.TWO`), so historical K-lines are
 * served by Yahoo's public chart API: EquityHistorical reuses yfinance's fetcher
 * verbatim (same package, zero re-implementation) — a `twse|2330.TW` bar
 * candidate is therefore fully resolvable.
 */

import { Provider } from '../../core/provider/abstract/provider.js'
import { YFinanceEquityHistoricalFetcher } from '../yfinance/models/equity-historical.js'
import { TWSEEquitySearchFetcher } from './models/equity-search.js'
import { TWSEEquityQuoteFetcher } from './models/equity-quote.js'
import { TWSEKeyMetricsFetcher } from './models/key-metrics.js'
import { TWSEEquityInfoFetcher } from './models/equity-info.js'

export const twseProvider = new Provider({
  name: 'twse',
  reprName: 'TWSE + TPEx 臺灣證交所',
  description:
    'Taiwan Stock Exchange + TPEx (上市/上櫃) — official free open data: ' +
    'Chinese/English search, daily quotes, key metrics (P/E·yield·P/B), company ' +
    'profiles. K-lines via Yahoo (.TW/.TWO).',
  website: 'https://www.twse.com.tw/',
  vendorMeta: {
    coverage: 'Taiwan equities — TWSE listed (.TW) + TPEx OTC (.TWO).',
    howToUse:
      'Search by 繁体中文 (台積電, 聯發科) — NOT simplified (台积电 returns nothing), or by English / stock code. ' +
      'Symbols are Yahoo-suffixed: .TW for listed, .TWO for OTC. Adds official P/E·殖利率·股價淨值比 and company ' +
      'profiles on top of yfinance; K-lines still come from Yahoo.',
  },
  fetcherDict: {
    EquitySearch: TWSEEquitySearchFetcher,
    EquityQuote: TWSEEquityQuoteFetcher,
    KeyMetrics: TWSEKeyMetricsFetcher,
    EquityInfo: TWSEEquityInfoFetcher,
    EquityHistorical: YFinanceEquityHistoricalFetcher,
  },
})
