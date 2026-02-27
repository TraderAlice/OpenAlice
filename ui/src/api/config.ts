import { headers } from './client'
import type { AppConfig } from './types'

export const configApi = {
  async load(): Promise<AppConfig> {
    const res = await fetch('/api/config')
    if (!res.ok) throw new Error('Failed to load config')
    return res.json()
  },

  async setBackend(backend: string): Promise<void> {
    const res = await fetch('/api/config/ai-provider', {
      method: 'PUT',
      headers,
      body: JSON.stringify({ backend }),
    })
    if (!res.ok) throw new Error('Failed to switch backend')
  },

  async updateSection(section: string, data: unknown): Promise<unknown> {
    const res = await fetch(`/api/config/${section}`, {
      method: 'PUT',
      headers,
      body: JSON.stringify(data),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Save failed' }))
      throw new Error(err.error || 'Save failed')
    }
    return res.json()
  },
}
