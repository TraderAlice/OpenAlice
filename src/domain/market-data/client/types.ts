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
  PriceTargetConsensusData, CalendarEarningsData, CalendarIpoData, CalendarDividendData,
  InsiderTradingData, EquityDiscoveryData, ShareStatisticsData,
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
  CommoditySpotPriceData, PetroleumStatusReportData, ShortTermEnergyOutlookData,
  // Economy (FRED + BLS + OECD)
  EconomicCalendarData, FredSearchData, FredSeriesData, FredRegionalData,
  BlsSearchData, BlsSeriesData,
  ConsumerPriceIndexData, CountryInterestRatesData, CompositeLeadingIndicatorData,
  PortInfoData, PortVolumeData, ChokepointInfoData, ChokepointVolumeData,
  RetailPricesData, BalanceOfPaymentsData, HousePriceIndexData, SharePriceIndexData,
  FomcDocumentsData, CentralBankHoldingsData, PrimaryDealerPositioningData,
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
  getCalendarIpo(params?: Record<string, unknown>): Promise<CalendarIpoData[]>
  getCalendarDividend(params?: Record<string, unknown>): Promise<CalendarDividendData[]>
  getInsiderTrading(params: Record<string, unknown>): Promise<InsiderTradingData[]>
  getShareStatistics(params: Record<string, unknown>): Promise<ShareStatisticsData[]>
  getGainers(params?: Record<string, unknown>): Promise<EquityDiscoveryData[]>
  getLosers(params?: Record<string, unknown>): Promise<EquityDiscoveryData[]>
  getActive(params?: Record<string, unknown>): Promise<EquityDiscoveryData[]>
  // Yahoo screeners (keyless) — value/growth/size discovery lenses.
  getUndervaluedGrowth(params?: Record<string, unknown>): Promise<EquityDiscoveryData[]>
  getGrowthTech(params?: Record<string, unknown>): Promise<EquityDiscoveryData[]>
  getAggressiveSmallCaps(params?: Record<string, unknown>): Promise<EquityDiscoveryData[]>
  getUndervaluedLargeCaps(params?: Record<string, unknown>): Promise<EquityDiscoveryData[]>
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
  // EIA endpoints — semantically macro/economy data, but OpenBB upstream
  // routes them under /commodity/* (output is oil/gas prices + inventories).
  // The SDK clients carry them; the tool layer surfaces them under
  // tool/economy.ts so AI agents see one coherent macro namespace.
  getPetroleumStatus(params: Record<string, unknown>): Promise<PetroleumStatusReportData[]>
  getEnergyOutlook(params: Record<string, unknown>): Promise<ShortTermEnergyOutlookData[]>
}

export interface EconomyClientLike {
  getCalendar(params?: Record<string, unknown>): Promise<EconomicCalendarData[]>
  fredSearch(params: Record<string, unknown>): Promise<FredSearchData[]>
  fredSeries(params: Record<string, unknown>): Promise<FredSeriesData[]>
  fredRegional(params: Record<string, unknown>): Promise<FredRegionalData[]>
  // BLS — Bureau of Labor Statistics, mounted under /economy/survey/* upstream
  getBlsSearch(params: Record<string, unknown>): Promise<BlsSearchData[]>
  getBlsSeries(params: Record<string, unknown>): Promise<BlsSeriesData[]>
  // OECD — cross-country comparison (keyless). Units differ per endpoint:
  // CPI yoy comes back in percent, interest rates as fractions.
  getCPI(params: Record<string, unknown>): Promise<ConsumerPriceIndexData[]>
  getInterestRates(params?: Record<string, unknown>): Promise<CountryInterestRatesData[]>
  getCompositeLeadingIndicator(params?: Record<string, unknown>): Promise<CompositeLeadingIndicatorData[]>
  getRetailPrices(params?: Record<string, unknown>): Promise<RetailPricesData[]>
  getHousePriceIndex(params?: Record<string, unknown>): Promise<HousePriceIndexData[]>
  getSharePriceIndex(params?: Record<string, unknown>): Promise<SharePriceIndexData[]>
  // ECB — euro-area balance of payments (keyless).
  getBalanceOfPayments(params?: Record<string, unknown>): Promise<BalanceOfPaymentsData[]>
  // Fed specials — FOMC document links (fed website), balance sheet (FRED
  // H.4.1), primary dealer net positions (NY Fed markets API, keyless).
  getFomcDocuments(params?: Record<string, unknown>): Promise<FomcDocumentsData[]>
  getCentralBankHoldings(params?: Record<string, unknown>): Promise<CentralBankHoldingsData[]>
  getPrimaryDealerPositioning(params?: Record<string, unknown>): Promise<PrimaryDealerPositioningData[]>
  // IMF PortWatch — satellite AIS shipping data (keyless ArcGIS layers).
  getPortInfo(params?: Record<string, unknown>): Promise<PortInfoData[]>
  getPortVolume(params?: Record<string, unknown>): Promise<PortVolumeData[]>
  getChokepointInfo(params?: Record<string, unknown>): Promise<ChokepointInfoData[]>
  getChokepointVolume(params?: Record<string, unknown>): Promise<ChokepointVolumeData[]>
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
