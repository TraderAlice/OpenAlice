import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { defaultOfficeSpritePack, type OfficeAlicePose } from './sprite-pack'

describe('defaultOfficeSpritePack (Codex v2 adapter)', () => {
  it('maps Alice movement actions to authored rows and a generated rear-view sheet', () => {
    const actions: OfficeAlicePose[] = ['idle', 'idle-back', 'walk-right', 'walk-left']
    expect(actions.map((action) => defaultOfficeSpritePack.pose(action).row)).toEqual([0, 0, 1, 2])
    expect(defaultOfficeSpritePack.pose('walk-right').frames).toBe(8)
    expect(defaultOfficeSpritePack.pose('idle').cell).toEqual({ width: 192, height: 208 })
    expect(defaultOfficeSpritePack.pose('idle').sheetUrl).toContain('/office/packs/')

    const rearView = defaultOfficeSpritePack.pose('idle-back')
    expect(rearView.sheetUrl).toBe('/office/packs/alice-maid/back-v1.png')
    expect(rearView.atlas).toEqual({ columns: 1, rows: 1 })
    expect(rearView.frames).toBe(1)

    const publicRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../public')
    const bytes = readFileSync(resolve(publicRoot, rearView.sheetUrl.replace(/^\//, '')))
    expect([...bytes.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10])
    expect(bytes[25]).toBe(6) // PNG color type 6: RGBA.
  })
})
