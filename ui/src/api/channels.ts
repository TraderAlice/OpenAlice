import { headers } from './client'
import type { WebChannel, VercelAiSdkOverride, AgentSdkOverride } from './types'

export interface ChannelListItem {
  id: string
  label: string
  systemPrompt?: string
  provider?: 'claude-code' | 'vercel-ai-sdk' | 'agent-sdk'
  vercelAiSdk?: VercelAiSdkOverride
  agentSdk?: AgentSdkOverride
  disabledTools?: string[]
}

export const channelsApi = {
  async list(): Promise<{ channels: ChannelListItem[] }> {
    const res = await fetch('/api/channels')
    if (!res.ok) throw new Error('Failed to load channels')
    return res.json()
  },

  async create(data: Omit<WebChannel, 'id'> & { id: string }): Promise<{ channel: ChannelListItem }> {
    const res = await fetch('/api/channels', {
      method: 'POST',
      headers,
      body: JSON.stringify(data),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }))
      throw new Error(err.error || res.statusText)
    }
    return res.json()
  },

  async update(id: string, data: Partial<Omit<WebChannel, 'id'>>): Promise<{ channel: ChannelListItem }> {
    const res = await fetch(`/api/channels/${encodeURIComponent(id)}`, {
      method: 'PUT',
      headers,
      body: JSON.stringify(data),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }))
      throw new Error(err.error || res.statusText)
    }
    return res.json()
  },

  async remove(id: string): Promise<void> {
    const res = await fetch(`/api/channels/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers,
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }))
      throw new Error(err.error || res.statusText)
    }
  },
}
