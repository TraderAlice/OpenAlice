import { describe, expect, it } from 'vitest'
import { settleCompanion, snapEase } from './companion-geometry.js'

describe('companion screen placement', () => {
  const area = { x: 0, y: 24, width: 1920, height: 1056 }
  it('keeps free placement and only flips in the left half', () => {
    expect(settleCompanion({ x: 600, y: 400, width: 220, height: 363 }, area))
      .toEqual({ x: 600, y: 400, width: 220, height: 363, flipped: true })
  })
  it('uses upstream side/bottom zones and keeps the menu bar and taskbar clear', () => {
    expect(settleCompanion({ x: 20, y: 700, width: 220, height: 363 }, area))
      .toEqual({ x: 0, y: 717, width: 220, height: 363, flipped: true })
    expect(settleCompanion({ x: 1660, y: 700, width: 220, height: 363 }, area).x).toBe(1700)
    expect(settleCompanion({ x: 600, y: 40, width: 220, height: 363 }, area).y).toBe(40)
  })
  it('supports negative coordinates on a secondary screen', () => {
    expect(settleCompanion({ x: -1580, y: -120, width: 220, height: 363 }, { x: -1600, y: -200, width: 1600, height: 900 }))
      .toEqual({ x: -1600, y: -120, width: 220, height: 363, flipped: true })
  })
  it('recovers an unplugged monitor position into the surviving work area', () => {
    const next = settleCompanion({ x: -2500, y: 1600, width: 220, height: 363 }, area, false)
    expect(next.x).toBe(0)
    expect(next.y).toBe(717)
  })
  it('converges monotonically to the CSS ease endpoint', () => {
    const values = Array.from({ length: 11 }, (_, i) => snapEase(i / 10))
    expect(values[0]).toBeCloseTo(0)
    expect(values[10]).toBeCloseTo(1)
    expect(values).toEqual([...values].sort((a, b) => a - b))
    expect(snapEase(.5)).toBeCloseTo(.8024, 3)
  })
})
