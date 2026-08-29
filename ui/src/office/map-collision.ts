import type { OfficeMapLayout } from './map-layout'
import { officeOperationsBoardPosition, officeServiceLandmarks } from './map-landmarks'
import {
  OFFICE_CABINET_CENTER,
  OFFICE_DESK_CENTERS,
  OFFICE_SIGN_CENTER,
  officeRosterCenter,
} from './pod-geometry'

export const OFFICE_WALL_FLOOR_EDGE = 112
export const OFFICE_ALICE_HALF_WIDTH = 10
export const OFFICE_ALICE_HALF_HEIGHT = 12

export interface OfficeCollisionRect {
  id: string
  x: number
  y: number
  width: number
  height: number
}

export interface OfficeMoveResult {
  position: { x: number; y: number }
  bumped: boolean
  obstacleId?: string
}

export function officeCollisionRects(
  layout: OfficeMapLayout,
  rosterWorkspaceIds: ReadonlySet<string> = new Set(),
): OfficeCollisionRect[] {
  const operations = officeOperationsBoardPosition(layout.width)
  const rects: OfficeCollisionRect[] = [
    { id: 'wall', x: 0, y: 0, width: layout.width, height: OFFICE_WALL_FLOOR_EDGE },
    { id: 'landmark:plant', x: 62, y: 150, width: 42, height: 28 },
    { id: 'landmark:terminal', x: layout.width - 100, y: 145, width: 42, height: 38 },
    {
      id: 'operations',
      x: operations.x - 68,
      y: operations.y - 34,
      width: 136,
      height: 69,
    },
  ]

  for (const landmark of officeServiceLandmarks(layout)) {
    rects.push({
      id: `landmark:${landmark.id}`,
      x: landmark.x + landmark.collision.x,
      y: landmark.y + landmark.collision.y,
      width: landmark.collision.width,
      height: landmark.collision.height,
    })
  }

  for (const pod of layout.pods) {
    rects.push({
      id: `sign:${pod.id}`,
      x: pod.x + OFFICE_SIGN_CENTER.x - 126,
      y: pod.y + OFFICE_SIGN_CENTER.y - 22,
      width: 252,
      height: 44,
    })
    OFFICE_DESK_CENTERS.forEach((center, index) => {
      rects.push({
        id: `desk:${pod.id}:${index}`,
        x: pod.x + center.x - 42,
        y: pod.y + center.y - 25,
        width: 84,
        height: 50,
      })
    })
    rects.push({
      id: `cabinet:${pod.id}`,
      x: pod.x + OFFICE_CABINET_CENTER.x - 18,
      y: pod.y + OFFICE_CABINET_CENTER.y - 24,
      width: 36,
      height: 48,
    })
    if (rosterWorkspaceIds.has(pod.id)) {
      const rosterCenter = officeRosterCenter(pod, layout.width)
      rects.push({
        id: `roster:${pod.id}`,
        x: pod.x + rosterCenter.x - 18,
        y: pod.y + rosterCenter.y - 25,
        width: 36,
        height: 50,
      })
    }
    rects.push({
      id: `harness-prop:${pod.id}`,
      x: pod.x,
      y: pod.y + 178,
      width: pod.harness === 'chat' ? 62 : 52,
      height: 32,
    })
  }

  return rects
}

function intersectsAlice(
  position: { x: number; y: number },
  rect: OfficeCollisionRect,
): boolean {
  return position.x + OFFICE_ALICE_HALF_WIDTH > rect.x
    && position.x - OFFICE_ALICE_HALF_WIDTH < rect.x + rect.width
    && position.y + OFFICE_ALICE_HALF_HEIGHT > rect.y
    && position.y - OFFICE_ALICE_HALF_HEIGHT < rect.y + rect.height
}

export function isOfficePositionWalkable(
  position: { x: number; y: number },
  layout: OfficeMapLayout,
  collisionRects: readonly OfficeCollisionRect[] = officeCollisionRects(layout),
): boolean {
  return position.x >= 24
    && position.x <= layout.width - 24
    && position.y >= 24
    && position.y <= layout.height - 24
    && !collisionRects.some((rect) => intersectsAlice(position, rect))
}

export function moveAliceOnOfficeMap(
  current: { x: number; y: number },
  movement: { x: number; y: number },
  layout: OfficeMapLayout,
  collisionRects: readonly OfficeCollisionRect[] = officeCollisionRects(layout),
): OfficeMoveResult {
  const candidateFor = (step: { x: number; y: number }) => ({
    x: Math.min(layout.width - 24, Math.max(24, current.x + step.x)),
    y: Math.min(layout.height - 24, Math.max(24, current.y + step.y)),
  })
  const candidate = candidateFor(movement)
  const obstacle = collisionRects.find((rect) => intersectsAlice(candidate, rect))
  const boundaryBump = candidate.x === current.x
    && candidate.y === current.y
    && (movement.x !== 0 || movement.y !== 0)

  if (obstacle && movement.x !== 0 && movement.y !== 0) {
    for (const axis of [{ x: movement.x, y: 0 }, { x: 0, y: movement.y }]) {
      const slide = candidateFor(axis)
      const stationary = slide.x === current.x && slide.y === current.y
      if (!stationary && !collisionRects.some((rect) => intersectsAlice(slide, rect))) {
        return { position: slide, bumped: false }
      }
    }
  }

  if (obstacle || boundaryBump) {
    return {
      position: current,
      bumped: true,
      ...(obstacle ? { obstacleId: obstacle.id } : {}),
    }
  }
  return { position: candidate, bumped: false }
}
