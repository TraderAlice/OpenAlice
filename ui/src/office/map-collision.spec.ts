import { describe, expect, it } from 'vitest'

import { nearestOfficeInteractionTarget } from './interaction-targets'
import { layoutOfficeMap } from './map-layout'
import {
  isOfficePositionWalkable,
  moveAliceOnOfficeMap,
  officeCollisionRects,
} from './map-collision'
import { OFFICE_CABINET_CENTER, OFFICE_DESK_CENTERS } from './pod-geometry'

const layout = layoutOfficeMap([
  { id: 'chat-1', harness: 'chat' },
  { id: 'quant-1', harness: 'auto-quant' },
])

describe('Office map collision', () => {
  it('accepts remembered floor positions only inside walkable map space', () => {
    const openFloor = { x: layout.alice.x, y: layout.alice.y + 48 }
    const desk = layout.pods[0]!

    expect(isOfficePositionWalkable(openFloor, layout)).toBe(true)
    expect(isOfficePositionWalkable({ x: 0, y: openFloor.y }, layout)).toBe(false)
    expect(isOfficePositionWalkable({
      x: desk.x + OFFICE_DESK_CENTERS[0].x,
      y: desk.y + OFFICE_DESK_CENTERS[0].y,
    }, layout)).toBe(false)
  })

  it('blocks the wall, desks, filing cabinets, props, and landmarks', () => {
    const ids = officeCollisionRects(layout).map((rect) => rect.id)
    expect(ids).toContain('wall')
    expect(ids).toContain('sign:chat-1')
    expect(ids).toContain('desk:chat-1:0')
    expect(ids).toContain('cabinet:chat-1')
    expect(ids).toContain('harness-prop:chat-1')
    expect(ids).toContain('landmark:plant')
    expect(ids).toContain('landmark:terminal')
    expect(ids).toContain('landmark:inbox-service')
    expect(ids).toContain('landmark:news-service')
    expect(ids).toContain('operations')
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
    expect(nearestOfficeInteractionTarget(current, 'left', [{
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

  it('slides along a free axis when a diagonal step meets a corner', () => {
    const current = { x: 100, y: 100 }
    const move = moveAliceOnOfficeMap(current, { x: 17, y: 17 }, layout, [{
      id: 'corner',
      x: 114,
      y: 114,
      width: 20,
      height: 20,
    }])

    expect(move).toEqual({ position: { x: 117, y: 100 }, bumped: false })
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

  it('stops Alice at the operations board while keeping its log interaction in range', () => {
    const current = { x: layout.width / 2, y: 264 }
    expect(moveAliceOnOfficeMap(current, { x: 0, y: -24 }, layout)).toMatchObject({
      position: current,
      bumped: true,
      obstacleId: 'operations',
    })
    expect(nearestOfficeInteractionTarget(current, 'up', [{
      id: 'operations',
      kind: 'operations',
      x: layout.width / 2,
      y: 204,
    }])?.id).toBe('operations')
  })

  it('adds collision only for roster boards that exist on the map', () => {
    expect(officeCollisionRects(layout).map((rect) => rect.id)).not.toContain('roster:chat-1')
    expect(officeCollisionRects(layout, new Set(['chat-1'])).map((rect) => rect.id))
      .toContain('roster:chat-1')
  })

  it('turns a partial final row into a collidable service bay', () => {
    const partialLayout = layoutOfficeMap(Array.from({ length: 3 }, (_, index) => ({
      id: `workspace-${index}`,
      harness: 'chat' as const,
    })))
    expect(partialLayout).toMatchObject({ columns: 2, rows: 2 })
    const ids = officeCollisionRects(partialLayout).map((rect) => rect.id)
    expect(ids).toContain('landmark:inbox-service')
    expect(ids).toContain('landmark:news-service')
  })

  it('reserves collidable services after complete multi-row Workspace floors', () => {
    const completeLayout = layoutOfficeMap(Array.from({ length: 4 }, (_, index) => ({
      id: `workspace-${index}`,
      harness: 'chat' as const,
    })))
    expect(completeLayout).toMatchObject({ columns: 2, rows: 3 })
    const ids = officeCollisionRects(completeLayout).map((rect) => rect.id)
    expect(ids).toContain('landmark:inbox-service')
    expect(ids).toContain('landmark:news-service')
  })
})
