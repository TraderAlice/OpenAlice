/**
 * Paint map objects from their floor contact point, like a tile-based
 * top-down game's painter algorithm: lower feet cover higher feet.
 */
export const OFFICE_DEPTH_BASE = 10

export function officeDepthAt(floorY: number): number {
  return OFFICE_DEPTH_BASE + Math.max(0, Math.round(floorY))
}
