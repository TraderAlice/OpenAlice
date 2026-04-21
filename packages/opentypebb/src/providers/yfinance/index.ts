/**
 * YFinance Provider Module.
 * Maps to: openbb_platform/providers/yfinance/openbb_yfinance/__init__.py
 *
 * Only includes fetchers that have been ported to TypeScript.
 */

import { Provider } from '../../core/provider/abstract/provider.js'

import { YFinanceEquityQuoteFetcher } from './models/equity-quote.js'
import { YFinanceEquitySearchFetcher } from './models/equity-search.js'
import { YFinanceEquityProfileFetcher } from './models/equity-profile.js'
import { YFinanceEquityHistoricalFetcher } from './models/equity-historical.js'
import { YFinanceCompanyNewsFetcher } from './models/company-news.js'
import { YFinanceKeyMetricsFetcher } from './models/key-metrics.js'
import { YFinancePriceTargetConsensusFetcher } from './models/price-target-consensus.js'
import { YFinanceCryptoSearchFetcher } from './models/crypto-search.js'
import { YFinanceCurrencySearchFetcher } from './models/currency-search.js'
import { YFinanceCryptoHistoricalFetcher } from './models/crypto-historical.js'
import { YFinanceCurrencyHistoricalFetcher } from './models/currency-historical.js'
import { YFinanceBalanceSheetFetcher } from './models/balance-sheet.js'
import { YFinanceIncomeStatementFetcher } from './models/income-statement.js'
import { YFinanceCashFlowStatementFetcher } from './models/cash-flow.js'
import { YFGainersFetcher } from './models/gainers.js'
import { YFLosersFetcher } from './models/losers.js'
import { YFActiveFetcher } from './models/active.js'
import { YFAggressiveSmallCapsFetcher } from './models/aggressive-small-caps.js'
import { YFGrowthTechEquitiesFetcher } from './models/growth-tech.js'
import { YFUndervaluedGrowthEquitiesFetcher } from './models/undervalued-growth.js'
import { YFUndervaluedLargeCapsFetcher } from './models/undervalued-large-caps.js'
import { YFinanceKeyExecutivesFetcher } from './models/key-executives.js'
import { YFinanceHistoricalDividendsFetcher } from './models/historical-dividends.js'
import { YFinanceShareStatisticsFetcher } from './models/share-statistics.js'
import { YFinanceIndexHistoricalFetcher } from './models/index-historical.js'
import { YFinanceFuturesHistoricalFetcher } from './models/futures-historical.js'
import { YFinanceAvailableIndicesFetcher } from './models/available-indices.js'
import { YFinanceEtfInfoFetcher } from './models/etf-info.js'
import { YFinanceEquityScreenerFetcher } from './models/equity-screener.js'
import { YFinanceFuturesCurveFetcher } from './models/futures-curve.js'
import { YFinanceOptionsChainsFetcher } from './models/options-chains.js'
import { YFinanceCommoditySpotPriceFetcher } from './models/commodity-spot-price.js'

export const yfinanceProvider = new Provider({
  name: 'yfinance',
  website: 'https://finance.yahoo.com',
  description:
    'Yahoo! Finance is a web-based platform that offers financial news, ' +
    'data, and tools for investors and individuals interested in tracking ' +
    'and analyzing financial markets and assets.',
  fetcherDict: {
    EquitySearch: YFinanceEquitySearchFetcher,
    EquityQuote: YFinanceEquityQuoteFetcher,
    EquityInfo: YFinanceEquityProfileFetcher,
    EquityHistorical: YFinanceEquityHistoricalFetcher,
    EtfHistorical: YFinanceEquityHistoricalFetcher,
    CompanyNews: YFinanceCompanyNewsFetcher,
    KeyMetrics: YFinanceKeyMetricsFetcher,
    PriceTargetConsensus: YFinancePriceTargetConsensusFetcher,
    BalanceSheet: YFinanceBalanceSheetFetcher,
    IncomeStatement: YFinanceIncomeStatementFetcher,
    CashFlowStatement: YFinanceCashFlowStatementFetcher,
    CryptoSearch: YFinanceCryptoSearchFetcher,
    CurrencyPairs: YFinanceCurrencySearchFetcher,
    CryptoHistorical: YFinanceCryptoHistoricalFetcher,
    CurrencyHistorical: YFinanceCurrencyHistoricalFetcher,
    EquityGainers: YFGainersFetcher,
    EquityLosers: YFLosersFetcher,
    EquityActive: YFActiveFetcher,
    EquityAggressiveSmallCaps: YFAggressiveSmallCapsFetcher,
    GrowthTechEquities: YFGrowthTechEquitiesFetcher,
    EquityUndervaluedGrowth: YFUndervaluedGrowthEquitiesFetcher,
    EquityUndervaluedLargeCaps: YFUndervaluedLargeCapsFetcher,
    KeyExecutives: YFinanceKeyExecutivesFetcher,
    HistoricalDividends: YFinanceHistoricalDividendsFetcher,
    ShareStatistics: YFinanceShareStatisticsFetcher,
    IndexHistorical: YFinanceIndexHistoricalFetcher,
    FuturesHistorical: YFinanceFuturesHistoricalFetcher,
    AvailableIndices: YFinanceAvailableIndicesFetcher,
    EtfInfo: YFinanceEtfInfoFetcher,
    EquityScreener: YFinanceEquityScreenerFetcher,
    FuturesCurve: YFinanceFuturesCurveFetcher,
    OptionsChains: YFinanceOptionsChainsFetcher,
    CommoditySpotPrice: YFinanceCommoditySpotPriceFetcher,
  },
  reprName: 'Yahoo Finance',
})
