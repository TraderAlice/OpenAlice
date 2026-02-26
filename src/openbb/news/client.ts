/**
 * OpenBB News REST API Client
 *
 * Wraps the OpenBB sidecar API (default: http://localhost:6900).
 * Every method maps 1:1 to an OpenBB news endpoint.
 */

import type { OBBjectResponse } from './types'
import { buildCredentialsHeader } from '../credential-map'

export class OpenBBNewsClient {
  private baseUrl: string
  private defaultProvider: string | undefined
  private credentialsHeader: string | undefined

  constructor(baseUrl: string, defaultProvider?: string, providerKeys?: Record<string, string | undefined>) {
    this.baseUrl = baseUrl.replace(/\/$/, '')
    this.defaultProvider = defaultProvider
    this.credentialsHeader = buildCredentialsHeader(providerKeys)
  }

  // ==================== News ====================

  async getWorldNews(params: Record<string, unknown> = {}) {
    return this.request('/world', params)
  }

  async getCompanyNews(params: Record<string, unknown>) {
    return this.request('/company', params)
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

    const url = `${this.baseUrl}/api/v1/news${path}?${query.toString()}`

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
