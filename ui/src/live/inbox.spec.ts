import { describe, expect, it, vi } from 'vitest'

import type { InboxEntry } from '../api/inbox'
import {
  mergeHeadWithLoadedTail,
  reconcileInboxHistoryState,
  type InboxState,
} from './inbox'

function entry(id: string, body: string): InboxEntry {
  return {
    id,
    ts: 1,
    workspaceId: 'research-desk',
    body
  }
}

describe('reconcileInboxHistoryState', () => {
  it('settles loading while preserving incoming entries', () => {
    const current: InboxState = { entries: [], loading: true }
    const incoming = [entry('report-1', 'Ready')]

    const next = reconcileInboxHistoryState(current, incoming)

    expect(next).not.toBe(current)
    expect(next.entries).toEqual(incoming)
    expect(next.entries[0]).toBe(incoming[0])
    expect(next.loading).toBe(false)
  })

  it('does not publish an identical polling response', () => {
    const current: InboxState = { entries: [entry('report-1', 'Ready')], loading: false }

    const next = reconcileInboxHistoryState(current, structuredClone(current.entries))

    expect(next).toBe(current)
    expect(next.entries).toBe(current.entries)
  })

  it('reuses unchanged entries when one report changes', () => {
    const current: InboxState = {
      entries: [entry('report-1', 'Ready'), entry('report-2', 'Waiting')],
      loading: false,
    }
    const incoming = [structuredClone(current.entries[0]!), entry('report-2', 'Complete')]

    const next = reconcileInboxHistoryState(current, incoming)

    expect(next).not.toBe(current)
    expect(next.entries[0]).toBe(current.entries[0])
    expect(next.entries[1]).toBe(incoming[1])
  })
})


it('keeps bulk counts consistent with concurrent local reads and ignores stale polls', async () => {
  const { api } = await import('../api')
  const { inboxLive, applyInboxBulkRead, refreshInbox, setInboxReadAtOptimistically } = await import('./inbox')
  const first = entry('old', 'Old')
  const newcomer = entry('new', 'New')
  const history = vi.spyOn(api.inbox, 'history').mockResolvedValue({ entries: [newcomer, first], hasMore: true, unreadCount: 125 })
  const stop = inboxLive.subscribe(() => {})
  try {
    await vi.waitFor(() => expect(inboxLive.getState().unreadCount).toBe(125))
    let finish!: (value: Awaited<ReturnType<typeof api.inbox.history>>) => void
    history.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
    refreshInbox()
    setInboxReadAtOptimistically('old', 10)
    applyInboxBulkRead(['old', ...Array.from({ length: 123 }, (_, i) => `older-${i}`)], 20, 1)
    expect(inboxLive.getState().unreadCount).toBe(1)
    finish({ entries: [first], hasMore: true, unreadCount: 125 })
    await Promise.resolve()
    expect(inboxLive.getState().unreadCount).toBe(1)
    expect(inboxLive.getState().entries[0]).toBe(newcomer)
    expect(inboxLive.getState().entries[0]?.readAt).toBeUndefined()
  } finally { stop(); history.mockRestore() }
})


it('uses the server count when unseen arrivals were marked and refresh fails', async () => {
  const { api } = await import('../api')
  const { inboxLive, applyInboxBulkRead, refreshInbox } = await import('./inbox')
  const protectedEntry = entry('protected', 'Office review')
  const history = vi.spyOn(api.inbox, 'history').mockResolvedValue({ entries: [protectedEntry, entry('old', 'Old')], hasMore: false, unreadCount: 2 })
  const stop = inboxLive.subscribe(() => {})
  try {
    await vi.waitFor(() => expect(inboxLive.getState().unreadCount).toBe(2))
    history.mockRejectedValue(new Error('offline'))
    applyInboxBulkRead(['old', 'unseen-arrival'], 42, 1)
    refreshInbox()
    await Promise.resolve()
    expect(inboxLive.getState().unreadCount).toBe(1)
    expect(inboxLive.getState().entries.find((entry) => entry.id === 'protected')?.readAt).toBeUndefined()
  } finally { stop(); history.mockRestore() }
})

