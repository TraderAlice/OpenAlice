import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import {
  OFFICE_COWORKER_EMOTES,
  OFFICE_COWORKER_SPRITES,
  officeCoworkerCast,
  officeCoworkerSpriteForAgent,
} from './coworker-sprites'

const publicRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../public')

describe('Office coworker sprite registry', () => {
  it('maps authored runtimes to distinct generated coworkers', () => {
    expect(officeCoworkerSpriteForAgent('codex')).toBe(OFFICE_COWORKER_SPRITES.codex)
    expect(officeCoworkerSpriteForAgent('claude')).toBe(OFFICE_COWORKER_SPRITES.claude)
    expect(officeCoworkerSpriteForAgent('pi')).toBe(OFFICE_COWORKER_SPRITES.pi)
    expect(officeCoworkerSpriteForAgent('opencode')).toBe(OFFICE_COWORKER_SPRITES.opencode)
    expect(officeCoworkerSpriteForAgent('grok')).toBe(OFFICE_COWORKER_SPRITES['grok-oracle'])
    expect(new Set(Object.values(OFFICE_COWORKER_SPRITES).map((asset) => asset.portraitSrc)).size).toBe(18)
    expect(new Set(Object.values(OFFICE_COWORKER_SPRITES).map((asset) => asset.deskSrc)).size).toBe(18)
    expect(new Set(Object.values(OFFICE_COWORKER_SPRITES).map((asset) => asset.deskWorkSrc)).size).toBe(18)
    expect(new Set(Object.values(OFFICE_COWORKER_SPRITES).map((asset) => asset.typingPhaseMs)).size).toBe(18)
  })

  it('assigns a stable identity-led coworker from each runtime family pool', () => {
    const samples = Array.from({ length: 64 }, (_, index) => `resume-${index}`)
    expect(new Set(samples.map((identity) => officeCoworkerSpriteForAgent('codex', identity).id)).size)
      .toBe(3)
    expect(new Set(samples.map((identity) => officeCoworkerSpriteForAgent('claude', identity).id)).size)
      .toBe(2)
    expect(new Set(samples.map((identity) => officeCoworkerSpriteForAgent('pi', identity).id)).size)
      .toBe(2)
    expect(new Set(samples.map((identity) => officeCoworkerSpriteForAgent('opencode', identity).id)).size)
      .toBe(3)
    expect(new Set(samples.map((identity) => officeCoworkerSpriteForAgent('grok', identity).id)).size)
      .toBe(8)
    expect(officeCoworkerSpriteForAgent('codex', 'resume-7'))
      .toBe(officeCoworkerSpriteForAgent('codex', 'resume-7'))
  })

  it('casts a runtime family without repeats until its authored pool is exhausted', () => {
    const members = [
      'resume-crisp-slate-terrace-d82wad',
      'resume-simple-laurel-porch-7n91jk',
      'resume-nimble-birch-valley-un7631',
      'resume-stable-cedar-terrace-vkvnyi',
      'resume-light-maple-pencil-udz3zv',
      'resume-crisp-marble-valley-qumctp',
      'resume-quiet-spruce-canyon-vrg12a',
      'resume-warm-cedar-field-zmb88n',
    ].map((resumeId) => ({ resumeId, agent: 'grok' }))
    const cast = officeCoworkerCast(members)
    const reversed = officeCoworkerCast([...members].reverse())

    expect(new Set(members.map((member) => cast.get(member.resumeId)?.id)).size).toBe(8)
    expect(members.map((member) => cast.get(member.resumeId)?.id)).toEqual(
      members.map((member) => reversed.get(member.resumeId)?.id),
    )
  })

  it('retains established cast identities when a new coworker joins', () => {
    const originalMembers = ['g5', 'g4', 'g3', 'g2'].map((resumeId) => ({
      resumeId,
      agent: 'grok',
    }))
    const original = officeCoworkerCast(originalMembers)
    const joined = officeCoworkerCast(
      [{ resumeId: 'g6', agent: 'grok' }, ...originalMembers],
      original,
    )

    for (const member of originalMembers) {
      expect(joined.get(member.resumeId)).toBe(original.get(member.resumeId))
    }
    expect(new Set(Array.from(joined.values(), (asset) => asset.id)).size).toBe(5)
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
      working: '/office/hud/talk-bubble-v2.png',
      sleeping: '/office/coworkers/sleep-emote-v1.png',
      waiting: '/office/coworkers/waiting-emote-v1.png',
      failed: '/office/coworkers/failed-emote-v1.png',
      review: '/office/coworkers/review-emote-v1.png',
    })

    const review = readFileSync(resolve(
      publicRoot,
      OFFICE_COWORKER_EMOTES.review.replace(/^\//, ''),
    ))
    expect(review.subarray(1, 4).toString()).toBe('PNG')
    expect(review.readUInt32BE(16)).toBe(160)
    expect(review.readUInt32BE(20)).toBe(160)
    expect(review[25]).toBe(6)

    const sleeping = readFileSync(resolve(
      publicRoot,
      OFFICE_COWORKER_EMOTES.sleeping.replace(/^\//, ''),
    ))
    expect(sleeping.subarray(1, 4).toString()).toBe('PNG')
    expect(sleeping.readUInt32BE(16)).toBe(48)
    expect(sleeping.readUInt32BE(20)).toBe(48)
    expect(sleeping[25]).toBe(6)
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
