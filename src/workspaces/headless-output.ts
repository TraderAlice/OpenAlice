/** Vendor-neutral structured output for one-shot agent runs. */

export type HeadlessOutputEvent =
  | { readonly type: 'text'; readonly text: string }
  | { readonly type: 'tool-start'; readonly id: string; readonly name: string; readonly input?: unknown }
  | {
      readonly type: 'tool-finish'
      readonly id: string
      readonly name?: string
      readonly output?: unknown
      readonly isError?: boolean
    }
  | { readonly type: 'error'; readonly message: string }

export type HeadlessToolStatus = 'running' | 'completed' | 'failed'

export type HeadlessMessageBlock =
  | { readonly type: 'text'; readonly text: string }
  | {
      readonly type: 'tool'
      readonly id: string
      readonly name: string
      readonly status: HeadlessToolStatus
      readonly input?: unknown
      readonly output?: unknown
    }
  | { readonly type: 'error'; readonly message: string }

export interface HeadlessStructuredOutput {
  readonly schemaVersion: 1
  readonly assistantText: string | null
  readonly blocks: readonly HeadlessMessageBlock[]
  readonly metrics: {
    readonly textBlocks: number
    readonly toolCalls: number
    readonly toolFailures: number
  }
  /** True when the source log or normalized block budget was truncated. */
  readonly truncated: boolean
}

const MAX_BLOCKS = 300
const MAX_TEXT_CHARS = 64 * 1024
const MAX_TOOL_VALUE_CHARS = 8 * 1024

function clipText(value: string, max = MAX_TEXT_CHARS): string {
  return value.length <= max ? value : `${value.slice(0, max)}\n… (truncated)`
}

function boundedValue(value: unknown): unknown {
  if (value === undefined) return undefined
  if (typeof value === 'string') return clipText(value, MAX_TOOL_VALUE_CHARS)
  try {
    const json = JSON.stringify(value)
    if (json.length <= MAX_TOOL_VALUE_CHARS) return value
    return `${json.slice(0, MAX_TOOL_VALUE_CHARS)}… (truncated)`
  } catch {
    return clipText(String(value), MAX_TOOL_VALUE_CHARS)
  }
}

/** Pairs tool start/end events and keeps one final assistant reply projection. */
export class HeadlessOutputAccumulator {
  private readonly blocks: HeadlessMessageBlock[] = []
  private readonly toolIndexes = new Map<string, number>()
  private assistantText: string | null = null
  private sourceTruncated = false
  private blockTruncated = false

  add(events: readonly HeadlessOutputEvent[]): void {
    for (const event of events) {
      if (event.type === 'text') {
        const text = clipText(event.text.trim())
        if (!text) continue
        this.assistantText = text
        const previous = this.blocks[this.blocks.length - 1]
        if (previous?.type === 'text' && previous.text === text) continue
        this.push({ type: 'text', text })
        continue
      }

      if (event.type === 'error') {
        const message = clipText(event.message.trim(), MAX_TOOL_VALUE_CHARS)
        const previous = this.blocks[this.blocks.length - 1]
        if (message && !(previous?.type === 'error' && previous.message === message)) {
          this.push({ type: 'error', message })
        }
        continue
      }

      if (event.type === 'tool-start') {
        const index = this.toolIndexes.get(event.id)
        const next: Extract<HeadlessMessageBlock, { type: 'tool' }> = {
          type: 'tool',
          id: event.id,
          name: event.name || 'Tool',
          status: 'running',
          ...(event.input !== undefined ? { input: boundedValue(event.input) } : {}),
        }
        if (index === undefined) {
          if (this.push(next)) this.toolIndexes.set(event.id, this.blocks.length - 1)
        } else {
          const current = this.blocks[index]
          this.blocks[index] = current?.type === 'tool' ? { ...current, ...next } : next
        }
        continue
      }

      const index = this.toolIndexes.get(event.id)
      const current = index === undefined ? null : this.blocks[index]
      const finished: Extract<HeadlessMessageBlock, { type: 'tool' }> = {
        type: 'tool',
        id: event.id,
        name: event.name || (current?.type === 'tool' ? current.name : 'Tool'),
        status: event.isError ? 'failed' : 'completed',
        ...(current?.type === 'tool' && current.input !== undefined ? { input: current.input } : {}),
        ...(event.output !== undefined ? { output: boundedValue(event.output) } : {}),
      }
      if (index === undefined) {
        if (this.push(finished)) this.toolIndexes.set(event.id, this.blocks.length - 1)
      } else {
        this.blocks[index] = finished
      }
    }
  }

  /** Adapter text decoders remain a compatibility/final-result fallback. */
  setAssistantText(text: string): void {
    const normalized = clipText(text.trim())
    if (normalized) this.assistantText = normalized
  }

  markSourceTruncated(): void {
    this.sourceTruncated = true
  }

  snapshot(runStillActive = false): HeadlessStructuredOutput {
    const blocks = this.blocks.map((block) => {
      if (block.type !== 'tool' || block.status !== 'running' || runStillActive) return block
      return { ...block, status: 'failed' as const }
    })
    const tools = blocks.filter(
      (block): block is Extract<HeadlessMessageBlock, { type: 'tool' }> => block.type === 'tool',
    )
    return {
      schemaVersion: 1,
      assistantText: this.assistantText,
      blocks,
      metrics: {
        textBlocks: blocks.reduce((count, block) => count + (block.type === 'text' ? 1 : 0), 0),
        toolCalls: tools.length,
        toolFailures: tools.reduce((count, block) => count + (block.status === 'failed' ? 1 : 0), 0),
      },
      truncated: this.sourceTruncated || this.blockTruncated,
    }
  }

  private push(block: HeadlessMessageBlock): boolean {
    if (this.blocks.length >= MAX_BLOCKS) {
      this.blockTruncated = true
      return false
    }
    this.blocks.push(block)
    return true
  }
}

export function parseHeadlessOutputText(opts: {
  readonly text: string
  readonly extractEvents?: (line: string) => readonly HeadlessOutputEvent[]
  readonly extractAssistantText?: (line: string) => string | null
  readonly sourceTruncated?: boolean
  readonly runStillActive?: boolean
}): HeadlessStructuredOutput {
  const accumulator = new HeadlessOutputAccumulator()
  if (opts.sourceTruncated) accumulator.markSourceTruncated()
  for (const raw of opts.text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) continue
    accumulator.add(opts.extractEvents?.(line) ?? [])
    const assistant = opts.extractAssistantText?.(line)?.trim()
    if (assistant) accumulator.setAssistantText(assistant)
  }
  return accumulator.snapshot(opts.runStillActive ?? false)
}
