import { headers } from './client'

export interface HubStatus {
  enabled: boolean
  baseUrl: string
  reachable: boolean
}

export const marketDataApi = {
  async testProvider(
    provider: string,
    key: string,
    baseUrl?: string,
  ): Promise<{ ok: boolean; error?: string; capabilities?: Array<{ name: string; ok: boolean; error?: string }> }> {
    const res = await fetch('/api/market-data/test-provider', {
      method: 'POST',
      headers,
      body: JSON.stringify({ provider, key, ...(baseUrl ? { baseUrl } : {}) }),
    })
    return res.json()
  },

  async hubStatus(baseUrl?: string): Promise<HubStatus> {
    const qs = baseUrl ? `?baseUrl=${encodeURIComponent(baseUrl)}` : ''
    const res = await fetch(`/api/market-data/hub-status${qs}`, { headers })
    return res.json()
  },
}
