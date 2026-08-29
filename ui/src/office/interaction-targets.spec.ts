import { describe, expect, it } from 'vitest'

import type { OfficeRoomSnapshot } from '../api/office'
import {
  OFFICE_INTERACTION_RADIUS,
  clampOfficeCamera,
  nearestOfficeInteractionTarget,
  officeCameraCenteredOn,
  officeCameraFollowingAlice,
  officeInteractionTargets,
} from './interaction-targets'
import { layoutOfficeMap } from './map-layout'
import { officeRosterCenter } from './pod-geometry'

const group: OfficeRoomSnapshot = {
  workspace: { id: 'chat-1', tag: 'chat', harness: 'chat' },
  lastInteractionAt: 1,
  sleeping: false,
  employees: [{
    resumeId: 'resume-1',
    agent: 'codex',
    name: 'c1',
    awake: true,
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
    const sign = targets.find((target) => target.kind === 'sign')
    const employee = targets.find((target) => target.kind === 'employee')
    const cabinet = targets.find((target) => target.kind === 'cabinet')
    const operations = targets.find((target) => target.kind === 'operations')
    const floorTerminal = targets.find((target) => target.kind === 'floor-terminal')
    const inboxService = targets.find((target) => target.kind === 'inbox-service')
    const newsService = targets.find((target) => target.kind === 'news-service')

    expect(sign).toMatchObject({
      id: 'sign:chat-1',
      harness: 'chat',
      x: layout.pods[0]!.x + 144,
      y: layout.pods[0]!.y + 32,
    })
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
    expect(operations).toEqual({
      id: 'operations',
      kind: 'operations',
      x: layout.width / 2,
      y: 204,
    })
    expect(floorTerminal).toEqual({
      id: 'floor-terminal',
      kind: 'floor-terminal',
      x: layout.width - 80,
      y: 164,
    })
    expect(inboxService).toMatchObject({ id: 'inbox-service', kind: 'inbox-service' })
    expect(newsService).toMatchObject({ id: 'news-service', kind: 'news-service' })
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

  it('starts outside interaction range but keeps every object reachable from a safe approach', () => {
    const twoGroupLayout = layoutOfficeMap([
      { id: 'chat-1', harness: 'chat' },
      { id: 'quant-1', harness: 'auto-quant' },
    ])
    const quantGroup: OfficeRoomSnapshot = {
      ...group,
      workspace: { id: 'quant-1', tag: 'quant', harness: 'auto-quant' },
      employees: [],
    }
    const projected = officeInteractionTargets(
      [group, quantGroup],
      twoGroupLayout,
      (_id, tag) => tag,
    )

    expect(OFFICE_INTERACTION_RADIUS).toBe(72)
    expect(nearestOfficeInteractionTarget(twoGroupLayout.alice, 'down', projected)).toBeNull()

    const safeApproaches = [
      {
        id: 'employee',
        target: {
          id: 'employee:test',
          kind: 'employee' as const,
          x: 0,
          y: 0,
          workspaceId: 'test',
          roomName: 'Test',
          employee: group.employees[0]!,
        },
      },
      {
        id: 'cabinet',
        target: {
          id: 'cabinet:test',
          kind: 'cabinet' as const,
          x: 0,
          y: 0,
          workspaceId: 'test',
          roomName: 'Test',
        },
      },
      {
        id: 'roster',
        target: {
          id: 'roster:test',
          kind: 'roster' as const,
          x: 0,
          y: 0,
          workspaceId: 'test',
          roomName: 'Test',
        },
      },
      {
        id: 'operations',
        target: { id: 'operations' as const, kind: 'operations' as const, x: 0, y: 0 },
      },
      {
        id: 'floor-terminal',
        target: { id: 'floor-terminal' as const, kind: 'floor-terminal' as const, x: 0, y: 0 },
      },
    ]

    for (const { id, target } of safeApproaches) {
      expect(nearestOfficeInteractionTarget({ x: 0, y: 64 }, 'up', [target])?.kind)
        .toBe(id)
    }
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

  it('centers a fixed map on axes larger than the world', () => {
    expect(clampOfficeCamera(
      { x: -80, y: 12 },
      { width: 1200, height: 800 },
      { width: 960, height: 672 },
    )).toEqual({ x: 120, y: 64 })
    expect(clampOfficeCamera(
      { x: -80, y: -900 },
      { width: 1200, height: 420 },
      { width: 960, height: 900 },
    )).toEqual({ x: 120, y: -480 })

    expect(officeCameraFollowingAlice(
      { x: 480, y: 336 },
      { x: 0, y: 0 },
      { width: 1200, height: 800 },
      { width: 960, height: 672 },
    )).toEqual({ x: 120, y: 64 })
  })

  it('centers Alice in a short landscape viewport', () => {
    expect(officeCameraCenteredOn(
      { x: 480, y: 336 },
      { width: 750, height: 272 },
      { width: 960, height: 672 },
    )).toEqual({ x: -105, y: -200 })
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

  it('places roster boards in the outer aisle instead of under Operations', () => {
    const layout = layoutOfficeMap([
      { id: 'chat-left', harness: 'chat' },
      { id: 'chat-right', harness: 'chat' },
    ])
    const left = officeRosterCenter(layout.pods[0]!, layout.width)
    const right = officeRosterCenter(layout.pods[1]!, layout.width)

    expect(left).toEqual({ x: 18, y: 83, side: 'left' })
    expect(right).toEqual({ x: 270, y: 83, side: 'right' })
    expect(layout.pods[0]!.x + left.x).toBeLessThan(layout.width / 2 - 88)
    expect(layout.pods[1]!.x + right.x).toBeGreaterThan(layout.width / 2 + 88)
  })
})
