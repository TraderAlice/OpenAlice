import { headers } from './client'
import type { AppConfig, Profile, Preset, Credential, SdkAdapterInfo, WireShape } from './types'

export const configApi = {
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

  // ==================== Profile CRUD ====================

  async getPresets(): Promise<{ presets: Preset[] }> {
    const res = await fetch('/api/config/presets')
    if (!res.ok) throw new Error('Failed to load presets')
    return res.json()
  },

  async getProfiles(): Promise<{
    profiles: Record<string, Profile>
    credentials: Record<string, Credential>
    activeProfile: string
  }> {
    const res = await fetch('/api/config/profiles')
    if (!res.ok) throw new Error('Failed to load profiles')
    return res.json()
  },

  async getSdkAdapters(): Promise<{ adapters: SdkAdapterInfo[] }> {
    const res = await fetch('/api/config/sdk-adapters')
    if (!res.ok) throw new Error('Failed to load SDK adapters')
    return res.json()
  },

  async createProfile(slug: string, profile: Profile): Promise<{ slug: string; profile: Profile }> {
    const res = await fetch('/api/config/profiles', {
      method: 'POST',
      headers,
      body: JSON.stringify({ slug, profile }),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Failed to create profile' }))
      throw new Error(err.error || 'Failed to create profile')
    }
    return res.json()
  },

  async updateProfile(slug: string, profile: Profile): Promise<{ slug: string; profile: Profile }> {
    const res = await fetch(`/api/config/profiles/${encodeURIComponent(slug)}`, {
      method: 'PUT',
      headers,
      body: JSON.stringify(profile),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Failed to update profile' }))
      throw new Error(err.error || 'Failed to update profile')
    }
    return res.json()
  },

  async deleteProfile(slug: string): Promise<void> {
    const res = await fetch(`/api/config/profiles/${encodeURIComponent(slug)}`, { method: 'DELETE' })
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Failed to delete profile' }))
      throw new Error(err.error || 'Failed to delete profile')
    }
  },

  async testProfile(profileData: Profile): Promise<{ ok: boolean; response?: string; error?: string }> {
    const res = await fetch('/api/config/profiles/test', {
      method: 'POST',
      headers,
      body: JSON.stringify(profileData),
    })
    return res.json()
  },

  async setActiveProfile(slug: string): Promise<void> {
    const res = await fetch('/api/config/active-profile', {
      method: 'PUT',
      headers,
      body: JSON.stringify({ slug }),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Failed to set active profile' }))
      throw new Error(err.error || 'Failed to set active profile')
    }
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
