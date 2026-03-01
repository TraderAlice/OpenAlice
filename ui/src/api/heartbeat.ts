import { headers } from './client'

export const heartbeatApi = {
  async status(): Promise<{ enabled: boolean }> {
    const res = await fetch('/api/heartbeat/status')
    if (!res.ok) throw new Error('Failed to get heartbeat status')
    return res.json()
  },

  async trigger(): Promise<void> {
    const res = await fetch('/api/heartbeat/trigger', { method: 'POST' })
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Trigger failed' }))
      throw new Error(err.error || 'Trigger failed')
    }
  },

  async setEnabled(enabled: boolean): Promise<{ enabled: boolean }> {
    const res = await fetch('/api/heartbeat/enabled', {
      method: 'PUT',
      headers,
      body: JSON.stringify({ enabled }),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Update failed' }))
      throw new Error(err.error || 'Update failed')
    }
    return res.json()
  },

  async getPromptFile(): Promise<{ content: string; path: string }> {
    const res = await fetch('/api/heartbeat/prompt-file')
    if (!res.ok) throw new Error('Failed to load prompt file')
    return res.json()
  },

  async updatePromptFile(content: string): Promise<void> {
    const res = await fetch('/api/heartbeat/prompt-file', {
      method: 'PUT',
      headers,
      body: JSON.stringify({ content }),
    })
    if (!res.ok) throw new Error('Failed to save prompt file')
  },
}
