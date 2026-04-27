/**
 * Typed interfaces for market-data clients.
 *
 * Both the HTTP clients (OpenBBEquityClient etc.) and SDK clients (SDKEquityClient etc.)
 * satisfy these interfaces, allowing adapters to accept either implementation.
 *
 * Return types come from openTypeBB standard models.
 */

import type {
  // Equity
  EquitySearchData, EquityHistoricalData, EquityInfoData, KeyMetricsData,
  IncomeStatementData, BalanceSheetData, CashFlowStatementData, FinancialRatiosData,
  PriceTargetConsensusData, CalendarEarningsData, InsiderTradingData, EquityDiscoveryData,
  // Crypto
  CryptoSearchData, CryptoHistoricalData,
  // Currency
  CurrencyHistoricalData, CurrencySnapshotsData,
  // ETF
  EtfSearchData, EtfInfoData, EtfHoldingsData, EtfSectorsData,
  EtfCountriesData, EtfEquityExposureData,
  // Index
  AvailableIndicesData, IndexSearchData, IndexConstituentsData, IndexHistoricalData,
  IndexSectorsData, SP500MultiplesData, RiskPremiumData,
  // Derivatives
  FuturesHistoricalData, FuturesCurveData, FuturesInfoData, FuturesInstrumentsData,
  OptionsChainsData, OptionsSnapshotsData, OptionsUnusualData,
  // Commodity
  CommoditySpotPriceData,
} from '@traderalice/opentypebb'

export interface EquityClientLike {
  search(params: Record<string, unknown>): Promise<EquitySearchData[]>
  getHistorical(params: Record<string, unknown>): Promise<EquityHistoricalData[]>
  getProfile(params: Record<string, unknown>): Promise<EquityInfoData[]>
  getKeyMetrics(params: Record<string, unknown>): Promise<KeyMetricsData[]>
  getIncomeStatement(params: Record<string, unknown>): Promise<IncomeStatementData[]>
  getBalanceSheet(params: Record<string, unknown>): Promise<BalanceSheetData[]>
  getCashFlow(params: Record<string, unknown>): Promise<CashFlowStatementData[]>
  getFinancialRatios(params: Record<string, unknown>): Promise<FinancialRatiosData[]>
  getEstimateConsensus(params: Record<string, unknown>): Promise<PriceTargetConsensusData[]>
  getCalendarEarnings(params?: Record<string, unknown>): Promise<CalendarEarningsData[]>
  getInsiderTrading(params: Record<string, unknown>): Promise<InsiderTradingData[]>
  getGainers(params?: Record<string, unknown>): Promise<EquityDiscoveryData[]>
  getLosers(params?: Record<string, unknown>): Promise<EquityDiscoveryData[]>
  getActive(params?: Record<string, unknown>): Promise<EquityDiscoveryData[]>
}

export interface CryptoClientLike {
  search(params: Record<string, unknown>): Promise<CryptoSearchData[]>
  getHistorical(params: Record<string, unknown>): Promise<CryptoHistoricalData[]>
}

export interface CurrencyClientLike {
  search(params: Record<string, unknown>): Promise<Record<string, unknown>[]>
  getHistorical(params: Record<string, unknown>): Promise<CurrencyHistoricalData[]>
  getSnapshots(params: Record<string, unknown>): Promise<CurrencySnapshotsData[]>
}

export interface EtfClientLike {
  search(params: Record<string, unknown>): Promise<EtfSearchData[]>
  getInfo(params: Record<string, unknown>): Promise<EtfInfoData[]>
  getHoldings(params: Record<string, unknown>): Promise<EtfHoldingsData[]>
  getSectors(params: Record<string, unknown>): Promise<EtfSectorsData[]>
  getCountries(params: Record<string, unknown>): Promise<EtfCountriesData[]>
  getEquityExposure(params: Record<string, unknown>): Promise<EtfEquityExposureData[]>
  getHistorical(params: Record<string, unknown>): Promise<Record<string, unknown>[]>
}

export interface IndexClientLike {
  getAvailable(params?: Record<string, unknown>): Promise<AvailableIndicesData[]>
  search(params: Record<string, unknown>): Promise<IndexSearchData[]>
  getConstituents(params: Record<string, unknown>): Promise<IndexConstituentsData[]>
  getHistorical(params: Record<string, unknown>): Promise<IndexHistoricalData[]>
  getSnapshots(params?: Record<string, unknown>): Promise<Record<string, unknown>[]>
  getSectors(params: Record<string, unknown>): Promise<IndexSectorsData[]>
  getSP500Multiples(params?: Record<string, unknown>): Promise<SP500MultiplesData[]>
  getRiskPremium(params?: Record<string, unknown>): Promise<RiskPremiumData[]>
}

export interface CommodityClientLike {
  getSpotPrices(params: Record<string, unknown>): Promise<CommoditySpotPriceData[]>
}

export interface FixedIncomeSearchData {
  symbol: string
  name?: string | null
  market?: string | null
  country?: string | null
  exchange?: string | null
  issuer?: string | null
  currency?: string | null
  maturityDate?: string | null
  coupon?: number | null
  instrumentType?: string | null
  isin?: string | null
  source?: string | null
  [key: string]: unknown
}

export interface FixedIncomeClientLike {
  search(params: Record<string, unknown>): Promise<FixedIncomeSearchData[]>
}

export interface DerivativesClientLike {
  getFuturesHistorical(params: Record<string, unknown>): Promise<FuturesHistoricalData[]>
  getFuturesCurve(params: Record<string, unknown>): Promise<FuturesCurveData[]>
  getFuturesInfo(params: Record<string, unknown>): Promise<FuturesInfoData[]>
  getFuturesInstruments(params?: Record<string, unknown>): Promise<FuturesInstrumentsData[]>
  getOptionsChains(params: Record<string, unknown>): Promise<OptionsChainsData[]>
  getOptionsSnapshots(params?: Record<string, unknown>): Promise<OptionsSnapshotsData[]>
  getOptionsUnusual(params?: Record<string, unknown>): Promise<OptionsUnusualData[]>
}
