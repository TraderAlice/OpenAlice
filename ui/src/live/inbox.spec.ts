import { describe, expect, it, vi } from 'vitest'

import type { InboxEntry } from '../api/inbox'
import { reconcileInboxHistoryState, type InboxState } from './inbox'

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
