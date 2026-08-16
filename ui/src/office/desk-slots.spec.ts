import { describe, expect, it } from 'vitest'

import type { OfficeFloorEmployee } from '../api/office'
import { deskSlotsForOffice } from './desk-slots'

const employee = {
  resumeId: 'resume-alice',
  agent: 'codex',
  name: 'c1',
  mood: 'idle',
  bubble: null,
  lastSeq: 0,
  lastInteractionAt: 0,
  drawers: [],
} as OfficeFloorEmployee

describe('deskSlotsForOffice', () => {
  it('pads a bay to vacant seats so the room still reads as an office', () => {
    expect(deskSlotsForOffice([employee])).toHaveLength(2)
    expect(deskSlotsForOffice([employee])[0]?.resumeId).toBe('resume-alice')
    expect(deskSlotsForOffice([employee, employee, employee, employee])).toHaveLength(4)
  })
})
