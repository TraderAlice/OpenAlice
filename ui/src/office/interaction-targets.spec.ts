import { describe, expect, it } from 'vitest'

import type { OfficeRoomSnapshot } from '../api/office'
import {
  nearestOfficeInteractionTarget,
  officeCameraFollowingAlice,
  officeInteractionTargets,
} from './interaction-targets'
import { layoutOfficeMap } from './map-layout'

const group: OfficeRoomSnapshot = {
  workspace: { id: 'chat-1', tag: 'chat', harness: 'chat' },
  lastInteractionAt: 1,
  sleeping: false,
  employees: [{
    resumeId: 'resume-1',
    agent: 'codex',
    name: 'c1',
    mood: 'working',
    bubble: null,
    lastSeq: 1,
    lastInteractionAt: 1,
    drawers: [],
  }],
}

describe('Office interaction targets', () => {
  it('projects employee desks and cabinets into shared map coordinates', () => {
    const layout = layoutOfficeMap([{ id: 'chat-1', harness: 'chat' }])
    const targets = officeInteractionTargets([group], layout, (_id, tag) => tag)
    const employee = targets.find((target) => target.kind === 'employee')
    const cabinet = targets.find((target) => target.kind === 'cabinet')

    expect(employee).toMatchObject({
      id: 'employee:chat-1:resume-1',
      x: layout.pods[0]!.x + 90,
      y: layout.pods[0]!.y + 97,
    })
    expect(cabinet).toMatchObject({
      id: 'cabinet:chat-1',
      x: layout.pods[0]!.x + 270,
      y: layout.pods[0]!.y + 187,
    })
    expect(nearestOfficeInteractionTarget(
      { x: employee!.x + 24, y: employee!.y },
      'left',
      targets,
    )?.id).toBe(employee?.id)
    expect(nearestOfficeInteractionTarget({ x: 0, y: 0 }, 'down', targets)).toBeNull()
  })

  it('selects only an object in Alice’s facing cone', () => {
    const targets = [
      {
        id: 'cabinet:up',
        kind: 'cabinet' as const,
        x: 0,
        y: -48,
        workspaceId: 'up',
        roomName: 'Up',
      },
      {
        id: 'cabinet:down',
        kind: 'cabinet' as const,
        x: 0,
        y: 48,
        workspaceId: 'down',
        roomName: 'Down',
      },
      {
        id: 'cabinet:side',
        kind: 'cabinet' as const,
        x: 58,
        y: 10,
        workspaceId: 'side',
        roomName: 'Side',
      },
    ]

    expect(nearestOfficeInteractionTarget({ x: 0, y: 0 }, 'up', targets)?.id)
      .toBe('cabinet:up')
    expect(nearestOfficeInteractionTarget({ x: 0, y: 0 }, 'down', targets)?.id)
      .toBe('cabinet:down')
    expect(nearestOfficeInteractionTarget({ x: 0, y: 0 }, 'right', targets)?.id)
      .toBe('cabinet:side')
    expect(nearestOfficeInteractionTarget({ x: 0, y: 0 }, 'left', targets)).toBeNull()
  })

  it('keeps Alice inside the camera safe area without escaping map bounds', () => {
    expect(officeCameraFollowingAlice(
      { x: 900, y: 620 },
      { x: 0, y: 0 },
      { width: 640, height: 420 },
      { width: 1200, height: 900 },
    )).toEqual({ x: -356, y: -296 })
    expect(officeCameraFollowingAlice(
      { x: 24, y: 24 },
      { x: -560, y: -480 },
      { width: 640, height: 420 },
      { width: 1200, height: 900 },
    )).toEqual({ x: 0, y: 0 })
  })

  it('adds a roster target only when a group exceeds the visible desk count', () => {
    const layout = layoutOfficeMap([{ id: 'chat-1', harness: 'chat' }])
    const crowded = {
      ...group,
      employees: Array.from({ length: 5 }, (_, index) => ({
        ...group.employees[0]!,
        resumeId: `resume-${index}`,
      })),
    }

    expect(officeInteractionTargets([group], layout, (_id, tag) => tag)
      .some((target) => target.kind === 'roster')).toBe(false)
    expect(officeInteractionTargets([crowded], layout, (_id, tag) => tag))
      .toContainEqual(expect.objectContaining({
        id: 'roster:chat-1',
        kind: 'roster',
        x: layout.pods[0]!.x + 270,
        y: layout.pods[0]!.y + 83,
      }))
  })
})
