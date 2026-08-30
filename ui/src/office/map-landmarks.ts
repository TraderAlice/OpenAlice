import type { OfficeMapLayout } from './map-layout'

export const OFFICE_OPERATIONS_BOARD_Y = 204
export const OFFICE_FLOOR_TERMINAL_Y = 164

export interface OfficeServiceLandmark {
  id: 'inbox-service' | 'news-service'
  kind: 'inbox' | 'news'
  x: number
  y: number
  width: number
  height: number
  collision: { x: number; y: number; width: number; height: number }
}

const SERVICE_WIDTH = 136
const SERVICE_HEIGHT = 116
const SERVICE_FRONT_AISLE = 56
const SERVICE_COLLISION = { x: 12, y: 16, width: 112, height: 94 } as const

function serviceLandmarksAt(inboxX: number, newsX: number, y: number): OfficeServiceLandmark[] {
  return [
    {
      id: 'inbox-service',
      kind: 'inbox',
      x: inboxX,
      y,
      width: SERVICE_WIDTH,
      height: SERVICE_HEIGHT,
      collision: { ...SERVICE_COLLISION },
    },
    {
      id: 'news-service',
      kind: 'news',
      x: newsX,
      y,
      width: SERVICE_WIDTH,
      height: SERVICE_HEIGHT,
      collision: { ...SERVICE_COLLISION },
    },
  ]
}

export function officeOperationsBoardPosition(mapWidth: number): { x: number; y: number } {
  return {
    x: Math.round(mapWidth / 2),
    y: OFFICE_OPERATIONS_BOARD_Y,
  }
}

export function officeFloorTerminalPosition(mapWidth: number): { x: number; y: number } {
  return {
    x: mapWidth - 80,
    y: OFFICE_FLOOR_TERMINAL_Y,
  }
}

export function officeServiceLandmarks(layout: OfficeMapLayout): OfficeServiceLandmark[] {
  if (layout.rows <= 1) {
    const y = layout.height - SERVICE_HEIGHT - SERVICE_FRONT_AISLE
    const centerX = Math.round(layout.width / 2)
    const centerGap = 72
    return serviceLandmarksAt(
      centerX - SERVICE_WIDTH - centerGap,
      centerX + centerGap,
      y,
    )
  }

  const serviceGap = 12
  const insetX = Math.round((layout.serviceZone.width - SERVICE_WIDTH * 2 - serviceGap) / 2)
  const y = layout.serviceZone.y + Math.round((layout.serviceZone.height - SERVICE_HEIGHT) * 0.64)
  return serviceLandmarksAt(
    layout.serviceZone.x + insetX,
    layout.serviceZone.x + insetX + SERVICE_WIDTH + serviceGap,
    y,
  )
}
