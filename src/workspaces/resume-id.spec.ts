import { describe, expect, it } from 'vitest'

import type { RandomInt } from './petname-id.js'
import { generateResumeId } from './resume-id.js'

function sequence(...values: number[]): RandomInt {
  let index = 0
  return (exclusiveMax: number) => (values[index++] ?? 0) % exclusiveMax
}

describe('resume ids', () => {
  it('combines a readable petname with a six-character random tail', () => {
    expect(generateResumeId({
      randomInt: sequence(0, 0, 0, 10, 11, 12, 13, 14, 15),
    })).toBe('resume-calm-amber-river-abcdef')
  })

  it('retries the complete id when a candidate is already taken', () => {
    const taken = new Set(['resume-calm-amber-river-000000'])
    expect(generateResumeId({
      randomInt: sequence(
        0, 0, 0, 0, 0, 0, 0, 0, 0,
        1, 1, 1, 1, 1, 1, 1, 1, 1,
      ),
      isTaken: (candidate) => taken.has(candidate),
    })).toBe('resume-clear-copper-harbor-111111')
  })
})
