import type { OfficeMapLayout } from './map-layout'

export const OFFICE_OPERATIONS_BOARD_Y = 204

export interface OfficeServiceLandmark {
  id: 'mail-service' | 'archive-service'
  kind: 'mail' | 'archive'
  x: number
  y: number
  width: number
  height: number
  collision: { x: number; y: number; width: number; height: number }
}

export function officeOperationsBoardPosition(mapWidth: number): { x: number; y: number } {
  return {
    x: Math.round(mapWidth / 2),
    y: OFFICE_OPERATIONS_BOARD_Y,
  }
}

export function officeServiceLandmarks(layout: OfficeMapLayout): OfficeServiceLandmark[] {
  if (layout.rows !== 1) return []
  const y = layout.height - 124
  const width = 120
  const height = 104
  const centerX = Math.round(layout.width / 2)
  const centerGap = 72
  return [
    {
      id: 'mail-service',
      kind: 'mail',
      x: centerX - width - centerGap,
      y,
      width,
      height,
      collision: { x: 10, y: 54, width: 100, height: 46 },
    },
    {
      id: 'archive-service',
      kind: 'archive',
      x: centerX + centerGap,
      y,
      width,
      height,
      collision: { x: 8, y: 56, width: 104, height: 44 },
    },
  ]
}
