export interface WebPiToolStep {
  readonly id: string
  readonly name: string
  readonly input: unknown
  readonly result?: unknown
  readonly thinking: readonly string[]
  readonly status: 'running' | 'succeeded' | 'failed'
}

export interface WebPiActivity {
  readonly steps: readonly WebPiToolStep[]
  readonly thinking: readonly string[]
  readonly unknownParts: readonly unknown[]
}

export type WebPiTranscriptItem =
  | {
      readonly kind: 'user'
      readonly key: string
      readonly content: unknown
    }
  | {
      readonly kind: 'assistant-turn'
      readonly key: string
      readonly progress: readonly string[]
      readonly final: string | null
      readonly activity: WebPiActivity | null
    }
  | {
      readonly kind: 'unknown'
      readonly key: string
      readonly value: unknown
    }

interface MutableTurn {
  readonly startIndex: number
  readonly messages: Array<{ value: unknown; index: number }>
}

interface ToolResultRecord {
  readonly value: Record<string, unknown>
}

/**
 * Pi persists each assistant/tool-result hop as a native message. The browser
 * should present those records as one conversational turn without replacing
 * Pi's schema or losing the raw audit trail.
 */
export function groupWebPiTranscript(messages: readonly unknown[]): WebPiTranscriptItem[] {
  const items: WebPiTranscriptItem[] = []
  let turn: MutableTurn | null = null

  const flushTurn = (): void => {
    if (!turn) return
    items.push(buildAssistantTurn(turn))
    turn = null
  }

  messages.forEach((value, index) => {
    const record = asRecord(value)
    const role = typeof record?.['role'] === 'string' ? record['role'] : null
    if (role === 'user') {
      flushTurn()
      items.push({
        kind: 'user',
        key: messageKey(value, index),
        content: record?.['content'] ?? value,
      })
      return
    }
    if (role === 'assistant' || role === 'toolResult' || role === 'tool') {
      turn ??= { startIndex: index, messages: [] }
      turn.messages.push({ value, index })
      return
    }
    flushTurn()
    items.push({ kind: 'unknown', key: messageKey(value, index), value })
  })
  flushTurn()
  return items
}

export function summarizeToolInput(_name: string, input: unknown): string | null {
  const record = asRecord(input)
  if (!record) return primitiveSummary(input)
  const path = firstString(record, ['path', 'file', 'filePath', 'target'])
  if (path) return truncateLine(path, 84)
  const command = firstString(record, ['command', 'cmd'])
  if (command) return truncateLine(command, 84)
  const query = firstString(record, ['query', 'q', 'pattern'])
  if (query) return truncateLine(query, 84)
  const fallback = Object.entries(record).find(([key, value]) => (
    key !== 'content' && ['string', 'number', 'boolean'].includes(typeof value)
  ))
  return fallback ? truncateLine(String(fallback[1]), 84) : null
}

export function activityToolLabel(steps: readonly WebPiToolStep[]): string {
  const counts = new Map<string, number>()
  for (const step of steps) counts.set(step.name, (counts.get(step.name) ?? 0) + 1)
  return [...counts].map(([name, count]) => count > 1 ? `${name} ×${count}` : name).join(' · ')
}

export function contentText(value: unknown): string {
  if (typeof value === 'string') return value
  if (!Array.isArray(value)) {
    const record = asRecord(value)
    return typeof record?.['text'] === 'string' ? record['text'] : ''
  }
  return value.flatMap((part) => {
    const item = asRecord(part)
    return typeof item?.['text'] === 'string' ? [item['text']] : []
  }).join('\n')
}

function buildAssistantTurn(turn: MutableTurn): WebPiTranscriptItem {
  const results = new Map<string, ToolResultRecord>()
  for (const message of turn.messages) {
    const record = asRecord(message.value)
    const role = typeof record?.['role'] === 'string' ? record['role'] : null
    const toolCallId = typeof record?.['toolCallId'] === 'string' ? record['toolCallId'] : null
    if ((role === 'toolResult' || role === 'tool') && toolCallId) {
      results.set(toolCallId, { value: record! })
    }
  }

  const usedResults = new Set<string>()
  const texts: string[] = []
  const steps: WebPiToolStep[] = []
  const detachedThinking: string[] = []
  const unknownParts: unknown[] = []

  for (const message of turn.messages) {
    const record = asRecord(message.value)
    if (record?.['role'] !== 'assistant') continue
    const content = record['content']
    if (!Array.isArray(content)) {
      if (typeof content === 'string' && content.trim()) texts.push(content)
      else if (content !== undefined) unknownParts.push(content)
      continue
    }

    let pendingThinking: string[] = []
    for (const part of content) {
      const item = asRecord(part)
      const type = typeof item?.['type'] === 'string' ? item['type'] : 'unknown'
      if (type === 'thinking') {
        const thinking = typeof item?.['thinking'] === 'string'
          ? item['thinking']
          : typeof item?.['text'] === 'string' ? item['text'] : ''
        if (thinking.trim()) pendingThinking.push(thinking)
        continue
      }
      if (type === 'text' && typeof item?.['text'] === 'string') {
        if (item['text'].trim()) texts.push(item['text'])
        continue
      }
      if (type === 'toolCall') {
        const id = typeof item?.['id'] === 'string'
          ? item['id']
          : typeof item?.['toolCallId'] === 'string' ? item['toolCallId'] : `tool-${message.index}-${steps.length}`
        const result = results.get(id)
        if (result) usedResults.add(id)
        steps.push({
          id,
          name: typeof item?.['name'] === 'string' ? item['name'] : 'tool',
          input: item?.['arguments'] ?? {},
          ...(result ? { result: result.value['content'] } : {}),
          thinking: pendingThinking,
          status: result?.value['isError'] === true ? 'failed' : result ? 'succeeded' : 'running',
        })
        pendingThinking = []
        continue
      }
      unknownParts.push(part)
    }
    detachedThinking.push(...pendingThinking)
  }

  for (const [id, result] of results) {
    if (usedResults.has(id)) continue
    steps.push({
      id,
      name: typeof result.value['toolName'] === 'string' ? result.value['toolName'] : 'tool',
      input: {},
      result: result.value['content'],
      thinking: [],
      status: result.value['isError'] === true ? 'failed' : 'succeeded',
    })
  }

  const final = texts.length > 0 ? texts[texts.length - 1]! : null
  const activity = steps.length > 0 || detachedThinking.length > 0 || unknownParts.length > 0
    ? { steps, thinking: detachedThinking, unknownParts }
    : null
  return {
    kind: 'assistant-turn',
    // Keep the key stable while Pi appends tool calls/results during polling.
    // Otherwise every newly-arrived step remounts the disclosure and closes it.
    key: `assistant-${turn.startIndex}`,
    progress: texts.slice(0, -1),
    final,
    activity,
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function firstString(record: Record<string, unknown>, keys: readonly string[]): string | null {
  for (const key of keys) {
    if (typeof record[key] === 'string' && record[key].trim()) return record[key]
  }
  return null
}

function primitiveSummary(value: unknown): string | null {
  return ['string', 'number', 'boolean'].includes(typeof value)
    ? truncateLine(String(value), 84)
    : null
}

function truncateLine(value: string, max: number): string {
  const line = value.replace(/\s+/g, ' ').trim()
  return line.length <= max ? line : `${line.slice(0, max - 1)}…`
}

function messageKey(value: unknown, index: number): string {
  const record = asRecord(value)
  const stable = record?.['id'] ?? record?.['toolCallId'] ?? record?.['timestamp'] ?? record?.['role'] ?? 'message'
  return `${index}-${String(stable)}`
}
