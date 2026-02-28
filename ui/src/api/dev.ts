export interface RegistryConnector {
  channel: string
  to: string
  capabilities: { push: boolean; media: boolean }
}

export interface RegistryResponse {
  connectors: RegistryConnector[]
  lastInteraction: { channel: string; to: string; ts: number } | null
}

export interface SendRequest {
  channel?: string
  kind?: 'message' | 'notification'
  text: string
  source?: 'heartbeat' | 'cron' | 'manual'
}

export interface SendResponse {
  channel: string
  to: string
  delivered: boolean
}

export interface SessionInfo {
  id: string
  sizeBytes: number
}

export const devApi = {
  async registry(): Promise<RegistryResponse> {
    const res = await fetch('/api/dev/registry')
    if (!res.ok) throw new Error('Failed to fetch registry')
    return res.json()
  },

  async send(req: SendRequest): Promise<SendResponse> {
    const res = await fetch('/api/dev/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Unknown error' }))
      throw new Error(err.error ?? `HTTP ${res.status}`)
    }
    return res.json()
  },

  async sessions(): Promise<SessionInfo[]> {
    const res = await fetch('/api/dev/sessions')
    if (!res.ok) throw new Error('Failed to fetch sessions')
    const data = await res.json()
    return data.sessions
  },
}
