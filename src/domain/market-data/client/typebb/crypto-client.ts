/**
 * SDK Crypto Client
 *
 * Drop-in replacement for OpenBBCryptoClient.
 */

import { SDKBaseClient } from './base-client.js'

export class SDKCryptoClient extends SDKBaseClient {
  async getHistorical(params: Record<string, unknown>) {
    return this.request('/price/historical', params)
  }

  async search(params: Record<string, unknown>) {
    return this.request('/search', params)
  }
}
