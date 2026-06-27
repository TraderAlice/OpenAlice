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

  // ============ Default Workspace Credentials (per-agent) ============

  async getWorkspaceCredentialDefaults(): Promise<WorkspaceCredentialDefaultsResponse> {
    const res = await fetch('/api/config/workspace-credential-defaults')
    if (!res.ok) throw new Error('Failed to load workspace credential defaults')
    return res.json()
  },

  async setWorkspaceCredentialDefaults(
    defaults: Record<string, WorkspaceCredentialDefault>,
  ): Promise<{ defaults: Record<string, WorkspaceCredentialDefault> }> {
    const res = await fetch('/api/config/workspace-credential-defaults', {
      method: 'PUT', headers, body: JSON.stringify({ defaults }),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Failed to save defaults' }))
      throw new Error(err.error || 'Failed to save defaults')
    }
    return res.json()
  },

}

/** A per-agent default credential seeded into new workspaces. */
export interface WorkspaceCredentialDefault {
  credentialSlug: string
  model?: string
}

/** GET /workspace-credential-defaults — current defaults + per-agent picker options. */
export interface WorkspaceCredentialDefaultsResponse {
  /** agentId → default cred. Absent agent = no default seeded. */
  defaults: Record<string, WorkspaceCredentialDefault>
  /** agentId → vault slugs the agent can actually be driven by (wire funnel). */
  compatibleByAgent: Record<string, string[]>
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
