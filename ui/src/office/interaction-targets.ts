import type { OfficeFloorEmployee, OfficeRoomSnapshot } from '../api/office'
import type { OfficeMapLayout } from './map-layout'
import { visibleEmployeesForOffice } from './desk-slots'
import { officeOperationsBoardPosition } from './map-landmarks'
import { OFFICE_CABINET_CENTER, OFFICE_DESK_CENTERS, OFFICE_ROSTER_CENTER } from './pod-geometry'

export const OFFICE_INTERACTION_RADIUS = 84
export const OFFICE_INTERACTION_SIDE_REACH = 52
export const OFFICE_INTERACTION_MIN_SIDE_REACH = 18
export const OFFICE_INTERACTION_BACK_REACH = 8

export type OfficeFacingDirection = 'up' | 'right' | 'down' | 'left'

export type OfficeInteractionTarget =
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
  }
  | {
    id: 'operations'
    kind: 'operations'
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
      targets.push({
        id: `roster:${group.workspace.id}`,
        kind: 'roster',
        x: pod.x + OFFICE_ROSTER_CENTER.x,
        y: pod.y + OFFICE_ROSTER_CENTER.y,
        workspaceId: group.workspace.id,
        roomName,
      })
    }
  }

  targets.push({
    id: 'operations',
    kind: 'operations',
    ...officeOperationsBoardPosition(layout.width),
  })

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

  return {
    x: Math.min(0, Math.max(viewport.width - map.width, Math.round(x))),
    y: Math.min(0, Math.max(viewport.height - map.height, Math.round(y))),
  }
}
