/**
 * SDK Economy Client
 *
 * Drop-in replacement for OpenBBEconomyClient.
 */

import { SDKBaseClient } from './base-client.js'

export class SDKEconomyClient extends SDKBaseClient {
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
}
