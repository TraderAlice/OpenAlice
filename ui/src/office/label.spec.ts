import { describe, expect, it } from 'vitest'

import { OFFICE_COWORKER_SPRITES } from './coworker-sprites'
import {
  officeCoworkerAssignment,
  officeCoworkerCallsign,
  officeCoworkerLabel,
  officeCoworkerStatusKey,
} from './label'

describe('officeCoworkerLabel', () => {
  it('prefers displayName, then title, then the sticky name', () => {
    expect(officeCoworkerLabel({ name: 'c1', title: 'Desk mate', displayName: 'AAPL desk' }))
      .toBe('AAPL desk')
    expect(officeCoworkerLabel({ name: 'c1', title: 'Desk mate' })).toBe('Desk mate')
    expect(officeCoworkerLabel({ name: 'c1' })).toBe('c1')
  })

  it('separates a stable coworker callsign from the current assignment', () => {
    const employee = {
      agent: 'grok',
      resumeId: 'resume-a',
      name: 'g6',
      title: 'Investigate the long-running market question in detail.',
    }
    expect(officeCoworkerCallsign(employee, OFFICE_COWORKER_SPRITES['grok-architect']))
      .toBe('Grok Architect')
    expect(officeCoworkerAssignment(employee)).toBe(employee.title)
    expect(officeCoworkerCallsign({ ...employee, displayName: 'Mina' }, OFFICE_COWORKER_SPRITES['grok-architect']))
      .toBe('Mina')
  })

  it('keeps actionable failure, waiting, and fresh-result states visible after power-down', () => {
    expect(officeCoworkerStatusKey({ awake: false, mood: 'idle' })).toBe('office.power.asleep')
    expect(officeCoworkerStatusKey({ awake: false, mood: 'review' })).toBe('office.mood.review')
    expect(officeCoworkerStatusKey({ awake: false, mood: 'failed' })).toBe('office.mood.failed')
    expect(officeCoworkerStatusKey({ awake: false, mood: 'waiting' })).toBe('office.mood.waiting')
    expect(officeCoworkerStatusKey({ awake: true, mood: 'working' })).toBe('office.mood.working')
  })
})
