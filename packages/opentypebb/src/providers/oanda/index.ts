/**
 * OANDA v20 Provider.
 * Maps to: openbb_platform/providers/oanda/openbb_oanda/__init__.py
 *
 * DATA-ONLY provider: realtime FX and metal candles via OANDA's v20 REST API
 * (practice host). No order placement, no broker state. Maven is MT5-only and
 * prohibits automation — this exists for research (fetching candles /
 * instruments, e.g. EUR_GBP).
 */

import { Provider } from '../../core/provider/abstract/provider.js'
import { OandaCurrencyHistoricalFetcher } from './models/currency-historical.js'
import { OandaCurrencyPairsFetcher } from './models/currency-search.js'

export const oandaProvider = new Provider({
  name: 'oanda',
  website: 'https://developer.oanda.com',
  description:
    'OANDA v20 — realtime FX and metal prices via the practice (paper) REST API. ' +
    'Candles from 1m to 1M, tradable-instrument search. Data-only: research use.',
  credentials: ['api_key'],
  vendorMeta: {
    coverage:
      'Global FX (EUR_GBP, EUR_USD, …) + metals — OANDA v20 practice host, realtime candles 1m..1M.',
    howToUse:
      'OANDA pair names use underscore: EUR_GBP. Accepts EURGBP too (normalized). ' +
      'Key: free OANDA practice token (oanda.com → Manage API Access).',
  },
  fetcherDict: {
    CurrencyHistorical: OandaCurrencyHistoricalFetcher,
    CurrencyPairs: OandaCurrencyPairsFetcher,
  },
})
