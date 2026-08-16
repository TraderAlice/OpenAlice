/**
 * Occupied-seat camera: the employee stands at the desk front edge,
 * body behind the work surface. The desk/monitor paint in front of the
 * legs so the sprite is not centered on the tabletop.
 */
export const OFFICE_STATION = {
  widthPx: 110,
  heightPx: 196,
  desk: {
    widthPx: 98,
    zIndex: 2,
    bottomPx: 0,
  },
  sprite: {
    scale: 0.43,
    zIndex: 1,
    /** Feet sit on the tabletop/leg join — the desk front edge. */
    bottomPx: 48,
    anchor: 'desk-front-edge',
  },
  name: {
    zIndex: 3,
    topPx: 6,
  },
  bubble: {
    zIndex: 4,
    topPx: 0,
  },
} as const

export type OfficeStationLayer = 'sprite' | 'desk' | 'name' | 'bubble'

export function officeStationComposition() {
  const { sprite, desk, name, bubble } = OFFICE_STATION
  return {
    widthPx: OFFICE_STATION.widthPx,
    heightPx: OFFICE_STATION.heightPx,
    backToFront: ['sprite', 'desk', 'name', 'bubble'] as const satisfies readonly OfficeStationLayer[],
    spriteBehindDesk: sprite.zIndex < desk.zIndex,
    spriteAnchor: sprite.anchor,
    sprite,
    desk,
    name,
    bubble,
  }
}
