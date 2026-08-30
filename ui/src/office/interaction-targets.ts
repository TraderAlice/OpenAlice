import type { OfficeFloorEmployee, OfficeHarness, OfficeRoomSnapshot } from '../api/office'
import type { OfficeMapLayout } from './map-layout'
import { visibleEmployeesForOffice } from './desk-slots'
import {
  officeFloorTerminalPosition,
  officeOperationsBoardPosition,
  officeServiceLandmarks,
} from './map-landmarks'
import {
  OFFICE_CABINET_CENTER,
  OFFICE_DESK_CENTERS,
  OFFICE_SIGN_CENTER,
  officeRosterCenter,
} from './pod-geometry'

export const OFFICE_INTERACTION_RADIUS = 72
export const OFFICE_INTERACTION_SIDE_REACH = 52
export const OFFICE_INTERACTION_MIN_SIDE_REACH = 18
export const OFFICE_INTERACTION_BACK_REACH = 8

export type OfficeFacingDirection = 'up' | 'right' | 'down' | 'left'

function requiredApproachFacing(
  target: OfficeInteractionTarget,
): OfficeFacingDirection | null {
  return target.kind === 'inbox-service' || target.kind === 'news-service'
    ? 'up'
    : null
}

export type OfficeInteractionTarget =
  | {
    id: string
    kind: 'sign'
    x: number
    y: number
    workspaceId: string
    roomName: string
    harness: OfficeHarness
  }
  | {
    id: string
    kind: 'employee'
    x: number
    y: number
    workspaceId: string
    roomName: string
    employee: OfficeFloorEmployee
  }
  | {
    id: string
    kind: 'cabinet'
    x: number
    y: number
    workspaceId: string
    roomName: string
  }
  | {
    id: string
    kind: 'roster'
    x: number
    y: number
    workspaceId: string
    roomName: string
    additionalCount: number
  }
  | {
    id: 'operations'
    kind: 'operations'
    x: number
    y: number
  }
  | {
    id: 'floor-terminal'
    kind: 'floor-terminal'
    x: number
    y: number
  }
  | {
    id: 'inbox-service'
    kind: 'inbox-service'
    x: number
    y: number
  }
  | {
    id: 'news-service'
    kind: 'news-service'
    x: number
    y: number
  }

export function officeInteractionTargets(
  groups: readonly OfficeRoomSnapshot[],
  layout: OfficeMapLayout,
  groupTitle: (workspaceId: string, tag: string) => string,
): OfficeInteractionTarget[] {
  const groupsById = new Map(groups.map((group) => [group.workspace.id, group]))
  const targets: OfficeInteractionTarget[] = []

  for (const pod of layout.pods) {
    const group = groupsById.get(pod.id)
    if (!group) continue
    const roomName = groupTitle(group.workspace.id, group.workspace.tag)
    targets.push({
      id: `sign:${group.workspace.id}`,
      kind: 'sign',
      x: pod.x + OFFICE_SIGN_CENTER.x,
      y: pod.y + OFFICE_SIGN_CENTER.y,
      workspaceId: group.workspace.id,
      roomName,
      harness: group.workspace.harness,
    })
    visibleEmployeesForOffice(group.employees).forEach((employee, index) => {
      const center = OFFICE_DESK_CENTERS[index]
      if (!center) return
      targets.push({
        id: `employee:${group.workspace.id}:${employee.resumeId}`,
        kind: 'employee',
        x: pod.x + center.x,
        y: pod.y + center.y,
        workspaceId: group.workspace.id,
        roomName,
        employee,
      })
    })
    targets.push({
      id: `cabinet:${group.workspace.id}`,
      kind: 'cabinet',
      x: pod.x + OFFICE_CABINET_CENTER.x,
      y: pod.y + OFFICE_CABINET_CENTER.y,
      workspaceId: group.workspace.id,
      roomName,
    })
    if (group.employees.length > 4) {
      const rosterCenter = officeRosterCenter(pod, layout.width)
      targets.push({
        id: `roster:${group.workspace.id}`,
        kind: 'roster',
        x: pod.x + rosterCenter.x,
        y: pod.y + rosterCenter.y,
        workspaceId: group.workspace.id,
        roomName,
        additionalCount: group.employees.length - visibleEmployeesForOffice(group.employees).length,
      })
    }
  }

  targets.push({
    id: 'operations',
    kind: 'operations',
    ...officeOperationsBoardPosition(layout.width),
  })
  targets.push({
    id: 'floor-terminal',
    kind: 'floor-terminal',
    ...officeFloorTerminalPosition(layout.width),
  })
  for (const landmark of officeServiceLandmarks(layout)) {
    const position = {
      x: landmark.x + Math.round(landmark.width / 2),
      y: landmark.y + landmark.collision.y + Math.round(landmark.collision.height / 2),
    }
    targets.push(landmark.kind === 'inbox'
      ? { id: 'inbox-service', kind: 'inbox-service', ...position }
      : { id: 'news-service', kind: 'news-service', ...position })
  }

  return targets
}

