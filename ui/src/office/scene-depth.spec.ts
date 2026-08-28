import { describe, expect, it } from 'vitest'

import { officeDepthAt, OFFICE_DEPTH_BASE } from './scene-depth'

describe('officeDepthAt', () => {
  it('paints lower floor contacts in front of higher contacts', () => {
    expect(officeDepthAt(360)).toBeGreaterThan(officeDepthAt(240))
  })

  it('rounds map coordinates and keeps depth above the floor layer', () => {
    expect(officeDepthAt(12.6)).toBe(OFFICE_DEPTH_BASE + 13)
    expect(officeDepthAt(-20)).toBe(OFFICE_DEPTH_BASE)
  })
})
