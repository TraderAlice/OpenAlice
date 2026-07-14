import { headers } from './client'

export interface HubStatus {
  enabled: boolean
  baseUrl: string
  reachable: boolean
}

export interface MarketVendorInfo {
  id: string
  name: string
  enabled: boolean
  alwaysOn: boolean
  keyless: boolean
  coverage: string
  howToUse: string
  website?: string
}

export const marketDataApi = {
  async vendors(): Promise<{ vendors: MarketVendorInfo[] }> {
    const res = await fetch('/api/market-data/vendors', { headers })
    if (!res.ok) throw new Error('Failed to load market vendors')
    return res.json()
  },

  async testProvider(provider: string, key: string): Promise<{ ok: boolean; error?: string }> {
    const res = await fetch('/api/market-data/test-provider', {
      method: 'POST',
      headers,
      body: JSON.stringify({ provider, key }),
    })
    return res.json()
  },

  async hubStatus(baseUrl?: string): Promise<HubStatus> {
    const qs = baseUrl ? `?baseUrl=${encodeURIComponent(baseUrl)}` : ''
    const res = await fetch(`/api/market-data/hub-status${qs}`, { headers })
    return res.json()
  },
}
