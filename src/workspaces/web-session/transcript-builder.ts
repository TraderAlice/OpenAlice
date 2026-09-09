import type { WebContentPart, WebConversationMessage } from './model.js'
import type { WebSessionState } from './transport.js'

/**
 * Turns an event stream (deltas, tool starts, tool results) into the neutral
 * message list. Protocols that expose a canonical message list (Pi RPC) do not
 * need this; ACP, Claude stream-json, and Codex app-server all stream.
 *
 * The in-flight assistant message lives in `state.streamingMessage`. A tool
 * result closes it (matching how Pi persists assistant/toolResult hops), and
 * later text opens a fresh one so the browser groups the whole exchange into a
 * single turn.
 */
export class TranscriptBuilder {
  private readonly toolNames = new Map<string, string>()
  private readonly openToolCalls = new Set<string>()

  constructor(private readonly state: WebSessionState) {}

  user(content: string | readonly WebContentPart[]): void {
    this.state.commitStreaming()
    this.state.append({ role: 'user', content, timestamp: Date.now() })
  }

  text(delta: string): void {
    if (!delta) return
    const parts = [...this.streamingParts()]
    const last = parts[parts.length - 1]
    if (last?.type === 'text') parts[parts.length - 1] = { type: 'text', text: last.text + delta }
    else parts.push({ type: 'text', text: delta })
    this.setParts(parts)
  }

  /** Replace the accumulated text with a full snapshot (cumulative protocols). */
  textSnapshot(text: string): void {
    const parts: WebContentPart[] = this.streamingParts().filter((part) => part.type !== 'text')
    if (text) parts.push({ type: 'text', text })
    this.setParts(parts)
  }

  thinking(delta: string): void {
    if (!delta) return
    const parts = [...this.streamingParts()]
    const last = parts[parts.length - 1]
    if (last?.type === 'thinking') parts[parts.length - 1] = { type: 'thinking', thinking: last.thinking + delta }
    else parts.push({ type: 'thinking', thinking: delta })
    this.setParts(parts)
  }

  toolCall(id: string, name: string, args: unknown): void {
    this.toolNames.set(id, name)
    this.openToolCalls.add(id)
    const parts = this.streamingParts().filter((part) => !(part.type === 'toolCall' && part.id === id))
    parts.push({ type: 'toolCall', id, name, arguments: args })
    this.setParts(parts)
  }

  /** Record a call that the caller already rendered into the streaming message. */
  trackToolCall(id: string, name: string): void {
    this.toolNames.set(id, name)
    this.openToolCalls.add(id)
  }

  /** Update an in-flight call whose name or input arrived after it started. */
  toolCallUpdate(id: string, update: { name?: string; args?: unknown }): void {
    if (!this.openToolCalls.has(id)) {
      this.toolCall(id, update.name ?? this.toolNames.get(id) ?? 'tool', update.args ?? {})
      return
    }
    if (update.name) this.toolNames.set(id, update.name)
    const parts = this.streamingParts().map((part): WebContentPart => (
      part.type === 'toolCall' && part.id === id
        ? { type: 'toolCall', id, name: update.name ?? part.name, arguments: update.args ?? part.arguments }
        : part
    ))
    this.setParts(parts)
  }

  toolResult(id: string, content: string | readonly WebContentPart[], isError: boolean, name?: string): void {
    const toolName = name ?? this.toolNames.get(id) ?? 'tool'
    if (!this.openToolCalls.has(id)) this.toolCall(id, toolName, {})
    this.openToolCalls.delete(id)
    this.state.commitStreaming()
    this.state.append({ role: 'toolResult', toolCallId: id, toolName, content, isError, timestamp: Date.now() })
  }

  notice(text: string): void {
    this.state.commitStreaming()
    this.state.append({ role: 'notice', text, timestamp: Date.now() })
  }

  hasOpenToolCall(id: string): boolean {
    return this.openToolCalls.has(id)
  }

  toolName(id: string): string | null {
    return this.toolNames.get(id) ?? null
  }

  endTurn(): void {
    // Calls that never reported a result are closed as failed so the browser
    // does not show a spinner forever after an interrupted turn.
    for (const id of [...this.openToolCalls]) {
      this.toolResult(id, 'No result: the turn ended before this call finished.', true)
    }
    this.state.commitStreaming()
  }

  private streamingParts(): readonly WebContentPart[] {
    const streaming = this.state.streamingMessage
    return streaming?.role === 'assistant' ? streaming.content : []
  }

  private setParts(parts: readonly WebContentPart[]): void {
    this.state.setStreaming({ role: 'assistant', content: parts, timestamp: Date.now() })
  }
}

export function partsFromUnknownContent(value: unknown): readonly WebContentPart[] | string {
  if (typeof value === 'string') return value
  if (!Array.isArray(value)) return [{ type: 'data', value }]
  return value.map((entry): WebContentPart => {
    if (typeof entry === 'string') return { type: 'text', text: entry }
    if (entry && typeof entry === 'object') {
      const record = entry as Record<string, unknown>
      if (typeof record['text'] === 'string' && (record['type'] === 'text' || record['type'] === undefined)) {
        return { type: 'text', text: record['text'] }
      }
    }
    return { type: 'data', value: entry }
  })
}
