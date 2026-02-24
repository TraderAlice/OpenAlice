/**
 * OpenBB Economy REST API Client
 *
 * Wraps the OpenBB sidecar API (default: http://localhost:6900).
 * Every method maps 1:1 to an OpenBB economy endpoint.
 */

import type { OBBjectResponse } from './types'
import { buildCredentialsHeader } from '../credential-map'

export class OpenBBEconomyClient {
  private baseUrl: string
  private defaultProvider: string | undefined
  private credentialsHeader: string | undefined

  constructor(baseUrl: string, defaultProvider?: string, providerKeys?: Record<string, string | undefined>) {
    this.baseUrl = baseUrl.replace(/\/$/, '')
    this.defaultProvider = defaultProvider
    this.credentialsHeader = buildCredentialsHeader(providerKeys)
  }

  // ==================== Core ====================

  async getCalendar(params: Record<string, unknown> = {}) {
    return this.request('/calendar', params)
  }

  async getCPI(params: Record<string, unknown>) {
    return this.request('/cpi', params)
  }

  async getRiskPremium(params: Record<string, unknown>) {
    return this.request('/risk_premium', params)
  }

  async getBalanceOfPayments(params: Record<string, unknown>) {
    return this.request('/balance_of_payments', params)
  }

  async getMoneyMeasures(params: Record<string, unknown> = {}) {
    return this.request('/money_measures', params)
  }

  async getUnemployment(params: Record<string, unknown> = {}) {
    return this.request('/unemployment', params)
  }

  async getCompositeLeadingIndicator(params: Record<string, unknown> = {}) {
    return this.request('/composite_leading_indicator', params)
  }

  async getCountryProfile(params: Record<string, unknown>) {
    return this.request('/country_profile', params)
  }

  async getAvailableIndicators(params: Record<string, unknown> = {}) {
    return this.request('/available_indicators', params)
  }

  async getIndicators(params: Record<string, unknown>) {
    return this.request('/indicators', params)
  }

  async getCentralBankHoldings(params: Record<string, unknown> = {}) {
    return this.request('/central_bank_holdings', params)
  }

  async getSharePriceIndex(params: Record<string, unknown> = {}) {
    return this.request('/share_price_index', params)
  }

  async getHousePriceIndex(params: Record<string, unknown> = {}) {
    return this.request('/house_price_index', params)
  }

  async getInterestRates(params: Record<string, unknown> = {}) {
    return this.request('/interest_rates', params)
  }

  async getRetailPrices(params: Record<string, unknown> = {}) {
    return this.request('/retail_prices', params)
  }

  async getPrimaryDealerPositioning(params: Record<string, unknown> = {}) {
    return this.request('/primary_dealer_positioning', params)
  }

  async getPCE(params: Record<string, unknown> = {}) {
    return this.request('/pce', params)
  }

  async getExportDestinations(params: Record<string, unknown>) {
    return this.request('/export_destinations', params)
  }

  async getPrimaryDealerFails(params: Record<string, unknown> = {}) {
    return this.request('/primary_dealer_fails', params)
  }

  async getDirectionOfTrade(params: Record<string, unknown>) {
    return this.request('/direction_of_trade', params)
  }

  async getFomcDocuments(params: Record<string, unknown> = {}) {
    return this.request('/fomc_documents', params)
  }

  async getTotalFactorProductivity(params: Record<string, unknown> = {}) {
    return this.request('/total_factor_productivity', params)
  }

  // ==================== FRED ====================

  async fredSearch(params: Record<string, unknown>) {
    return this.request('/fred_search', params)
  }

  async fredSeries(params: Record<string, unknown>) {
    return this.request('/fred_series', params)
  }

  async fredReleaseTable(params: Record<string, unknown>) {
    return this.request('/fred_release_table', params)
  }

  async fredRegional(params: Record<string, unknown>) {
    return this.request('/fred_regional', params)
  }

  // ==================== GDP ====================

  async getGdpForecast(params: Record<string, unknown> = {}) {
    return this.request('/gdp/forecast', params)
  }

  async getGdpNominal(params: Record<string, unknown> = {}) {
    return this.request('/gdp/nominal', params)
  }

  async getGdpReal(params: Record<string, unknown> = {}) {
    return this.request('/gdp/real', params)
  }

  // ==================== Survey ====================

  async getBlsSeries(params: Record<string, unknown>) {
    return this.request('/survey/bls_series', params)
  }

  async getBlsSearch(params: Record<string, unknown>) {
    return this.request('/survey/bls_search', params)
  }

  async getSloos(params: Record<string, unknown> = {}) {
    return this.request('/survey/sloos', params)
  }

  async getUniversityOfMichigan(params: Record<string, unknown> = {}) {
    return this.request('/survey/university_of_michigan', params)
  }

  async getEconomicConditionsChicago(params: Record<string, unknown> = {}) {
    return this.request('/survey/economic_conditions_chicago', params)
  }

  async getManufacturingOutlookTexas(params: Record<string, unknown> = {}) {
    return this.request('/survey/manufacturing_outlook_texas', params)
  }

  async getManufacturingOutlookNY(params: Record<string, unknown> = {}) {
    return this.request('/survey/manufacturing_outlook_ny', params)
  }

  async getNonfarmPayrolls(params: Record<string, unknown> = {}) {
    return this.request('/survey/nonfarm_payrolls', params)
  }

  async getInflationExpectations(params: Record<string, unknown> = {}) {
    return this.request('/survey/inflation_expectations', params)
  }

  // ==================== Shipping ====================

  async getPortInfo(params: Record<string, unknown> = {}) {
    return this.request('/shipping/port_info', params)
  }

  async getPortVolume(params: Record<string, unknown> = {}) {
    return this.request('/shipping/port_volume', params)
  }

  async getChokepointInfo(params: Record<string, unknown> = {}) {
    return this.request('/shipping/chokepoint_info', params)
  }

  async getChokepointVolume(params: Record<string, unknown> = {}) {
    return this.request('/shipping/chokepoint_volume', params)
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

    const url = `${this.baseUrl}/api/v1/economy${path}?${query.toString()}`

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
