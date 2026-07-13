import { describe, expect, it } from 'vitest'

import { planUTATransition } from './uta-lifecycle.js'

describe('planUTATransition', () => {
  it.each([
    { mode: 'lite', running: false, expected: 'none' },
    { mode: 'lite', running: true, expected: 'stop' },
    { mode: 'readonly', running: false, expected: 'start' },
    { mode: 'readonly', running: true, expected: 'restart' },
    { mode: 'pro', running: false, expected: 'start' },
    { mode: 'pro', running: true, expected: 'restart' },
  ] as const)('$mode with running=$running plans $expected', ({ mode, running, expected }) => {
    expect(planUTATransition(mode, running)).toBe(expected)
  })
})
