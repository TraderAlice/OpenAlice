import { describe, expect, it } from 'vitest'

import type { OfficeFloorEmployee } from '../api/office'
import { deskSlotsForOffice, visibleEmployeesForOffice } from './desk-slots'

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

  it('keeps active employees in the four rendered and interactive seats first', () => {
    const employees = [
      employee,
      { ...employee, resumeId: 'active-1', mood: 'working' as const },
      { ...employee, resumeId: 'active-2', mood: 'talking' as const },
      { ...employee, resumeId: 'active-3', mood: 'review' as const },
      { ...employee, resumeId: 'active-4', mood: 'waiting' as const },
    ]
    expect(visibleEmployeesForOffice(employees).map((item) => item.resumeId)).toEqual([
      'active-1',
      'active-2',
      'active-3',
      'active-4',
    ])
  })
})
