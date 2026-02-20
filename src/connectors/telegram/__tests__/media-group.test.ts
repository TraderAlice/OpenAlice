import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MediaGroupMerger } from '../media-group.js'
import { buildParsedMessage } from '../helpers.js'
import {
  resetCounters,
  textMessage,
  mediaGroupPhotoMessage,
} from './fixtures.js'
import type { ParsedMessage } from '../types.js'

beforeEach(() => {
  vi.useFakeTimers()
  resetCounters()
})

function pm(text: string): ParsedMessage {
  return buildParsedMessage(textMessage(text))
}

function albumPm(groupId: string, caption?: string): ParsedMessage {
  return buildParsedMessage(mediaGroupPhotoMessage(groupId, caption))
}

describe('MediaGroupMerger', () => {
  it('emits non-album messages immediately', () => {
    const results: ParsedMessage[] = []
    const merger = new MediaGroupMerger({
      onMerged: (m) => results.push(m),
    })

    merger.push(pm('hello'))
    expect(results).toHaveLength(1)
    expect(results[0].text).toBe('hello')
  })

  it('buffers album messages and merges after timeout', () => {
    const results: ParsedMessage[] = []
    const merger = new MediaGroupMerger({
      flushMs: 500,
      onMerged: (m) => results.push(m),
    })

    merger.push(albumPm('album_1', 'caption here'))
    merger.push(albumPm('album_1'))
    merger.push(albumPm('album_1'))

    // Not emitted yet
    expect(results).toHaveLength(0)
    expect(merger.pendingCount).toBe(1)

    // Advance past the flush timeout
    vi.advanceTimersByTime(500)

    expect(results).toHaveLength(1)
    expect(merger.pendingCount).toBe(0)
    // All 3 photos merged
    expect(results[0].media).toHaveLength(3)
    // Caption from the message that had one
    expect(results[0].text).toBe('caption here')
  })

  it('keeps separate groups separate', () => {
    const results: ParsedMessage[] = []
    const merger = new MediaGroupMerger({
      flushMs: 500,
      onMerged: (m) => results.push(m),
    })

    merger.push(albumPm('group_a'))
    merger.push(albumPm('group_b'))
    merger.push(albumPm('group_a'))

    vi.advanceTimersByTime(500)

    expect(results).toHaveLength(2)
    const mediaCounts = results.map((r) => r.media.length).sort()
    expect(mediaCounts).toEqual([1, 2])
  })

  it('resets timer on each new message in the group', () => {
    const results: ParsedMessage[] = []
    const merger = new MediaGroupMerger({
      flushMs: 500,
      onMerged: (m) => results.push(m),
    })

    merger.push(albumPm('album_1'))
    vi.advanceTimersByTime(400)
    // Add another within the window — timer should reset
    merger.push(albumPm('album_1'))
    vi.advanceTimersByTime(400)
    // Still not flushed (only 400ms since last push)
    expect(results).toHaveLength(0)

    vi.advanceTimersByTime(100)
    expect(results).toHaveLength(1)
    expect(results[0].media).toHaveLength(2)
  })

  it('flush() emits all pending groups immediately', () => {
    const results: ParsedMessage[] = []
    const merger = new MediaGroupMerger({
      flushMs: 500,
      onMerged: (m) => results.push(m),
    })

    merger.push(albumPm('a'))
    merger.push(albumPm('b'))

    expect(results).toHaveLength(0)

    merger.flush()

    expect(results).toHaveLength(2)
    expect(merger.pendingCount).toBe(0)
  })

  it('sorts merged messages by messageId', () => {
    const results: ParsedMessage[] = []
    const merger = new MediaGroupMerger({
      flushMs: 500,
      onMerged: (m) => results.push(m),
    })

    // Push in any order — they should be sorted by messageId
    const m1 = albumPm('album_1')
    const m2 = albumPm('album_1', 'cap')
    const m3 = albumPm('album_1')

    merger.push(m3)
    merger.push(m1)
    merger.push(m2)

    vi.advanceTimersByTime(500)

    // The merged result should use the first message (by messageId) as base
    expect(results[0].messageId).toBe(m1.messageId)
    expect(results[0].text).toBe('cap')
  })

  it('uses empty text when no message has a caption', () => {
    const results: ParsedMessage[] = []
    const merger = new MediaGroupMerger({
      flushMs: 500,
      onMerged: (m) => results.push(m),
    })

    merger.push(albumPm('album_1'))
    merger.push(albumPm('album_1'))

    vi.advanceTimersByTime(500)

    expect(results[0].text).toBe('')
  })

  it('mixes album and non-album messages correctly', () => {
    const results: ParsedMessage[] = []
    const merger = new MediaGroupMerger({
      flushMs: 500,
      onMerged: (m) => results.push(m),
    })

    merger.push(pm('before'))
    merger.push(albumPm('album_1'))
    merger.push(pm('during'))
    merger.push(albumPm('album_1'))

    // Non-album messages emitted immediately
    expect(results).toHaveLength(2)
    expect(results[0].text).toBe('before')
    expect(results[1].text).toBe('during')

    vi.advanceTimersByTime(500)

    // Album merged
    expect(results).toHaveLength(3)
    expect(results[2].media).toHaveLength(2)
  })
})
