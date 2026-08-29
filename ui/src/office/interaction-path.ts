import {
  nearestOfficeInteractionTarget,
  type OfficeFacingDirection,
  type OfficeInteractionTarget,
} from './interaction-targets'
import {
  isOfficePositionWalkable,
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
const OFFICE_ROUTE_GRID_SIZE = 24
const OFFICE_ROUTE_ENTRY_SAMPLE = 4

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

function directionBetween(
  start: { x: number; y: number },
  end: { x: number; y: number },
): OfficeFacingDirection {
  const dx = end.x - start.x
  const dy = end.y - start.y
  if (Math.abs(dx) >= Math.abs(dy)) return dx < 0 ? 'left' : 'right'
  return dy < 0 ? 'up' : 'down'
}

function routeGridEntry(
  start: { x: number; y: number },
  layout: OfficeMapLayout,
  collisionRects: readonly OfficeCollisionRect[],
): OfficeInteractionPathStep | null {
  if (start.x % OFFICE_ROUTE_GRID_SIZE === 0 && start.y % OFFICE_ROUTE_GRID_SIZE === 0) {
    return null
  }

  const gridValues = (value: number) => Array.from(new Set([
    Math.round(value / OFFICE_ROUTE_GRID_SIZE) * OFFICE_ROUTE_GRID_SIZE,
    Math.floor(value / OFFICE_ROUTE_GRID_SIZE) * OFFICE_ROUTE_GRID_SIZE,
    Math.ceil(value / OFFICE_ROUTE_GRID_SIZE) * OFFICE_ROUTE_GRID_SIZE,
  ]))
  const candidates = gridValues(start.x).flatMap((x) => (
    gridValues(start.y).map((y) => ({ x, y }))
  )).sort((left, right) => (
    (left.x - start.x) ** 2 + (left.y - start.y) ** 2
    - ((right.x - start.x) ** 2 + (right.y - start.y) ** 2)
  ))

  const candidate = candidates.find((position) => {
    const distance = Math.max(Math.abs(position.x - start.x), Math.abs(position.y - start.y))
    const samples = Math.max(1, Math.ceil(distance / OFFICE_ROUTE_ENTRY_SAMPLE))
    return Array.from({ length: samples }, (_, index) => {
      const progress = (index + 1) / samples
      return {
        x: Math.round(start.x + (position.x - start.x) * progress),
        y: Math.round(start.y + (position.y - start.y) * progress),
      }
    }).every((sample) => isOfficePositionWalkable(sample, layout, collisionRects))
  })
  return candidate ? { ...candidate, direction: directionBetween(start, candidate) } : null
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
  const currentFacing = facingTarget(start, target)
  if (currentFacing) return { steps: [], facing: currentFacing }

  const gridEntry = routeGridEntry(start, layout, collisionRects)
  const routeStart = gridEntry ? { x: gridEntry.x, y: gridEntry.y } : start
  const startKey = positionKey(routeStart)
  const queue = [{ ...routeStart }]
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
      return { steps: gridEntry ? [gridEntry, ...steps] : steps, facing }
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
