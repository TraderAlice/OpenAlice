import { describe, expect, it } from 'vitest'

import { defaultOfficeSpritePack, type OfficeAlicePose } from './sprite-pack'

describe('defaultOfficeSpritePack (Codex v2 adapter)', () => {
  it('maps Alice movement actions to the authored v2 idle and run rows', () => {
    const actions: OfficeAlicePose[] = ['idle', 'walk-right', 'walk-left']
    expect(actions.map((action) => defaultOfficeSpritePack.pose(action).row)).toEqual([0, 1, 2])
    expect(defaultOfficeSpritePack.pose('walk-right').frames).toBe(8)
    expect(defaultOfficeSpritePack.cell).toEqual({ width: 192, height: 208 })
    expect(defaultOfficeSpritePack.sheetUrl).toContain('/office/packs/')
  })
})
