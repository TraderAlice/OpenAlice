// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from 'vitest'

import {
  OFFICE_COWORKER_CAST_STORAGE_KEY,
  readOfficeCoworkerCasts,
  writeOfficeCoworkerCasts,
} from './coworker-cast-storage'
import { OFFICE_COWORKER_SPRITES } from './coworker-sprites'

beforeEach(() => {
  window.localStorage.clear()
})

describe('Office coworker cast storage', () => {
  it('restores Workspace-scoped resume identities as registry assets', () => {
    writeOfficeCoworkerCasts(new Map([
      ['chat-1', new Map([
        ['resume-a', OFFICE_COWORKER_SPRITES['grok-analyst']],
        ['resume-b', OFFICE_COWORKER_SPRITES['grok-architect']],
      ])],
    ]))

    const restored = readOfficeCoworkerCasts()
    expect(restored.get('chat-1')?.get('resume-a')).toBe(OFFICE_COWORKER_SPRITES['grok-analyst'])
    expect(restored.get('chat-1')?.get('resume-b')).toBe(OFFICE_COWORKER_SPRITES['grok-architect'])
  })

  it('drops obsolete records and unknown assets instead of migrating them', () => {
    window.localStorage.setItem(OFFICE_COWORKER_CAST_STORAGE_KEY, JSON.stringify({
      version: 0,
      workspaces: { 'chat-1': { 'resume-a': 'grok-analyst' } },
    }))
    expect(readOfficeCoworkerCasts().size).toBe(0)

    window.localStorage.setItem(OFFICE_COWORKER_CAST_STORAGE_KEY, JSON.stringify({
      version: 1,
      workspaces: {
        'chat-1': {
          'resume-a': 'grok-analyst',
          'resume-b': 'retired-sprite',
        },
      },
    }))
    const restored = readOfficeCoworkerCasts()
    expect(Array.from(restored.get('chat-1')?.keys() ?? [])).toEqual(['resume-a'])
  })
})
