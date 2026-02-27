import { headers } from './client'

export const apiKeysApi = {
  async status(): Promise<Record<string, boolean>> {
    const res = await fetch('/api/config/api-keys/status')
    if (!res.ok) throw new Error('Failed to load API key status')
    return res.json()
  },

  async save(keys: Record<string, string>): Promise<void> {
    const res = await fetch('/api/config/apiKeys', {
      method: 'PUT',
      headers,
      body: JSON.stringify(keys),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Save failed' }))
      throw new Error(err.error || 'Save failed')
    }
  },
}
