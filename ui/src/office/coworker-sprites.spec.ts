import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import {
  OFFICE_COWORKER_EMOTES,
  OFFICE_COWORKER_SPRITES,
  officeCoworkerSpriteForAgent,
} from './coworker-sprites'

const publicRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../public')

describe('Office coworker sprite registry', () => {
  it('maps authored runtimes to distinct generated coworkers', () => {
    expect(officeCoworkerSpriteForAgent('codex')).toBe(OFFICE_COWORKER_SPRITES.codex)
    expect(officeCoworkerSpriteForAgent('claude')).toBe(OFFICE_COWORKER_SPRITES.claude)
    expect(officeCoworkerSpriteForAgent('pi')).toBe(OFFICE_COWORKER_SPRITES.pi)
    expect(officeCoworkerSpriteForAgent('opencode')).toBe(OFFICE_COWORKER_SPRITES.opencode)
    expect(new Set(Object.values(OFFICE_COWORKER_SPRITES).map((asset) => asset.portraitSrc)).size).toBe(4)
    expect(new Set(Object.values(OFFICE_COWORKER_SPRITES).map((asset) => asset.deskSrc)).size).toBe(4)
    expect(new Set(Object.values(OFFICE_COWORKER_SPRITES).map((asset) => asset.deskWorkSrc)).size).toBe(4)
    expect(new Set(Object.values(OFFICE_COWORKER_SPRITES).map((asset) => asset.typingPhaseMs)).size).toBe(4)
  })

  it('keeps aliases intentional and unknown runtimes stable without returning Alice', () => {
    expect(officeCoworkerSpriteForAgent('cursor-agent')).toBe(OFFICE_COWORKER_SPRITES.codex)
    expect(officeCoworkerSpriteForAgent('omp')).toBe(OFFICE_COWORKER_SPRITES.opencode)
    expect(officeCoworkerSpriteForAgent('future-agent')).toBe(
      officeCoworkerSpriteForAgent('future-agent'),
    )
    expect(officeCoworkerSpriteForAgent('future-agent').portraitSrc).not.toContain('alice-maid')
    expect(officeCoworkerSpriteForAgent('future-agent').deskSrc).toContain('-desk-v1.png')
    expect(officeCoworkerSpriteForAgent('future-agent').deskWorkSrc).toContain('-desk-work-v1.png')
  })

  it('ships every roster portrait on the native card canvas', () => {
    for (const asset of Object.values(OFFICE_COWORKER_SPRITES)) {
      expect(asset.portraitSrc).toContain('-portrait-v2.png')
      const portrait = readFileSync(resolve(publicRoot, asset.portraitSrc.replace(/^\//, '')))
      expect(portrait.subarray(1, 4).toString()).toBe('PNG')
      expect(portrait.readUInt32BE(16)).toBe(72)
      expect(portrait.readUInt32BE(20)).toBe(104)
    }
  })

  it('owns exceptional desk-state emotes as generated Office assets', () => {
    expect(OFFICE_COWORKER_EMOTES).toEqual({
      waiting: '/office/coworkers/waiting-emote-v1.png',
      failed: '/office/coworkers/failed-emote-v1.png',
    })
  })

  it('ships each generated typing frame on the exact canvas of its identity frame', () => {
    for (const asset of Object.values(OFFICE_COWORKER_SPRITES)) {
      const idle = readFileSync(resolve(publicRoot, asset.deskSrc.replace(/^\//, '')))
      const work = readFileSync(resolve(publicRoot, asset.deskWorkSrc.replace(/^\//, '')))
      expect(work.subarray(0, 8)).toEqual(idle.subarray(0, 8))
      expect(work[25]).toBe(6)
      expect(work.readUInt32BE(16)).toBe(idle.readUInt32BE(16))
      expect(work.readUInt32BE(20)).toBe(idle.readUInt32BE(20))
    }
  })
})
