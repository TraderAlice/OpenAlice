import { describe, expect, it } from 'vitest'

import { adjustInsertIndex, insertIndexFromY, resolveItemInsert } from './activity-bar-sort'

const rows = [
  { id: 'a', top: 0, bottom: 40 },
  { id: 'b', top: 40, bottom: 80 },
  { id: 'c', top: 80, bottom: 120 },
]

describe('activity-bar live sort', () => {
  it('inserts before the row whose midpoint the pointer has not crossed', () => {
    expect(insertIndexFromY(rows, 10)).toBe(0)
    expect(insertIndexFromY(rows, 30)).toBe(1)
    expect(insertIndexFromY(rows, 61)).toBe(2)
    expect(insertIndexFromY(rows, 130)).toBe(3)
    expect(insertIndexFromY([], 10)).toBe(0)
  })

  it('compensates for the hole left when the dragged row is removed', () => {
    expect(adjustInsertIndex(1, 3, true)).toBe(2)
    expect(adjustInsertIndex(1, 1, true)).toBe(1)
    expect(adjustInsertIndex(1, 0, true)).toBe(0)
    expect(adjustInsertIndex(1, 2, false)).toBe(2)
  })

  it('keeps the item in place when the pointer is in the gap between groups', () => {
    const groups = [
      { id: 'primary', top: 0, bottom: 120, items: rows },
      { id: 'beta', top: 136, bottom: 216, items: [{ id: 'office', top: 136, bottom: 176 }] },
    ]
    expect(resolveItemInsert(groups, 50)).toEqual({ groupId: 'primary', destIndex: 1 })
    expect(resolveItemInsert(groups, 128)).toBeNull()
    expect(resolveItemInsert(groups, 160)).toEqual({ groupId: 'beta', destIndex: 1 })
    expect(resolveItemInsert(groups, 140, { sourceGroupId: 'primary', crossGroupInset: 20 })).toBeNull()
    expect(resolveItemInsert(groups, 160, { sourceGroupId: 'primary', crossGroupInset: 20 }))
      .toEqual({ groupId: 'beta', destIndex: 1 })
  })
})
