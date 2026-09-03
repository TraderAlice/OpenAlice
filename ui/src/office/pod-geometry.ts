export const OFFICE_DESK_CENTERS = [
  { x: 90, y: 97 },
  { x: 198, y: 97 },
  { x: 90, y: 170 },
  { x: 198, y: 170 },
] as const

export const OFFICE_SIGN_CENTER = { x: 144, y: 32 } as const
export const OFFICE_CABINET_CENTER = { x: 270, y: 187 } as const

export function officeRosterCenter(
  pod: { x: number; width: number },
  mapWidth: number,
): { x: number; y: number; side: 'left' | 'right' } {
  const side = pod.x + pod.width / 2 < mapWidth / 2 ? 'left' : 'right'
  return {
    x: side === 'left' ? 18 : pod.width - 18,
    y: 83,
    side,
  }
}
