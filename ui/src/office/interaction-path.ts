import {
  nearestOfficeInteractionTarget,
  type OfficeFacingDirection,
  type OfficeInteractionTarget,
} from './interaction-targets'
import {
  moveAliceOnOfficeMap,
  type OfficeCollisionRect,
} from './map-collision'
import type { OfficeMapLayout } from './map-layout'

const DIRECTIONS = [
  { direction: 'up' as const, x: 0, y: -24 },
  { direction: 'right' as const, x: 24, y: 0 },
  { direction: 'down' as const, x: 0, y: 24 },
  { direction: 'left' as const, x: -24, y: 0 },
]

export interface OfficeInteractionPathStep {
  x: number
  y: number
  direction: OfficeFacingDirection
}

export interface OfficeInteractionPath {
  steps: OfficeInteractionPathStep[]
  facing: OfficeFacingDirection
}

function positionKey(position: { x: number; y: number }): string {
  return `${position.x}:${position.y}`
}

function facingTarget(
  position: { x: number; y: number },
  target: OfficeInteractionTarget,
): OfficeFacingDirection | null {
  const preferred = [...DIRECTIONS].sort((left, right) => {
    const leftForward = (target.x - position.x) * left.x + (target.y - position.y) * left.y
    const rightForward = (target.x - position.x) * right.x + (target.y - position.y) * right.y
    return rightForward - leftForward
  })
  return preferred.find(({ direction }) => (
    nearestOfficeInteractionTarget(position, direction, [target])?.id === target.id
  ))?.direction ?? null
}

export function officeInteractionPath(
  start: { x: number; y: number },
  target: OfficeInteractionTarget,
  layout: OfficeMapLayout,
  collisionRects: readonly OfficeCollisionRect[],
): OfficeInteractionPath | null {
  const startKey = positionKey(start)
  const queue = [{ ...start }]
  const visited = new Set([startKey])
  const parents = new Map<string, {
    previous: string
    step: OfficeInteractionPathStep
  }>()

  for (let index = 0; index < queue.length; index += 1) {
    const current = queue[index]!
    const facing = facingTarget(current, target)
    if (facing) {
      const steps: OfficeInteractionPathStep[] = []
      let cursor = positionKey(current)
      while (cursor !== startKey) {
        const parent = parents.get(cursor)
        if (!parent) return null
        steps.unshift(parent.step)
        cursor = parent.previous
      }
      return { steps, facing }
    }

    const directions = [...DIRECTIONS].sort((left, right) => {
      const leftDistance = Math.abs(target.x - (current.x + left.x))
        + Math.abs(target.y - (current.y + left.y))
      const rightDistance = Math.abs(target.x - (current.x + right.x))
        + Math.abs(target.y - (current.y + right.y))
      return leftDistance - rightDistance
    })

    for (const movement of directions) {
      const move = moveAliceOnOfficeMap(current, movement, layout, collisionRects)
      if (move.bumped) continue
      const key = positionKey(move.position)
      if (visited.has(key)) continue
      visited.add(key)
      const step = { ...move.position, direction: movement.direction }
      parents.set(key, { previous: positionKey(current), step })
      queue.push(move.position)
    }
  }

  return null
}
