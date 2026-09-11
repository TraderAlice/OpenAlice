import { describe, expect, it } from 'vitest'

import { isOfficeConfirmKey } from './input'

describe('Office input', () => {
  it('recognizes only the two game confirm keys', () => {
    expect(isOfficeConfirmKey('Enter')).toBe(true)
    expect(isOfficeConfirmKey(' ')).toBe(true)
    expect(isOfficeConfirmKey('Escape')).toBe(false)
    expect(isOfficeConfirmKey('Space')).toBe(false)
  })
})
