import { describe, expect, it } from 'vitest'

import { nextOfficeRosterIndex, type OfficeRosterFocusRect } from './roster-navigation'

const grid: OfficeRosterFocusRect[] = [
  { left: 0, right: 100, top: 0, bottom: 60 },
  { left: 120, right: 220, top: 0, bottom: 60 },
  { left: 0, right: 100, top: 80, bottom: 140 },
  { left: 120, right: 220, top: 80, bottom: 140 },
  { left: 0, right: 100, top: 160, bottom: 220 },
]

describe('Office roster spatial navigation', () => {
  it('follows rows and columns instead of DOM order alone', () => {
    expect(nextOfficeRosterIndex(grid, 0, 'right')).toBe(1)
    expect(nextOfficeRosterIndex(grid, 0, 'down')).toBe(2)
    expect(nextOfficeRosterIndex(grid, 3, 'left')).toBe(2)
    expect(nextOfficeRosterIndex(grid, 3, 'down')).toBe(4)
    expect(nextOfficeRosterIndex(grid, 4, 'up')).toBe(2)
  })

  it('stays on the current teammate at a menu edge', () => {
    expect(nextOfficeRosterIndex(grid, 0, 'left')).toBe(0)
    expect(nextOfficeRosterIndex(grid, 0, 'up')).toBe(0)
    expect(nextOfficeRosterIndex(grid, 4, 'down')).toBe(4)
  })
})
