import { describe, expect, it } from 'vitest'

import { officeCoworkerLabel } from './label'

describe('officeCoworkerLabel', () => {
  it('prefers displayName, then title, then the sticky name', () => {
    expect(officeCoworkerLabel({ name: 'c1', title: 'Desk mate', displayName: 'AAPL desk' }))
      .toBe('AAPL desk')
    expect(officeCoworkerLabel({ name: 'c1', title: 'Desk mate' })).toBe('Desk mate')
    expect(officeCoworkerLabel({ name: 'c1' })).toBe('c1')
  })
})