export function nearestOfficeInteractionTarget(
  alice: { x: number; y: number },
  facing: OfficeFacingDirection,
  targets: readonly OfficeInteractionTarget[],
  radius = OFFICE_INTERACTION_RADIUS,
): OfficeInteractionTarget | null {
  let nearest: OfficeInteractionTarget | null = null
  let nearestScore = Number.POSITIVE_INFINITY
  const vector = {
    up: { x: 0, y: -1 },
    right: { x: 1, y: 0 },
    down: { x: 0, y: 1 },
    left: { x: -1, y: 0 },
  }[facing]

  for (const target of targets) {
    const requiredFacing = requiredApproachFacing(target)
    if (requiredFacing && facing !== requiredFacing) continue
    const dx = target.x - alice.x
    const dy = target.y - alice.y
    const distanceSquared = dx ** 2 + dy ** 2
    if (distanceSquared > radius * radius) continue
    const forward = dx * vector.x + dy * vector.y
    const sideways = Math.abs(dx * vector.y - dy * vector.x)
    const sideReach = Math.min(
      OFFICE_INTERACTION_SIDE_REACH,
      Math.max(OFFICE_INTERACTION_MIN_SIDE_REACH, forward + OFFICE_INTERACTION_MIN_SIDE_REACH),
    )
    if (forward < -OFFICE_INTERACTION_BACK_REACH || sideways > sideReach) {
      continue
    }
    const score = distanceSquared + sideways ** 2
    if (score > nearestScore) continue
    nearest = target
    nearestScore = score
  }

  return nearest
}

export function officeCameraFollowingAlice(
  alice: { x: number; y: number },
  camera: { x: number; y: number },
  viewport: { width: number; height: number },
  map: { width: number; height: number },
  margin = 96,
): { x: number; y: number } {
  let x = camera.x
  let y = camera.y
  const screenX = alice.x + x
  const screenY = alice.y + y
  const horizontalMargin = Math.min(margin, viewport.width / 3)
  const verticalMargin = Math.min(margin, viewport.height / 3)

  if (screenX < horizontalMargin) x += horizontalMargin - screenX
  if (screenX > viewport.width - horizontalMargin) {
    x -= screenX - (viewport.width - horizontalMargin)
  }
  if (screenY < verticalMargin) y += verticalMargin - screenY
  if (screenY > viewport.height - verticalMargin) {
    y -= screenY - (viewport.height - verticalMargin)
  }

  return clampOfficeCamera({ x, y }, viewport, map)
}

export function clampOfficeCamera(
  camera: { x: number; y: number },
  viewport: { width: number; height: number },
  map: { width: number; height: number },
): { x: number; y: number } {
  const axis = (position: number, viewportSize: number, mapSize: number) => (
    viewportSize >= mapSize
      ? Math.round((viewportSize - mapSize) / 2)
      : Math.min(0, Math.max(viewportSize - mapSize, Math.round(position)))
  )

  return {
    x: axis(camera.x, viewport.width, map.width),
    y: axis(camera.y, viewport.height, map.height),
  }
}

export function officeCameraCenteredOn(
  point: { x: number; y: number },
  viewport: { width: number; height: number },
  map: { width: number; height: number },
): { x: number; y: number } {
  return clampOfficeCamera({
    x: viewport.width / 2 - point.x,
    y: viewport.height / 2 - point.y,
  }, viewport, map)
}
