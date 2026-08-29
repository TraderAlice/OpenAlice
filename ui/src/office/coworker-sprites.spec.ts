import { describe, expect, it } from 'vitest'

import { OFFICE_COWORKER_SPRITES, officeCoworkerSpriteForAgent } from './coworker-sprites'

describe('Office coworker sprite registry', () => {
  it('maps authored runtimes to distinct generated coworkers', () => {
    expect(officeCoworkerSpriteForAgent('codex')).toBe(OFFICE_COWORKER_SPRITES.codex)
    expect(officeCoworkerSpriteForAgent('claude')).toBe(OFFICE_COWORKER_SPRITES.claude)
    expect(officeCoworkerSpriteForAgent('pi')).toBe(OFFICE_COWORKER_SPRITES.pi)
    expect(officeCoworkerSpriteForAgent('opencode')).toBe(OFFICE_COWORKER_SPRITES.opencode)
    expect(new Set(Object.values(OFFICE_COWORKER_SPRITES).map((asset) => asset.src)).size).toBe(4)
  })

  it('keeps aliases intentional and unknown runtimes stable without returning Alice', () => {
    expect(officeCoworkerSpriteForAgent('cursor-agent')).toBe(OFFICE_COWORKER_SPRITES.codex)
    expect(officeCoworkerSpriteForAgent('omp')).toBe(OFFICE_COWORKER_SPRITES.opencode)
    expect(officeCoworkerSpriteForAgent('future-agent')).toBe(
      officeCoworkerSpriteForAgent('future-agent'),
    )
    expect(officeCoworkerSpriteForAgent('future-agent').src).not.toContain('alice-maid')
  })
})
