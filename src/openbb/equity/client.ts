/**
 * OpenBB Equity REST API Client
 *
 * Wraps the OpenBB sidecar API (default: http://localhost:6900).
 * Every method maps 1:1 to an OpenBB equity endpoint.
 */

import type { OBBjectResponse } from './types/base'
import { buildCredentialsHeader } from '../credential-map'

export class OpenBBEquityClient {
  private baseUrl: string
  private defaultProvider: string | undefined
  private credentialsHeader: string | undefined

  constructor(baseUrl: string, defaultProvider?: string, providerKeys?: Record<string, string | undefined>) {
    this.baseUrl = baseUrl.replace(/\/$/, '')
    this.defaultProvider = defaultProvider
    this.credentialsHeader = buildCredentialsHeader(providerKeys)
  }

  // ==================== Price ====================

  async getHistorical(params: Record<string, unknown>) {
    return this.request('/price/historical', params)
  }

  async getQuote(params: Record<string, unknown>) {
    return this.request('/price/quote', params)
  }

  async getNBBO(params: Record<string, unknown>) {
    return this.request('/price/nbbo', params)
  }

  async getPricePerformance(params: Record<string, unknown>) {
    return this.request('/price/performance', params)
  }

  // ==================== Info ====================

  async search(params: Record<string, unknown>) {
    return this.request('/search', params)
  }

  async screener(params: Record<string, unknown>) {
    return this.request('/screener', params)
  }

  async getProfile(params: Record<string, unknown>) {
    return this.request('/profile', params)
  }

  async getMarketSnapshots(params: Record<string, unknown> = {}) {
    return this.request('/market_snapshots', params)
  }

  async getHistoricalMarketCap(params: Record<string, unknown>) {
    return this.request('/historical_market_cap', params)
  }

  // ==================== Fundamental ====================

  async getBalanceSheet(params: Record<string, unknown>) {
    return this.request('/fundamental/balance', params)
  }

  async getBalanceSheetGrowth(params: Record<string, unknown>) {
    return this.request('/fundamental/balance_growth', params)
  }

  async getIncomeStatement(params: Record<string, unknown>) {
    return this.request('/fundamental/income', params)
  }

  async getIncomeStatementGrowth(params: Record<string, unknown>) {
    return this.request('/fundamental/income_growth', params)
  }

  async getCashFlow(params: Record<string, unknown>) {
    return this.request('/fundamental/cash', params)
  }

  async getCashFlowGrowth(params: Record<string, unknown>) {
    return this.request('/fundamental/cash_growth', params)
  }

  async getReportedFinancials(params: Record<string, unknown>) {
    return this.request('/fundamental/reported_financials', params)
  }

  async getFinancialRatios(params: Record<string, unknown>) {
    return this.request('/fundamental/ratios', params)
  }

  async getKeyMetrics(params: Record<string, unknown>) {
    return this.request('/fundamental/metrics', params)
  }

  async getDividends(params: Record<string, unknown>) {
    return this.request('/fundamental/dividends', params)
  }

  async getEarningsHistory(params: Record<string, unknown>) {
    return this.request('/fundamental/historical_eps', params)
  }

  async getEmployeeCount(params: Record<string, unknown>) {
    return this.request('/fundamental/employee_count', params)
  }

  async getManagement(params: Record<string, unknown>) {
    return this.request('/fundamental/management', params)
  }

  async getManagementCompensation(params: Record<string, unknown>) {
    return this.request('/fundamental/management_compensation', params)
  }

  async getFilings(params: Record<string, unknown>) {
    return this.request('/fundamental/filings', params)
  }

  async getSplits(params: Record<string, unknown>) {
    return this.request('/fundamental/historical_splits', params)
  }

  async getTranscript(params: Record<string, unknown>) {
    return this.request('/fundamental/transcript', params)
  }

  async getTrailingDividendYield(params: Record<string, unknown>) {
    return this.request('/fundamental/trailing_dividend_yield', params)
  }

  async getRevenuePerGeography(params: Record<string, unknown>) {
    return this.request('/fundamental/revenue_per_geography', params)
  }

  async getRevenuePerSegment(params: Record<string, unknown>) {
    return this.request('/fundamental/revenue_per_segment', params)
  }

  async getEsgScore(params: Record<string, unknown>) {
    return this.request('/fundamental/esg_score', params)
  }

  async getSearchAttributes(params: Record<string, unknown>) {
    return this.request('/fundamental/search_attributes', params)
  }

  async getLatestAttributes(params: Record<string, unknown>) {
    return this.request('/fundamental/latest_attributes', params)
  }

  async getHistoricalAttributes(params: Record<string, unknown>) {
    return this.request('/fundamental/historical_attributes', params)
  }

  // ==================== Calendar ====================

  async getCalendarIpo(params: Record<string, unknown> = {}) {
    return this.request('/calendar/ipo', params)
  }

  async getCalendarDividend(params: Record<string, unknown> = {}) {
    return this.request('/calendar/dividend', params)
  }

  async getCalendarSplits(params: Record<string, unknown> = {}) {
    return this.request('/calendar/splits', params)
  }

