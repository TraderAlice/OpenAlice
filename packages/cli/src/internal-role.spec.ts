import { describe, expect, it } from 'vitest'

import { parseInternalRole } from './internal-role.js'

describe('parseInternalRole', () => {
  it('leaves ordinary CLI arguments alone', () => {
    expect(parseInternalRole(['status', '--json'])).toBeNull()
  })

  it('parses a private process role and preserves its arguments', () => {
    expect(parseInternalRole(['--internal-role', 'alice', '--probe'])).toEqual({
      role: 'alice',
      argv: ['--probe'],
    })
  })

  it('rejects missing and unknown private roles', () => {
    expect(() => parseInternalRole(['--internal-role'])).toThrow('invalid private runtime role')
    expect(() => parseInternalRole(['--internal-role', 'other'])).toThrow('invalid private runtime role')
  })
})
