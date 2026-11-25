import { headers } from './client'
import type { AppConfig, Profile, Preset, Credential, SdkAdapterInfo, WireShape } from './types'

export interface AiSpendStatus {
  day: string
  ceilingCents: number
  mode: 'block' | 'alert'
  spentCents: number
  reservedCents: number
  hitAt: string | null
  level: 'none' | 'approaching' | 'over'
}

export const configApi = {
  async getAiSpend(): Promise<AiSpendStatus> {
    const res = await fetch('/api/config/ai-spend')
    if (!res.ok) throw new Error('Failed to load AI spend')
    return res.json()
  },

  async updateAiSpend(input: { ceilingDollars?: number; mode?: 'block' | 'alert' }): Promise<AiSpendStatus> {
    const res = await fetch('/api/config/ai-spend', { method: 'PUT', headers, body: JSON.stringify(input) })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(body.error || 'Save failed')
    return body
  },

  async load(): Promise<AppConfig> {
    const res = await fetch('/api/config')
    if (!res.ok) throw new Error('Failed to load config')
    return res.json()
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

  // ==================== Presets ====================

  async getPresets(): Promise<{ presets: Preset[] }> {
    const res = await fetch('/api/config/presets')
    if (!res.ok) throw new Error('Failed to load presets')
    return res.json()
  },

  // ==================== Credential Vault ====================

  async getCredentials(): Promise<{ credentials: CredentialSummary[] }> {
    const res = await fetch('/api/config/credentials')
    if (!res.ok) throw new Error('Failed to load credentials')
    return res.json()
  },

  async addCredential(input: { vendor: string; wires: Partial<Record<WireShape, string>>; apiKey: string }): Promise<{ slug: string; vendor: string }> {
    const res = await fetch('/api/config/credentials', { method: 'POST', headers, body: JSON.stringify(input) })
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Failed to add credential' }))
      throw new Error(err.error || 'Failed to add credential')
    }
    return res.json()
  },

  async updateCredential(slug: string, input: { vendor: string; wires: Partial<Record<WireShape, string>>; apiKey?: string }): Promise<void> {
    const res = await fetch(`/api/config/credentials/${encodeURIComponent(slug)}`, { method: 'PUT', headers, body: JSON.stringify(input) })
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Failed to update credential' }))
      throw new Error(err.error || 'Failed to update credential')
    }
  },

  async deleteCredential(slug: string): Promise<void> {
    const res = await fetch(`/api/config/credentials/${encodeURIComponent(slug)}`, { method: 'DELETE' })
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Failed to delete credential' }))
      throw new Error(err.error || 'Failed to delete credential')
    }
  },

  async testCredential(input: {
    wireShape: WireShape
    baseUrl?: string
    apiKey: string
    model: string
    authMode?: 'x-api-key' | 'bearer'
  }): Promise<{ ok: boolean; response?: string; error?: string }> {
    const res = await fetch('/api/config/credentials/test', { method: 'POST', headers, body: JSON.stringify(input) })
    return res.json()
  },

}

/** A central credential as the vault lists it. */
export interface CredentialSummary {
  slug: string
  vendor: string
  authType: 'api-key' | 'subscription'
  /** Wire capabilities: each shape this key speaks → its endpoint baseUrl. */
  wires: Partial<Record<WireShape, string>>
  /** The stored key (admin-gated; lets the edit form round-trip it). */
  apiKey: string | null
  hasApiKey: boolean
}
