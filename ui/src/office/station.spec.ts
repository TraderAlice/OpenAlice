import { describe, expect, it } from 'vitest'

import { OFFICE_STATION, officeStationComposition } from './station'

describe('officeStationComposition', () => {
  it('anchors the sprite behind the desk at the front edge', () => {
    const station = officeStationComposition()
    expect(station.spriteAnchor).toBe('desk-front-edge')
    expect(station.spriteBehindDesk).toBe(true)
    expect(station.sprite.zIndex).toBeLessThan(station.desk.zIndex)
    expect(station.backToFront).toEqual(['sprite', 'desk', 'name', 'bubble'])
    expect(station.sprite.bottomPx).toBeGreaterThan(station.desk.bottomPx)
    expect(OFFICE_STATION.heightPx).toBeGreaterThan(OFFICE_STATION.sprite.bottomPx)
  })
})
