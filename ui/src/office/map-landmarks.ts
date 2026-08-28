export const OFFICE_OPERATIONS_BOARD_Y = 204

export function officeOperationsBoardPosition(mapWidth: number): { x: number; y: number } {
  return {
    x: Math.round(mapWidth / 2),
    y: OFFICE_OPERATIONS_BOARD_Y,
  }
}
