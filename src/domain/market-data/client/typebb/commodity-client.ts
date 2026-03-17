/**
 * SDK Commodity Client
 *
 * Drop-in replacement for OpenBBCommodityClient.
 *
 * NOTE: OpenTypeBB does not yet have commodity routes. These methods will throw
 * "No SDK route for: /commodity/..." until the corresponding fetchers are added.
 */

import { SDKBaseClient } from './base-client.js'

export class SDKCommodityClient extends SDKBaseClient {
  async getSpotPrices(params: Record<string, unknown>) {
    return this.request('/price/spot', params)
  }

  async getPsdData(params: Record<string, unknown>) {
    return this.request('/psd_data', params)
  }

  async getPetroleumStatus(params: Record<string, unknown>) {
    return this.request('/petroleum_status_report', params)
  }

  async getEnergyOutlook(params: Record<string, unknown>) {
    return this.request('/short_term_energy_outlook', params)
  }

  async getPsdReport(params: Record<string, unknown>) {
    return this.request('/psd_report', params)
  }

  async getWeatherBulletins(params: Record<string, unknown> = {}) {
    return this.request('/weather_bulletins', params)
  }
}
