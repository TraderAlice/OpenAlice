import type { OfficeMapLayout } from './map-layout'
import { officeOperationsBoardPosition } from './map-landmarks'
import { OFFICE_CABINET_CENTER, OFFICE_DESK_CENTERS, OFFICE_ROSTER_CENTER } from './pod-geometry'

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

  for (const pod of layout.pods) {
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
      rects.push({
        id: `roster:${pod.id}`,
        x: pod.x + OFFICE_ROSTER_CENTER.x - 18,
        y: pod.y + OFFICE_ROSTER_CENTER.y - 25,
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

export function moveAliceOnOfficeMap(
  current: { x: number; y: number },
  movement: { x: number; y: number },
  layout: OfficeMapLayout,
  collisionRects = officeCollisionRects(layout),
): OfficeMoveResult {
  const candidate = {
    x: Math.min(layout.width - 24, Math.max(24, current.x + movement.x)),
    y: Math.min(layout.height - 24, Math.max(24, current.y + movement.y)),
  }
  const obstacle = collisionRects.find((rect) => intersectsAlice(candidate, rect))
  const boundaryBump = candidate.x === current.x
    && candidate.y === current.y
    && (movement.x !== 0 || movement.y !== 0)

  if (obstacle || boundaryBump) {
    return {
      position: current,
      bumped: true,
      ...(obstacle ? { obstacleId: obstacle.id } : {}),
    }
  }
  return { position: candidate, bumped: false }
}
