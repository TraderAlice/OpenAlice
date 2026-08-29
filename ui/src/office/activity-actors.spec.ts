import { describe, expect, it } from 'vitest'

import type { OfficeRoomSnapshot } from '../api/office'
import { officeActivityActors, officeActivityFallbackLabel } from './activity-actors'
import { OFFICE_COWORKER_SPRITES } from './coworker-sprites'

describe('Office activity actors', () => {
  it('projects the same cast and player-facing identity used by the team', () => {
    const office: OfficeRoomSnapshot = {
      workspace: { id: 'prediction-1', tag: 'prediction', harness: 'prediction' },
      lastInteractionAt: 1,
      sleeping: false,
      employees: [
        {
          resumeId: 'resume-crisp-slate-terrace-d82wad',
          agent: 'grok',
          name: 'g5',
          title: 'Roster scout two ready.',
          mood: 'idle',
          awake: false,
          bubble: null,
          lastSeq: 1,
          lastInteractionAt: 1,
          drawers: [],
        },
      ],
    }

    const actor = officeActivityActors(
      [office],
      () => 'Prediction Lab',
      new Map([[
        'resume-crisp-slate-terrace-d82wad',
        OFFICE_COWORKER_SPRITES['grok-sentinel'],
      ]]),
    )
      .get('resume-crisp-slate-terrace-d82wad')

    expect(actor).toMatchObject({
      label: 'Grok Sentinel',
      assignment: 'Roster scout two ready.',
      secondary: 'grok · g5 · Prediction Lab',
    })
    expect(actor?.asset.id).toBe('grok-sentinel')
  })

  it('turns a historical resume slug into a stable call sign', () => {
    expect(officeActivityFallbackLabel('resume-crisp-slate-terrace-d82wad', 'grok'))
      .toBe('Crisp Slate Terrace')
    expect(officeActivityFallbackLabel('019eb75e-0b1b-7fa2', 'codex')).toBe('codex agent')
  })
})
