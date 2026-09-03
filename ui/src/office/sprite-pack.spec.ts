import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { defaultOfficeSpritePack, type OfficeAlicePose } from './sprite-pack'

describe('defaultOfficeSpritePack', () => {
  it('maps every direction to a unified generated overworld sheet', () => {
    const actions: OfficeAlicePose[] = [
      'idle-down', 'idle-left', 'idle-right', 'idle-up',
      'walk-down', 'walk-left', 'walk-right', 'walk-up',
    ]
    expect(actions.map((action) => defaultOfficeSpritePack.pose(action).row))
      .toEqual([0, 1, 2, 3, 0, 1, 2, 3])
    expect(actions.slice(0, 4).map((action) => defaultOfficeSpritePack.pose(action).column))
      .toEqual([1, 1, 1, 1])
    expect(actions.slice(4).map((action) => defaultOfficeSpritePack.pose(action).frames))
      .toEqual([3, 3, 3, 3])
    expect(defaultOfficeSpritePack.pose('idle-down').cell).toEqual({ width: 48, height: 48 })

    const rearView = defaultOfficeSpritePack.pose('walk-up')
    expect(rearView.sheetUrl).toBe('/office/packs/alice-overworld-v1.png')
    expect(rearView.atlas).toEqual({ columns: 3, rows: 4 })

    const publicRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../public')
    const bytes = readFileSync(resolve(publicRoot, rearView.sheetUrl.replace(/^\//, '')))
    expect([...bytes.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10])
    expect(bytes.readUInt32BE(16)).toBe(144)
    expect(bytes.readUInt32BE(20)).toBe(192)
    expect(bytes[25]).toBe(6) // PNG color type 6: RGBA.
  })
})
