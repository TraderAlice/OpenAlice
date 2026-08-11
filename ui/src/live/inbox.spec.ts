import { describe, expect, it } from 'vitest'

import type { InboxEntry } from '../api/inbox'
import { reconcileInboxHistoryState, type InboxState } from './inbox'

function entry(id: string, comments: string): InboxEntry {
  return {
    id,
    ts: 1,
    workspaceId: 'research-desk',
    comments,
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
