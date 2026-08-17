/**
 * Project headless structured blocks onto occupancy-journal turn events.
 * Tool input/output stay out: they are noisy and can carry paths. TUI has
 * no equivalent extractor yet, so only the headless translator feeds this.
 */
import {
  projectTurnProgress,
  type HeadlessProgressBlock,
} from './headless-progress.js'
import type { HeadlessStructuredOutput } from './headless-output.js'
import type {
  AgentRuntimeEventType,
  AgentRuntimePayload,
  AgentRuntimeSubject,
  AgentRuntimeTurnMetrics,
} from './agent-runtime-log.js'

export interface HeadlessTurnJournalEvent {
  readonly type: Extract<
    AgentRuntimeEventType,
    'runtime.turn.text' | 'runtime.turn.tool' | 'runtime.turn.error'
  >
  readonly payload: AgentRuntimePayload
}

function blockKey(block: HeadlessProgressBlock): string {
  if (block.type === 'tool') return `tool:${block.id}:${block.status}`
  if (block.type === 'text') return `text:${block.text}`
  return `error:${block.message}`
}

export function diffHeadlessTurnEvents(
  subject: AgentRuntimeSubject,
  previous: readonly HeadlessProgressBlock[],
  next: readonly HeadlessProgressBlock[],
): HeadlessTurnJournalEvent[] {
  const seen = new Set(previous.map(blockKey))
  const out: HeadlessTurnJournalEvent[] = []
  for (const block of next) {
    const key = blockKey(block)
    if (seen.has(key)) continue
    seen.add(key)
    if (block.type === 'text') {
      out.push({ type: 'runtime.turn.text', payload: { ...subject, text: block.text } })
      continue
    }
    if (block.type === 'error') {
      out.push({ type: 'runtime.turn.error', payload: { ...subject, message: block.message } })
      continue
    }
    out.push({
      type: 'runtime.turn.tool',
      payload: {
        ...subject,
        toolId: block.id,
        toolName: block.name,
        toolStatus: block.status,
      },
    })
  }
  return out
}

export function headlessCompletionAssets(structured: HeadlessStructuredOutput): {
  readonly assistantText?: string
  readonly metrics: AgentRuntimeTurnMetrics
  readonly truncated: boolean
} {
  const progress = projectTurnProgress(structured)
  return {
    ...(progress.assistantText ? { assistantText: progress.assistantText } : {}),
    metrics: progress.metrics,
    truncated: structured.truncated,
  }
}

export function createHeadlessTurnJournal(opts: {
  readonly subject: AgentRuntimeSubject
  readonly record: (
    type: AgentRuntimeEventType,
    payload: AgentRuntimePayload,
  ) => Promise<unknown>
}): {
  offer(snapshot: HeadlessStructuredOutput): void
  flush(): Promise<void>
} {
  let previous: HeadlessProgressBlock[] = []
  let lastAssistant: string | null = null
  let chain = Promise.resolve()

  const enqueue = (events: readonly HeadlessTurnJournalEvent[]) => {
    for (const event of events) {
      chain = chain.then(async () => {
        await opts.record(event.type, event.payload)
      })
    }
  }

  return {
    offer(snapshot) {
      const progress = projectTurnProgress(snapshot)
      const events = diffHeadlessTurnEvents(opts.subject, previous, progress.blocks)
      previous = [...progress.blocks]
      if (
        progress.assistantText
        && progress.assistantText !== lastAssistant
        && !events.some((event) => event.type === 'runtime.turn.text')
      ) {
        events.push({
          type: 'runtime.turn.text',
          payload: { ...opts.subject, text: progress.assistantText },
        })
      }
      if (progress.assistantText) lastAssistant = progress.assistantText
      enqueue(events)
    },
    async flush() {
      await chain
    },
  }
}
