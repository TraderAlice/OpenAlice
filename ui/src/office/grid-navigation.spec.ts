import { describe, expect, it } from 'vitest'

import { nextOfficeGridIndex, type OfficeGridFocusRect } from './grid-navigation'

const grid: OfficeGridFocusRect[] = [
  { left: 0, right: 100, top: 0, bottom: 60 },
  { left: 120, right: 220, top: 0, bottom: 60 },
  { left: 0, right: 100, top: 80, bottom: 140 },
  { left: 120, right: 220, top: 80, bottom: 140 },
  { left: 0, right: 100, top: 160, bottom: 220 },
]

describe('Office grid spatial navigation', () => {
  it('follows rows and columns instead of DOM order alone', () => {
    expect(nextOfficeGridIndex(grid, 0, 'right')).toBe(1)
    expect(nextOfficeGridIndex(grid, 0, 'down')).toBe(2)
    expect(nextOfficeGridIndex(grid, 3, 'left')).toBe(2)
    expect(nextOfficeGridIndex(grid, 3, 'down')).toBe(4)
    expect(nextOfficeGridIndex(grid, 4, 'up')).toBe(2)
  })

  it('stays on the current item at a menu edge', () => {
    expect(nextOfficeGridIndex(grid, 0, 'left')).toBe(0)
    expect(nextOfficeGridIndex(grid, 0, 'up')).toBe(0)
    expect(nextOfficeGridIndex(grid, 4, 'down')).toBe(4)
  })
})
