/**
 * Eastmoney (东方财富) Provider.
 *
 * Source: https://www.eastmoney.com/ — free, no API key (public web endpoints).
 * Opt-in incremental vendor for CN A-shares: Chinese-name search + 前复权 K-line,
 * the特质化 depth yfinance can't give. Self-consistent secid namespace.
 */

import { Provider } from '../../core/provider/abstract/provider.js'
import { EastmoneyEquitySearchFetcher } from './models/equity-search.js'
import { EastmoneyEquityHistoricalFetcher } from './models/equity-historical.js'

export const eastmoneyProvider = new Provider({
  name: 'eastmoney',
  reprName: 'Eastmoney 东方财富',
  description: 'Eastmoney 东方财富 — CN A-share quotes (Chinese-name search + 前复权 K-line).',
  website: 'https://www.eastmoney.com/',
  vendorMeta: {
    coverage: 'CN A-shares — Shanghai (沪) + Shenzhen (深) listed equities.',
    howToUse:
      'Search by Chinese name (茅台 → 600519, 比亚迪 → 002594) — this is the reason to enable it over yfinance. ' +
      'K-lines are 前复权 (forward-adjusted). Served from China, so it can be slow or blocked from outside the mainland.',
  },
  fetcherDict: {
    EquitySearch: EastmoneyEquitySearchFetcher,
    EquityHistorical: EastmoneyEquityHistoricalFetcher,
  },
})
