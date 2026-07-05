import { describe, expect, it } from 'vitest'

import { generatePetnameId, normalizeIdPrefix, type RandomInt } from './petname-id.js'

function sequence(...values: number[]): RandomInt {
  let i = 0
  return (exclusiveMax: number) => {
    const value = values[i++] ?? 0
    return value % exclusiveMax
  }
}

describe('petname ids', () => {
  it('normalizes prefixes into route-safe slugs', () => {
    expect(normalizeIdPrefix('Auto Quant!!')).toBe('auto-quant')
    expect(normalizeIdPrefix('***', 'workspace')).toBe('workspace')
  })

  it('generates a readable prefix + three-word id', () => {
    expect(generatePetnameId('chat', { randomInt: sequence(0, 0, 0) })).toBe(
      'chat-calm-amber-river',
    )
  })

  it('retries when a generated id is already taken', () => {
    const taken = new Set(['chat-calm-amber-river'])
    const id = generatePetnameId('chat', {
      randomInt: sequence(0, 0, 0, 1, 1, 1),
      isTaken: (candidate) => taken.has(candidate),
    })

    expect(id).toBe('chat-clear-copper-harbor')
  })
})
