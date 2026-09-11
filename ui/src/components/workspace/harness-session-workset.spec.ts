import { describe, expect, it } from 'vitest'

import {
  RECENT_SIDEBAR_WORKSET_LIMIT,
  selectRecentSidebarWorkset,
} from './harness-session-workset'

function ids(count: number): string[] {
  return Array.from({ length: count }, (_, index) => `row-${index + 1}`)
}

describe('selectRecentSidebarWorkset', () => {
  it('returns the full list when it already fits the cap', () => {
    const recent = ids(7)
    expect(selectRecentSidebarWorkset(recent, () => false)).toEqual(recent)
    expect(selectRecentSidebarWorkset(ids(8), (id) => id === 'row-8')).toEqual(ids(8))
    expect(selectRecentSidebarWorkset([], () => true)).toEqual([])
  })

  it('keeps the first 8 rows when the active row is already visible or absent', () => {
    const recent = ids(12)
    expect(selectRecentSidebarWorkset(recent, () => false)).toEqual(ids(8))
    expect(selectRecentSidebarWorkset(recent, (id) => id === 'row-3')).toEqual(ids(8))
    expect(RECENT_SIDEBAR_WORKSET_LIMIT).toBe(8)
  })

  it('replaces the last visible row with an overflow active row and keeps relative order', () => {
    const recent = ids(12)
    expect(selectRecentSidebarWorkset(recent, (id) => id === 'row-9')).toEqual([
      'row-1', 'row-2', 'row-3', 'row-4', 'row-5', 'row-6', 'row-7', 'row-9',
    ])
    expect(selectRecentSidebarWorkset(recent, (id) => id === 'row-12')).toEqual([
      'row-1', 'row-2', 'row-3', 'row-4', 'row-5', 'row-6', 'row-7', 'row-12',
    ])
  })

  it('keeps a single visible slot for an overflow active row when the cap is 1', () => {
    expect(selectRecentSidebarWorkset(ids(4), (id) => id === 'row-4', 1)).toEqual(['row-4'])
  })
})
