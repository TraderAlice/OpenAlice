import { describe, expect, it } from 'vitest'

import { officeInteractionPath } from './interaction-path'
import {
  nearestOfficeInteractionTarget,
  type OfficeInteractionTarget,
} from './interaction-targets'
import { officeCollisionRects } from './map-collision'
import { layoutOfficeMap } from './map-layout'

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
})