describe('mergeHeadWithLoadedTail', () => {
  it('preserves deeper paginated entries when a head refresh updates top items', () => {
    const e1 = entry('1', 'newest')
    const e2 = entry('2', 'mid')
    const e3 = entry('3', 'older-1')
    const e4 = entry('4', 'older-2')
    const e0 = entry('0', 'brand-new')

    const merged = mergeHeadWithLoadedTail([e1, e2, e3, e4], [e0, e1, e2], true, false)
    expect(merged.entries.map((e) => e.id)).toEqual(['0', '1', '2', '3', '4'])
    expect(merged.hasMore).toBe(false)
  })
})

it('hydrates first 20 immediately, backfills to 100, handles 304 polls, and loads older pages on demand', async () => {
  vi.resetModules()
  const { api } = await import('../api')
  const { inboxLive, loadOlderInbox, setInboxReadAtOptimistically } = await import('./inbox')
  const stage1 = Array.from({ length: 20 }, (_, i) => entry(`n-${i}`, `msg ${i}`))
  const stage2a = Array.from({ length: 40 }, (_, i) => entry(`n-${20 + i}`, `msg ${20 + i}`))
  const stage2b = Array.from({ length: 40 }, (_, i) => entry(`n-${60 + i}`, `msg ${60 + i}`))
  const older = Array.from({ length: 10 }, (_, i) => entry(`n-${100 + i}`, `msg ${100 + i}`))

  const calls: Array<{ limit?: number; before?: string; ifNoneMatch?: string; priority?: string }> = []
  let releaseStage2!: () => void
  const stage2Gate = new Promise<void>((resolve) => { releaseStage2 = resolve })
  const history = vi.spyOn(api.inbox, 'history').mockImplementation(async (opts = {}) => {
    calls.push(opts)
    if (opts.ifNoneMatch === 'W/"head"') {
      return { entries: [], hasMore: false, notModified: true, etag: 'W/"head"' }
    }
    if (!opts.before && opts.limit === 20) {
      return { entries: stage1, hasMore: true, unreadCount: 110, etag: 'W/"stage1"' }
    }
    if (opts.before === 'n-19') {
      await stage2Gate
      return { entries: stage2a, hasMore: true, unreadCount: 110, etag: 'W/"stage2a"' }
    }
    if (opts.before === 'n-59') {
      return { entries: stage2b, hasMore: true, unreadCount: 110, etag: 'W/"stage2b"' }
    }
    if (opts.before === 'n-99') {
      return { entries: older, hasMore: false, unreadCount: 110, etag: 'W/"older"' }
    }
    return { entries: [...stage1, ...stage2a, ...stage2b], hasMore: true, unreadCount: 110, etag: 'W/"head"' }
  })
  const inquiries = vi.spyOn(api.inquiries, 'forInbox').mockResolvedValue([])

  const stop = inboxLive.subscribe(() => {})
  try {
    await vi.waitFor(() => expect(inboxLive.getState().entries.length).toBeGreaterThanOrEqual(20))
    expect(calls[0]).toMatchObject({ limit: 20, priority: 'high' })

    // Simulating InboxSidebar auto-selecting row 0 while Stage 2 backfill is in flight
    // must NOT cancel the background backfill or clobber optimistic unreadCount.
    await vi.waitFor(() => expect(calls.some((c) => c.before === 'n-19')).toBe(true))
    setInboxReadAtOptimistically('n-0', 1234)
    expect(inboxLive.getState().unreadCount).toBe(109)
    releaseStage2()

    await vi.waitFor(() => expect(inboxLive.getState().entries).toHaveLength(100))
    expect(inboxLive.getState().unreadCount).toBe(109)
    expect(calls.some((c) => c.before === 'n-19' && c.limit === 40 && c.priority === 'low')).toBe(true)
    expect(calls.some((c) => c.before === 'n-59' && c.limit === 40 && c.priority === 'low')).toBe(true)
    expect(inboxLive.getState().hasMore).toBe(true)

    await loadOlderInbox()
    expect(inboxLive.getState().entries).toHaveLength(110)
    expect(inboxLive.getState().hasMore).toBe(false)
  } finally {
    stop()
    history.mockRestore()
    inquiries.mockRestore()
  }
})
