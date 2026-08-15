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
export const MAX_PROGRESS_PAYLOAD_BYTES = 32 * 1_024
const MAX_PROGRESS_ASSISTANT_BYTES = 4 * 1_024
const MAX_PROGRESS_TEXT_BYTES = 4 * 1_024
const MAX_PROGRESS_ERROR_BYTES = 1 * 1_024
const MAX_PROGRESS_LABEL_BYTES = 256
const CLIPPED_SUFFIX = '…'

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

function clipUtf8(value: string, maxBytes: number): string {
  const encoded = Buffer.from(value, 'utf8')
  if (encoded.byteLength <= maxBytes) return value
  const suffix = Buffer.from(CLIPPED_SUFFIX, 'utf8')
  const budget = Math.max(0, maxBytes - suffix.byteLength)
  let end = budget
  while (end > 0 && (encoded[end] & 0xc0) === 0x80) end -= 1
  return `${encoded.subarray(0, end).toString('utf8')}${CLIPPED_SUFFIX}`
}

export function projectTurnProgress(
  structured: HeadlessStructuredOutput,
  now = Date.now(),
): HeadlessTurnProgress {
  const blocks = structured.blocks.flatMap((block): HeadlessProgressBlock[] => {
    if (block.type === 'text') return [{ type: 'text', text: clipUtf8(block.text, MAX_PROGRESS_TEXT_BYTES) }]
    if (block.type === 'error') return [{ type: 'error', message: clipUtf8(block.message, MAX_PROGRESS_ERROR_BYTES) }]
    return [{
      type: 'tool',
      id: clipUtf8(block.id, MAX_PROGRESS_LABEL_BYTES),
      name: clipUtf8(block.name, MAX_PROGRESS_LABEL_BYTES),
      status: block.status,
    }]
  })
  const blockLimited = blocks.length <= MAX_PROGRESS_BLOCKS
    ? blocks
    : blocks.slice(blocks.length - MAX_PROGRESS_BLOCKS)
  let payloadBlocks = blockLimited
  const buildProgress = (): HeadlessTurnProgress => ({
    updatedAt: now,
    assistantText: structured.assistantText === null
      ? null
      : clipUtf8(structured.assistantText, MAX_PROGRESS_ASSISTANT_BYTES),
    blocks: payloadBlocks,
    metrics: structured.metrics,
  })
  // The block count alone is not a storage bound: normalized text blocks can
  // each be large. Prefer the newest activity and keep the exact persisted
  // snapshot below one explicit UTF-8 budget.
  while (
    payloadBlocks.length > 0
    && Buffer.byteLength(JSON.stringify(buildProgress()), 'utf8') > MAX_PROGRESS_PAYLOAD_BYTES
  ) {
    payloadBlocks = payloadBlocks.slice(1)
  }
  return buildProgress()
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
  let started = false
  let queuedFingerprint: string | null = null
  let timer: NodeJS.Timeout | null = null
  let chain = Promise.resolve()

  const enqueue = (progress: HeadlessTurnProgress) => {
    const fingerprint = progressFingerprint(progress)
    if (fingerprint === queuedFingerprint) return
    queuedFingerprint = fingerprint
    // Invoke the publisher inside the chain. Calling it before `then()` makes
    // asynchronous registry/comment writes overlap even though their returned
    // promises are nominally chained.
    chain = chain.then(async () => {
      try {
        await opts.publish(progress)
      } catch {
        if (queuedFingerprint === fingerprint) queuedFingerprint = null
        /* publisher errors must not break the runner */
      }
    })
  }

  return {
    offer(progress) {
      latest = progress
      if (!started) {
        started = true
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
