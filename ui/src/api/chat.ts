import { headers } from './client'
import type { ChatResponse, ChatHistoryItem } from './types'

export const chatApi = {
  async send(message: string): Promise<ChatResponse> {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers,
      body: JSON.stringify({ message }),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }))
      throw new Error(err.error || res.statusText)
    }
    return res.json()
  },

  async history(limit = 100): Promise<{ messages: ChatHistoryItem[] }> {
    const res = await fetch(`/api/chat/history?limit=${limit}`)
    if (!res.ok) throw new Error('Failed to load history')
    return res.json()
  },

  connectSSE(onMessage: (data: { type: string; kind?: string; text: string; media?: Array<{ type: string; url: string }> }) => void): EventSource {
    const es = new EventSource('/api/chat/events')
    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data)
        onMessage(data)
      } catch { /* ignore */ }
    }
    return es
  },
}
