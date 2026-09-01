import { describe, expect, it } from 'vitest'

import type { OfficeFloorEmployee } from '../api/office'
import {
  deskSlotsForOffice,
  stableDeskSlotsForOffice,
  visibleEmployeesForOffice,
} from './desk-slots'

const employee = {
  resumeId: 'resume-alice',
  agent: 'codex',
  name: 'c1',
  awake: true,
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

  it('keeps retained coworkers at their desks when one active Session joins', () => {
    const idleEmployees = ['g4', 'g3', 'g2', 'g1'].map((resumeId) => ({
      ...employee,
      resumeId,
      awake: false,
    }))
    const initial = stableDeskSlotsForOffice(idleEmployees, [], 4)
    expect(initial.map((item) => item?.resumeId)).toEqual(['g4', 'g3', 'g2', 'g1'])

    const newcomer = {
      ...employee,
      resumeId: 'g5',
      mood: 'working' as const,
    }
    const next = stableDeskSlotsForOffice(
      [newcomer, ...idleEmployees],
      initial.map((item) => item?.resumeId ?? null),
      4,
    )

    expect(next.map((item) => item?.resumeId)).toEqual(['g4', 'g3', 'g2', 'g5'])
    expect(next.filter((item) => item?.mood === 'working').map((item) => item?.resumeId))
      .toEqual(['g5'])
  })

  it('updates retained employee state without moving its seat', () => {
    const previous = ['g4', 'g3', 'g2', 'g1']
    const employees = previous.map((resumeId) => ({
      ...employee,
      resumeId,
      awake: resumeId === 'g2',
      mood: resumeId === 'g2' ? 'review' as const : 'idle' as const,
    }))

    const slots = stableDeskSlotsForOffice(employees, previous, 4)

    expect(slots.map((item) => item?.resumeId)).toEqual(previous)
    expect(slots[2]?.mood).toBe('review')
    expect(slots[2]?.awake).toBe(true)
  })

  it('temporarily seats a hidden replay target without changing the desk count', () => {
    const employees = ['g4', 'g3', 'g2', 'g1', 'g0'].map((resumeId) => ({
      ...employee,
      resumeId,
      awake: false,
    }))
    const slots = stableDeskSlotsForOffice(employees, ['g4', 'g3', 'g2', 'g1'], 4, 'g0')

    expect(slots.map((item) => item?.resumeId)).toEqual(['g4', 'g3', 'g2', 'g0'])
    expect(visibleEmployeesForOffice(employees, 4, 'g0').map((item) => item.resumeId))
      .toEqual(['g4', 'g3', 'g2', 'g0'])
  })
})
