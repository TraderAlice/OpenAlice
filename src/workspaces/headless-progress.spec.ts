import { describe, expect, it, vi } from 'vitest'

import type { HeadlessStructuredOutput } from './headless-output.js'
import {
  createProgressPublisher,
  MAX_PROGRESS_BLOCKS,
  MAX_PROGRESS_PAYLOAD_BYTES,
  progressChanged,
  progressFingerprint,
  projectTurnProgress,
} from './headless-progress.js'

function structured(
  overrides: Partial<HeadlessStructuredOutput> = {},
): HeadlessStructuredOutput {
  return {
    schemaVersion: 1,
    assistantText: 'Done.',
    blocks: [
      { type: 'text', text: 'I will check.' },
      { type: 'tool', id: 't1', name: 'Read', status: 'completed', input: { path: '/secret' }, output: 'ok' },
      { type: 'text', text: 'Done.' },
    ],
    metrics: { textBlocks: 2, toolCalls: 1, toolFailures: 0 },
    truncated: false,
    ...overrides,
  }
}

describe('projectTurnProgress', () => {
  it('keeps interleaved text and drops tool payloads', () => {
    const progress = projectTurnProgress(structured(), 42)
    expect(progress.updatedAt).toBe(42)
    expect(progress.assistantText).toBe('Done.')
    expect(progress.blocks).toEqual([
      { type: 'text', text: 'I will check.' },
      { type: 'tool', id: 't1', name: 'Read', status: 'completed' },
      { type: 'text', text: 'Done.' },
    ])
    expect(progress.metrics).toEqual({ textBlocks: 2, toolCalls: 1, toolFailures: 0 })
  })

  it('keeps the newest blocks when the compact cap is exceeded', () => {
    const blocks = Array.from({ length: MAX_PROGRESS_BLOCKS + 5 }, (_, index) => ({
      type: 'text' as const,
      text: `line-${index}`,
    }))
    const progress = projectTurnProgress(structured({
      blocks,
      assistantText: 'line-44',
      metrics: { textBlocks: blocks.length, toolCalls: 0, toolFailures: 0 },
    }))
    expect(progress.blocks).toHaveLength(MAX_PROGRESS_BLOCKS)
    expect(progress.blocks[0]).toEqual({ type: 'text', text: 'line-5' })
    expect(progress.blocks.at(-1)).toEqual({ type: 'text', text: 'line-44' })
  })

  it('bounds the complete persisted snapshot by UTF-8 bytes', () => {
    const blocks = Array.from({ length: MAX_PROGRESS_BLOCKS }, (_, index) => ({
      type: 'text' as const,
      text: `line-${index}-${'猫'.repeat(8_000)}`,
    }))
    const progress = projectTurnProgress(structured({
      blocks,
      assistantText: '猫'.repeat(8_000),
      metrics: { textBlocks: blocks.length, toolCalls: 0, toolFailures: 0 },
    }))
    expect(Buffer.byteLength(JSON.stringify(progress), 'utf8')).toBeLessThanOrEqual(MAX_PROGRESS_PAYLOAD_BYTES)
    expect(progress.blocks.length).toBeGreaterThan(0)
    expect(progress.blocks.at(-1)).toMatchObject({ type: 'text' })
    expect(JSON.stringify(progress)).not.toContain('�')
  })
})

describe('progress fingerprint', () => {
  it('ignores updatedAt so identical snapshots do not republish', () => {
    const first = projectTurnProgress(structured(), 1)
    const second = projectTurnProgress(structured(), 99)
    expect(progressFingerprint(first)).toBe(progressFingerprint(second))
    expect(progressChanged(first, second)).toBe(false)
    expect(progressChanged(null, first)).toBe(true)
  })
})

describe('createProgressPublisher', () => {
  it('publishes the first snapshot immediately and debounces later ones', async () => {
    vi.useFakeTimers()
    const publish = vi.fn()
    const publisher = createProgressPublisher({ debounceMs: 1_000, publish })
    publisher.offer(projectTurnProgress(structured({ assistantText: 'one' }), 1))
    publisher.offer(projectTurnProgress(structured({ assistantText: 'two' }), 2))
    publisher.offer(projectTurnProgress(structured({ assistantText: 'three' }), 3))
    await vi.advanceTimersByTimeAsync(0)
    expect(publish).toHaveBeenCalledTimes(1)
    expect(publish.mock.calls[0]?.[0].assistantText).toBe('one')
    await vi.advanceTimersByTimeAsync(1_000)
    expect(publish).toHaveBeenCalledTimes(2)
    expect(publish.mock.calls[1]?.[0].assistantText).toBe('three')
    vi.useRealTimers()
  })

  it('does not overlap asynchronous publishers', async () => {
    vi.useFakeTimers()
    const releases: Array<() => void> = []
    const publish = vi.fn(async () => new Promise<void>((resolve) => releases.push(resolve)))
    const publisher = createProgressPublisher({ debounceMs: 1_000, publish })
    publisher.offer(projectTurnProgress(structured({ assistantText: 'one' }), 1))
    await vi.advanceTimersByTimeAsync(0)
    publisher.offer(projectTurnProgress(structured({ assistantText: 'two' }), 2))
    await vi.advanceTimersByTimeAsync(1_000)
    expect(publish).toHaveBeenCalledTimes(1)
    releases.shift()?.()
    await vi.advanceTimersByTimeAsync(0)
    expect(publish).toHaveBeenCalledTimes(2)
    releases.shift()?.()
    await publisher.flush()
    vi.useRealTimers()
  })

  it('flush publishes the latest pending snapshot', async () => {
    vi.useFakeTimers()
    const publish = vi.fn()
    const publisher = createProgressPublisher({ debounceMs: 1_000, publish })
    publisher.offer(projectTurnProgress(structured({ assistantText: 'one' }), 1))
    publisher.offer(projectTurnProgress(structured({ assistantText: 'two' }), 2))
    await publisher.flush()
    expect(publish.mock.calls.map((call) => call[0].assistantText)).toEqual(['one', 'two'])
    vi.useRealTimers()
  })
})
