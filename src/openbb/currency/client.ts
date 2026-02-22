/**
 * OpenBB Currency REST API Client
 *
 * Wraps the OpenBB sidecar API (default: http://localhost:6900).
 * Every method maps 1:1 to an OpenBB currency endpoint.
 */

import type { OBBjectResponse } from './types'

export class OpenBBCurrencyClient {
  private baseUrl: string
  private defaultProvider: string | undefined

  constructor(baseUrl: string, defaultProvider?: string) {
    this.baseUrl = baseUrl.replace(/\/$/, '')
    this.defaultProvider = defaultProvider
  }

  // ==================== Price ====================

  async getHistorical(params: Record<string, unknown>) {
    return this.request('/price/historical', params)
  }

  // ==================== Search ====================

  async search(params: Record<string, unknown>) {
    return this.request('/search', params)
  }

  // ==================== Reference Rates ====================

  async getReferenceRates(params: Record<string, unknown>) {
    return this.request('/reference_rates', params)
  }

  // ==================== Snapshots ====================

  async getSnapshots(params: Record<string, unknown>) {
    return this.request('/snapshots', params)
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

    const url = `${this.baseUrl}/api/v1/currency${path}?${query.toString()}`

    const res = await fetch(url, {
      signal: AbortSignal.timeout(30_000),
    })

    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new Error(`OpenBB API error ${res.status} on ${path}: ${body.slice(0, 200)}`)
    }

    const envelope = (await res.json()) as OBBjectResponse<T>
    return envelope.results ?? []
  }
}
