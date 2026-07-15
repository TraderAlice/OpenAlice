import { describe, expect, it } from 'vitest'

import { parseDevGuardianOptions } from './dev-options.js'

describe('parseDevGuardianOptions', () => {
  it('resolves a separate development home from the checkout directory', () => {
    expect(parseDevGuardianOptions(['--', '--home', '../openalice-homes/feature-a'], '/repo/OpenAlice'))
      .toEqual({ home: '/repo/openalice-homes/feature-a' })
  })

  it('supports equals syntax and leaves other Guardian options alone', () => {
    expect(parseDevGuardianOptions(['--takeover', '--home=/tmp/openalice feature']))
      .toEqual({ home: '/tmp/openalice feature' })
  })

  it('uses the final home when a wrapper supplied more than one', () => {
    expect(parseDevGuardianOptions(['--home', '/tmp/first', '--home=/tmp/second']))
      .toEqual({ home: '/tmp/second' })
  })

  it('rejects a missing home path before any process starts', () => {
    expect(() => parseDevGuardianOptions(['--home'])).toThrow('--home requires a directory path')
    expect(() => parseDevGuardianOptions(['--home='])).toThrow('--home requires a directory path')
  })
})
