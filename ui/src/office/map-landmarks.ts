import {
  OFFICE_POD_GAP,
  OFFICE_POD_HEIGHT,
  OFFICE_POD_WIDTH,
  type OfficeMapLayout,
} from './map-layout'

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

function serviceLandmarksAt(inboxX: number, newsX: number, y: number): OfficeServiceLandmark[] {
  return [
    {
      id: 'inbox-service',
      kind: 'inbox',
      x: inboxX,
      y,
      width: SERVICE_WIDTH,
      height: SERVICE_HEIGHT,
      collision: { x: 12, y: 62, width: 112, height: 48 },
    },
    {
      id: 'news-service',
      kind: 'news',
      x: newsX,
      y,
      width: SERVICE_WIDTH,
      height: SERVICE_HEIGHT,
      collision: { x: 12, y: 62, width: 112, height: 48 },
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
  if (layout.rows === 1) {
    const y = layout.height - 124
    const centerX = Math.round(layout.width / 2)
    const centerGap = 72
    return serviceLandmarksAt(
      centerX - SERVICE_WIDTH - centerGap,
      centerX + centerGap,
      y,
    )
  }

  const occupiedFinalRow = layout.columns > 0 ? layout.pods.length % layout.columns : 0
  const firstPod = layout.pods[0]
  const finalPod = layout.pods.at(-1)
  if (!firstPod || !finalPod || occupiedFinalRow === 0) return []

  const emptyCellX = firstPod.x + occupiedFinalRow * (OFFICE_POD_WIDTH + OFFICE_POD_GAP)
  const serviceGap = 12
  const insetX = Math.round((OFFICE_POD_WIDTH - SERVICE_WIDTH * 2 - serviceGap) / 2)
  const y = finalPod.y + Math.round((OFFICE_POD_HEIGHT - SERVICE_HEIGHT) * 0.64)
  return serviceLandmarksAt(
    emptyCellX + insetX,
    emptyCellX + insetX + SERVICE_WIDTH + serviceGap,
    y,
  )
}
