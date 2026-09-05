import type { ConversationContent, ConversationItem } from '../conversation/types'
import { contentText, groupWebPiTranscript, summarizeToolInput } from './webpi-transcript'

/** Pi's wire content is interpreted here, never by the shared renderer. */
export function piContent(value: unknown): ConversationContent {
  if (typeof value === 'string') return [{ kind: 'markdown', text: value }]
  if (!Array.isArray(value)) {
    const item = record(value)
    return typeof item?.text === 'string'
      ? [{ kind: 'markdown', text: item.text }]
      : [{ kind: 'data', text: json(value) }]
  }
  return value.flatMap((part): ConversationContent => {
    const item = record(part)
    if (item?.type === 'text' && typeof item.text === 'string') return [{ kind: 'markdown', text: item.text }]
    if (item?.type === 'thinking') return [{ kind: 'disclosure', label: 'Thinking', content: [{ kind: 'markdown', text: String(item.thinking ?? item.text ?? '') }] }]
    if (item?.type === 'toolCall') return [{ kind: 'disclosure', label: `Used ${String(item.name ?? 'tool')}`, content: [{ kind: 'data', text: json(item.arguments ?? {}) }] }]
    return [{ kind: 'data', text: json(part) }]
  })
}

export function presentPiTranscript(messages: readonly unknown[]): ConversationItem[] {
  return groupWebPiTranscript(messages).map((item): ConversationItem => {
    if (item.kind === 'user') return { ...item, content: piContent(item.content) }
    if (item.kind === 'unknown') return { kind: 'unknown', key: item.key, content: [{ kind: 'data', text: json(item.value) }] }
    return {
      ...item,
      activity: item.activity && {
        ...item.activity,
        unknownParts: item.activity.unknownParts.map(json),
        steps: item.activity.steps.map((step) => ({
          ...step,
          summary: summarizeToolInput(step.name, step.input),
          input: json(step.input),
          result: step.result === undefined ? undefined : piContent(step.result),
          resultChars: step.result === undefined ? undefined : contentText(step.result).length,
        })),
      },
    }
  })
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function json(value: unknown): string { return JSON.stringify(value, null, 2) ?? '' }
