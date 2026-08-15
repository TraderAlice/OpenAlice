/**
 * Compact live progress for one headless turn.
 *
 * The runner already accumulates vendor-neutral structured blocks. This module
 * is the only projection those blocks take before they reach comment-shaped
 * conversations (Issue replies, Inbox inquiries, later Connector). Tool
 * input/output stay out of the shape: they are noisy and can carry paths.
 */
import type { HeadlessStructuredOutput } from './headless-output.js'

export const HEADLESS_PROGRESS_DEBOUNCE_MS = 1_000
export const MAX_PROGRESS_BLOCKS = 40

export type HeadlessProgressToolStatus = 'running' | 'completed' | 'failed'

export type HeadlessProgressBlock =
  | { readonly type: 'text'; readonly text: string }
  | { readonly type: 'tool'; readonly id: string; readonly name: string; readonly status: HeadlessProgressToolStatus }
  | { readonly type: 'error'; readonly message: string }

export interface HeadlessTurnProgress {
  readonly updatedAt: number
  readonly assistantText: string | null
  readonly blocks: readonly HeadlessProgressBlock[]
  readonly metrics: {
    readonly textBlocks: number
    readonly toolCalls: number
    readonly toolFailures: number
  }
}

export function projectTurnProgress(
  structured: HeadlessStructuredOutput,
  now = Date.now(),
): HeadlessTurnProgress {
  const blocks = structured.blocks.flatMap((block): HeadlessProgressBlock[] => {
    if (block.type === 'text') return [{ type: 'text', text: block.text }]
    if (block.type === 'error') return [{ type: 'error', message: block.message }]
    return [{ type: 'tool', id: block.id, name: block.name, status: block.status }]
  })
  const trimmed = blocks.length <= MAX_PROGRESS_BLOCKS
    ? blocks
    : blocks.slice(blocks.length - MAX_PROGRESS_BLOCKS)
  return {
    updatedAt: now,
    assistantText: structured.assistantText,
    blocks: trimmed,
    metrics: structured.metrics,
  }
}

/** Equality key that ignores the wall-clock stamp. */
export function progressFingerprint(progress: HeadlessTurnProgress): string {
  return JSON.stringify({
    assistantText: progress.assistantText,
    blocks: progress.blocks,
    metrics: progress.metrics,
  })
}

export function progressChanged(
  previous: HeadlessTurnProgress | null | undefined,
  next: HeadlessTurnProgress,
): boolean {
  return !previous || progressFingerprint(previous) !== progressFingerprint(next)
}

export function createProgressPublisher(opts: {
  readonly debounceMs?: number
  readonly publish: (progress: HeadlessTurnProgress) => void | Promise<void>
}): {
  offer(progress: HeadlessTurnProgress): void
  flush(): Promise<void>
} {
  const debounceMs = opts.debounceMs ?? HEADLESS_PROGRESS_DEBOUNCE_MS
  let latest: HeadlessTurnProgress | null = null
  let published: HeadlessTurnProgress | null = null
  let timer: NodeJS.Timeout | null = null
  let chain = Promise.resolve()

  const enqueue = (progress: HeadlessTurnProgress) => {
    if (!progressChanged(published, progress)) return
    published = progress
    try {
      const result = opts.publish(progress)
      chain = chain.then(() => Promise.resolve(result)).catch(() => undefined)
    } catch {
      /* publisher errors must not break the runner */
    }
  }

  return {
    offer(progress) {
      latest = progress
      if (!published) {
        enqueue(progress)
        return
      }
      if (timer) return
      timer = setTimeout(() => {
        timer = null
        if (latest) enqueue(latest)
      }, debounceMs)
      timer.unref()
    },
    async flush() {
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
      if (latest) enqueue(latest)
      await chain
    },
  }
}
