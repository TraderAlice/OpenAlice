import { describe, expect, it } from 'vitest'

import { nearestOfficeInteractionTarget } from './interaction-targets'
import { layoutOfficeMap } from './map-layout'
import { moveAliceOnOfficeMap, officeCollisionRects } from './map-collision'
import { OFFICE_CABINET_CENTER, OFFICE_DESK_CENTERS } from './pod-geometry'

const layout = layoutOfficeMap([
  { id: 'chat-1', harness: 'chat' },
  { id: 'quant-1', harness: 'auto-quant' },
])

describe('Office map collision', () => {
  it('blocks the wall, desks, filing cabinets, props, and landmarks', () => {
    const ids = officeCollisionRects(layout).map((rect) => rect.id)
    expect(ids).toContain('wall')
    expect(ids).toContain('desk:chat-1:0')
    expect(ids).toContain('cabinet:chat-1')
    expect(ids).toContain('harness-prop:chat-1')
    expect(ids).toContain('landmark:plant')
    expect(ids).toContain('landmark:terminal')
  })

  it('stops Alice before a workstation while keeping its employee interactable', () => {
    const pod = layout.pods[0]!
    const desk = {
      x: pod.x + OFFICE_DESK_CENTERS[0].x,
      y: pod.y + OFFICE_DESK_CENTERS[0].y,
    }
    const current = { x: desk.x + 72, y: desk.y }
    const move = moveAliceOnOfficeMap(current, { x: -24, y: 0 }, layout)

    expect(move).toMatchObject({ position: current, bumped: true, obstacleId: 'desk:chat-1:0' })
    expect(nearestOfficeInteractionTarget(current, [{
      id: 'employee:chat-1:resume-1',
      kind: 'employee',
      ...desk,
      workspaceId: 'chat-1',
      roomName: 'Chat',
      employee: {
        resumeId: 'resume-1',
        agent: 'codex',
        name: 'c1',
        mood: 'working',
        bubble: null,
        lastSeq: 1,
        lastInteractionAt: 1,
        drawers: [],
      },
    }])?.id).toBe('employee:chat-1:resume-1')
  })

  it('stops at a cabinet within interaction range and preserves open aisles', () => {
    const pod = layout.pods[0]!
    const cabinet = {
      x: pod.x + OFFICE_CABINET_CENTER.x,
      y: pod.y + OFFICE_CABINET_CENTER.y,
    }
    const aisleMove = moveAliceOnOfficeMap(layout.alice, { x: 24, y: 0 }, layout)
    expect(aisleMove).toEqual({
      position: { x: layout.alice.x + 24, y: layout.alice.y },
      bumped: false,
    })

    const approach = moveAliceOnOfficeMap(
      { x: cabinet.x + 42, y: cabinet.y },
      { x: -24, y: 0 },
      layout,
    )
    expect(approach).toMatchObject({ bumped: true, obstacleId: 'cabinet:chat-1' })
    expect(Math.hypot(
      approach.position.x - cabinet.x,
      approach.position.y - cabinet.y,
    )).toBeLessThan(84)
  })

  it('keeps Alice on the floor below the generated wall', () => {
    const current = { x: 480, y: 144 }
    expect(moveAliceOnOfficeMap(current, { x: 0, y: -24 }, layout)).toMatchObject({
      position: current,
      bumped: true,
      obstacleId: 'wall',
    })
  })
})
