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
}
