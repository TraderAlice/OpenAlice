/**
 * TWSE Provider.
 *
 * Taiwan Stock Exchange + Taipei Exchange (TPEx) open data.
 * Sources: https://openapi.twse.com.tw/ and https://www.tpex.org.tw/openapi/
 * Free, no API key required.
 */

import { Provider } from '../../core/provider/abstract/provider.js'
import { TwseEquitySearchFetcher } from './models/equity-search.js'
import { TwseEquityQuoteFetcher } from './models/equity-quote.js'
import { TwseKeyMetricsFetcher } from './models/key-metrics.js'
import { TwseEquityInfoFetcher } from './models/equity-info.js'

export const twseProvider = new Provider({
  name: 'twse',
  description: 'TWSE / TPEx open data — Taiwan securities enumeration, quotes, valuation ratios, and company profiles.',
  website: 'https://openapi.twse.com.tw/',
  fetcherDict: {
    EquitySearch: TwseEquitySearchFetcher,
    EquityQuote: TwseEquityQuoteFetcher,
    KeyMetrics: TwseKeyMetricsFetcher,
    EquityInfo: TwseEquityInfoFetcher,
  },
})
