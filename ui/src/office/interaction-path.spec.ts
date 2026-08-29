import { describe, expect, it } from 'vitest'

import { officeInteractionPath } from './interaction-path'
import {
  nearestOfficeInteractionTarget,
  type OfficeInteractionTarget,
} from './interaction-targets'
import { officeCollisionRects } from './map-collision'
import { layoutOfficeMap } from './map-layout'
import { officeServiceLandmarks } from './map-landmarks'

const employee: OfficeInteractionTarget = {
  id: 'employee:chat-1:resume-1',
  kind: 'employee',
  x: 258,
  y: 337,
  workspaceId: 'chat-1',
  roomName: 'Chat',
  employee: {
    resumeId: 'resume-1',
    agent: 'codex',
    name: 'c1',
    awake: true,
    mood: 'working',
    bubble: null,
    lastSeq: 1,
    lastInteractionAt: 1,
    drawers: [],
  },
}

describe('Office interaction path', () => {
  it('finds a shortest collision-safe tile path and faces the target', () => {
    const layout = layoutOfficeMap([
      { id: 'chat-1', harness: 'chat' },
      { id: 'quant-1', harness: 'auto-quant' },
    ])
    const path = officeInteractionPath(
      layout.alice,
      employee,
      layout,
      officeCollisionRects(layout),
    )

    expect(path).not.toBeNull()
    expect(path!.steps.length).toBeGreaterThan(0)
    const destination = path!.steps.at(-1)!
    expect(nearestOfficeInteractionTarget(destination, path!.facing, [employee])?.id)
      .toBe(employee.id)
  })

  it('returns a facing-only route when Alice can already interact', () => {
    const layout = layoutOfficeMap([{ id: 'chat-1', harness: 'chat' }])
    const path = officeInteractionPath(
      { x: employee.x + 48, y: employee.y },
      employee,
      layout,
      [],
    )

    expect(path).toEqual({ steps: [], facing: 'left' })
  })

  it('joins a diagonal-movement position back onto the 24px route grid', () => {
    const layout = layoutOfficeMap([
      { id: 'chat-1', harness: 'chat' },
      { id: 'quant-1', harness: 'auto-quant' },
    ])
    const path = officeInteractionPath(
      { x: layout.alice.x + 17, y: layout.alice.y + 1 },
      employee,
      layout,
      officeCollisionRects(layout),
    )

    expect(path).not.toBeNull()
    expect(path!.steps[0]).toMatchObject({ x: 504, y: 360 })
    expect(path!.steps.every(({ x, y }) => x % 24 === 0 && y % 24 === 0)).toBe(true)
  })

  it('returns null when the target is sealed away', () => {
    const layout = layoutOfficeMap([{ id: 'chat-1', harness: 'chat' }])
    const path = officeInteractionPath(
      layout.alice,
      employee,
      layout,
      [{ id: 'sealed', x: 0, y: 112, width: layout.width, height: layout.height - 112 }],
    )

    expect(path).toBeNull()
  })

  it('keeps the reserved service cell reachable on a dense full floor', () => {
    const layout = layoutOfficeMap(Array.from({ length: 18 }, (_, index) => ({
      id: `workspace-${index}`,
      harness: 'chat' as const,
    })))
    const inbox = officeServiceLandmarks(layout)[0]!
    const target: OfficeInteractionTarget = {
      id: 'inbox-service',
      kind: 'inbox-service',
      x: inbox.x + Math.round(inbox.width / 2),
      y: inbox.y + inbox.collision.y + Math.round(inbox.collision.height / 2),
    }
    const path = officeInteractionPath(
      layout.alice,
      target,
      layout,
      officeCollisionRects(layout),
    )

    expect(path).not.toBeNull()
    expect(path!.steps.length).toBeGreaterThan(20)
    const destination = path!.steps.at(-1)!
    expect(nearestOfficeInteractionTarget(destination, path!.facing, [target])?.id)
      .toBe('inbox-service')
  })
})
