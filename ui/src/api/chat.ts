import { headers } from './client'
import type { ChatHistoryItem } from './types'

// ==================== Stream event types ====================

export type ChatStreamEvent =
  | { type: 'stream'; event: { type: 'tool_use'; id: string; name: string; input: unknown } }
  | { type: 'stream'; event: { type: 'tool_result'; tool_use_id: string; content: string } }
  | { type: 'stream'; event: { type: 'text'; text: string } }
  | { type: 'done'; text: string; media: Array<{ type: string; url: string }> }

// ==================== API ====================

export const chatApi = {
  /**
   * Send a chat message and stream back events (SSE over POST).
   * Yields tool_use, tool_result, text events as they arrive,
   * then a final done event with the complete result.
   */
  async *sendStreaming(
    message: string,
    channelId?: string,
    signal?: AbortSignal,
  ): AsyncGenerator<ChatStreamEvent> {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers,
      body: JSON.stringify({ message, ...(channelId ? { channelId } : {}) }),
      signal,
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }))
      throw new Error(err.error || res.statusText)
    }

    // Parse SSE format from streaming POST response
    const reader = res.body!.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })

      // SSE blocks are separated by \n\n
      let idx: number
      while ((idx = buffer.indexOf('\n\n')) !== -1) {
        const block = buffer.slice(0, idx)
        buffer = buffer.slice(idx + 2)

        // Extract data: lines from SSE block
        const dataLines = block.split('\n')
          .filter(l => l.startsWith('data:'))
          .map(l => l.slice(5).trim())

        if (dataLines.length > 0) {
          try {
            yield JSON.parse(dataLines.join('\n')) as ChatStreamEvent
          } catch { /* ignore malformed events */ }
        }
      }
    }
  },

  async history(
    limit = 100,
    channel?: string,
    before?: string,
  ): Promise<{ messages: ChatHistoryItem[]; hasMore: boolean }> {
    const params = new URLSearchParams({ limit: String(limit) })
    if (channel) params.set('channel', channel)
    if (before) params.set('before', before)
    const res = await fetch(`/api/chat/history?${params}`)
    if (!res.ok) throw new Error('Failed to load history')
    return res.json()
  },

  connectSSE(
    onMessage: (data: { type: string; kind?: string; text: string; media?: Array<{ type: string; url: string }> }) => void,
    channel?: string,
  ): EventSource {
    const url = channel ? `/api/chat/events?channel=${encodeURIComponent(channel)}` : '/api/chat/events'
    const es = new EventSource(url)
    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data)
        onMessage(data)
      } catch { /* ignore */ }
    }
    return es
  },
}
