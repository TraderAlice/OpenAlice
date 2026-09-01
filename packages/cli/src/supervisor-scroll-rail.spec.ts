import { describe, expect, it } from 'vitest'

import { displayWidth } from './supervisor-display.ts'
import { withSupervisorScrollRail } from './supervisor-scroll-rail.ts'

describe('Supervisor scroll rail', () => {
  it('stays hidden when the complete collection fits', () => {
    expect(withSupervisorScrollRail(['one', 'two'], 8, { offset: 0, total: 2 }))
      .toEqual(['one', 'two'])
  })

  it('moves an OMP-style proportional thumb from top to bottom', () => {
    const rows = ['一', 'two', 'three', 'four']
    const top = withSupervisorScrollRail(rows, 8, { offset: 0, total: 12 })
    const middle = withSupervisorScrollRail(rows, 8, { offset: 4, total: 12 })
    const bottom = withSupervisorScrollRail(rows, 8, { offset: 8, total: 12 })

    expect(top.map((row) => row.at(-1))).toEqual(['█', '│', '│', '│'])
    expect(middle.map((row) => row.at(-1))).toEqual(['│', '│', '█', '│'])
    expect(bottom.map((row) => row.at(-1))).toEqual(['│', '│', '│', '█'])
    expect([...top, ...middle, ...bottom].every((row) => displayWidth(row) === 8)).toBe(true)
  })
})
