import type { OfficeFloorEmployee, OfficeRoomSnapshot } from '../api/office'
import type { OfficeMapLayout } from './map-layout'
import { visibleEmployeesForOffice } from './desk-slots'

export const OFFICE_INTERACTION_RADIUS = 78

const DESK_CENTERS = [
  { x: 90, y: 97 },
  { x: 198, y: 97 },
  { x: 90, y: 170 },
  { x: 198, y: 170 },
] as const

const CABINET_CENTER = { x: 270, y: 187 } as const

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
      const center = DESK_CENTERS[index]
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
      x: pod.x + CABINET_CENTER.x,
      y: pod.y + CABINET_CENTER.y,
      workspaceId: group.workspace.id,
      roomName,
    })
  }

  return targets
}

export function nearestOfficeInteractionTarget(
  alice: { x: number; y: number },
  targets: readonly OfficeInteractionTarget[],
  radius = OFFICE_INTERACTION_RADIUS,
): OfficeInteractionTarget | null {
  let nearest: OfficeInteractionTarget | null = null
  let nearestDistanceSquared = radius * radius

  for (const target of targets) {
    const distanceSquared = (target.x - alice.x) ** 2 + (target.y - alice.y) ** 2
    if (distanceSquared > nearestDistanceSquared) continue
    nearest = target
    nearestDistanceSquared = distanceSquared
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
