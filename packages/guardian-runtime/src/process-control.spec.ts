import { describe, expect, it } from 'vitest'

import { normalizeProcessExitCode } from './process-control.js'

describe('normalizeProcessExitCode', () => {
  it('preserves valid integer exit codes', () => {
    expect(normalizeProcessExitCode(0)).toBe(0)
    expect(normalizeProcessExitCode(1)).toBe(1)
    expect(normalizeProcessExitCode(137)).toBe(137)
  })

  it('maps signal callback payloads and invalid numbers to success', () => {
    expect(normalizeProcessExitCode('SIGINT')).toBe(0)
    expect(normalizeProcessExitCode('SIGTERM')).toBe(0)
    expect(normalizeProcessExitCode(Number.NaN)).toBe(0)
    expect(normalizeProcessExitCode(-1)).toBe(0)
  })
})
