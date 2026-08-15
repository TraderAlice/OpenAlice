import { describe, expect, it } from 'vitest'

import { defaultOfficeSpritePack, type OfficeEmployeeMood } from './sprite-pack'

describe('defaultOfficeSpritePack (Codex v2 adapter)', () => {
  it('maps product moods to v2 rows without leaking atlas names into the model', () => {
    const moods: OfficeEmployeeMood[] = ['idle', 'working', 'talking', 'waiting', 'review', 'failed']
    expect(moods.map((mood) => defaultOfficeSpritePack.pose(mood).row)).toEqual([0, 7, 3, 6, 8, 5])
    expect(defaultOfficeSpritePack.cell).toEqual({ width: 192, height: 208 })
    expect(defaultOfficeSpritePack.sheetUrl).toContain('/office/packs/')
  })
})
