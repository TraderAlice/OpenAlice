import { headers } from './client'

export const openbbApi = {
  async testProvider(provider: string, key: string): Promise<{ ok: boolean; error?: string }> {
    const res = await fetch('/api/openbb/test-provider', {
      method: 'POST',
      headers,
      body: JSON.stringify({ provider, key }),
    })
    return res.json()
  },
}