  async getCalendarEarnings(params: Record<string, unknown> = {}) {
    return this.request('/calendar/earnings', params)
  }

  async getCalendarEvents(params: Record<string, unknown> = {}) {
    return this.request('/calendar/events', params)
  }

  // ==================== Estimates ====================

  async getPriceTarget(params: Record<string, unknown>) {
    return this.request('/estimates/price_target', params)
  }

  async getAnalystEstimates(params: Record<string, unknown>) {
    return this.request('/estimates/historical', params)
  }

  async getEstimateConsensus(params: Record<string, unknown>) {
    return this.request('/estimates/consensus', params)
  }

  async getAnalystSearch(params: Record<string, unknown>) {
    return this.request('/estimates/analyst_search', params)
  }

  async getForwardSales(params: Record<string, unknown>) {
    return this.request('/estimates/forward_sales', params)
  }

  async getForwardEbitda(params: Record<string, unknown>) {
    return this.request('/estimates/forward_ebitda', params)
  }

  async getForwardEps(params: Record<string, unknown>) {
    return this.request('/estimates/forward_eps', params)
  }

  async getForwardPe(params: Record<string, unknown>) {
    return this.request('/estimates/forward_pe', params)
  }

  // ==================== Discovery ====================

  async getGainers(params: Record<string, unknown> = {}) {
    return this.request('/discovery/gainers', params)
  }

  async getLosers(params: Record<string, unknown> = {}) {
    return this.request('/discovery/losers', params)
  }

  async getActive(params: Record<string, unknown> = {}) {
    return this.request('/discovery/active', params)
  }

  async getUndervaluedLargeCaps(params: Record<string, unknown> = {}) {
    return this.request('/discovery/undervalued_large_caps', params)
  }

  async getUndervaluedGrowth(params: Record<string, unknown> = {}) {
    return this.request('/discovery/undervalued_growth', params)
  }

  async getAggressiveSmallCaps(params: Record<string, unknown> = {}) {
    return this.request('/discovery/aggressive_small_caps', params)
  }

  async getGrowthTech(params: Record<string, unknown> = {}) {
    return this.request('/discovery/growth_tech', params)
  }

  async getTopRetail(params: Record<string, unknown> = {}) {
    return this.request('/discovery/top_retail', params)
  }

  async getDiscoveryFilings(params: Record<string, unknown> = {}) {
    return this.request('/discovery/filings', params)
  }

  async getLatestFinancialReports(params: Record<string, unknown> = {}) {
    return this.request('/discovery/latest_financial_reports', params)
  }

  // ==================== Ownership ====================

  async getMajorHolders(params: Record<string, unknown>) {
    return this.request('/ownership/major_holders', params)
  }

  async getInstitutional(params: Record<string, unknown>) {
    return this.request('/ownership/institutional', params)
  }

  async getInsiderTrading(params: Record<string, unknown>) {
    return this.request('/ownership/insider_trading', params)
  }

  async getShareStatistics(params: Record<string, unknown>) {
    return this.request('/ownership/share_statistics', params)
  }

  async getForm13F(params: Record<string, unknown>) {
    return this.request('/ownership/form_13f', params)
  }

  async getGovernmentTrades(params: Record<string, unknown> = {}) {
    return this.request('/ownership/government_trades', params)
  }

  // ==================== Shorts ====================

  async getFailsToDeliver(params: Record<string, unknown>) {
    return this.request('/shorts/fails_to_deliver', params)
  }

  async getShortVolume(params: Record<string, unknown>) {
    return this.request('/shorts/short_volume', params)
  }

  async getShortInterest(params: Record<string, unknown>) {
    return this.request('/shorts/short_interest', params)
  }

  // ==================== Compare ====================

  async getPeers(params: Record<string, unknown>) {
    return this.request('/compare/peers', params)
  }

  async getCompareGroups(params: Record<string, unknown> = {}) {
    return this.request('/compare/groups', params)
  }

  async getCompareCompanyFacts(params: Record<string, unknown>) {
    return this.request('/compare/company_facts', params)
  }

  // ==================== DarkPool ====================

  async getOtc(params: Record<string, unknown>) {
    return this.request('/darkpool/otc', params)
  }

  // ==================== Internal ====================

  private async request<T = Record<string, unknown>>(path: string, params: Record<string, unknown>): Promise<T[]> {
    const query = new URLSearchParams()

    // Inject default provider if not specified
    if (this.defaultProvider && !params.provider) {
      query.set('provider', this.defaultProvider)
    }

    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null) {
        query.set(key, String(value))
      }
    }

    const url = `${this.baseUrl}/api/v1/equity${path}?${query.toString()}`

    const headers: Record<string, string> = {}
    if (this.credentialsHeader) {
      headers['X-OpenBB-Credentials'] = this.credentialsHeader
    }

    const res = await fetch(url, {
      signal: AbortSignal.timeout(30_000),
      headers,
    })

    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new Error(`OpenBB API error ${res.status} on ${path}: ${body.slice(0, 200)}`)
    }

    const envelope = (await res.json()) as OBBjectResponse<T>
    return envelope.results ?? []
  }
}
