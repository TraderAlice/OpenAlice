export interface Rect { x: number; y: number; width: number; height: number }

/** Electron screen coordinates are DIPs on both macOS and Windows. */
export function settleCompanion(bounds: Rect, area: Rect, snap = true): Rect & { flipped: boolean } {
  const maxX = area.x + Math.max(0, area.width - bounds.width)
  const maxY = area.y + Math.max(0, area.height - bounds.height)
  let x = Math.min(maxX, Math.max(area.x, bounds.x))
  let y = Math.min(maxY, Math.max(area.y, bounds.y))
  if (snap) {
    // Upstream v3 defaults: left/right 10%, bottom 15%, top disabled.
    const centerX = x + bounds.width / 2
    // Width includes bubble gutters; character size is derived from stage height.
    const centerY = y + bounds.height - bounds.height / 1.65 * .45
    if (centerX < area.x + area.width * .1) x = area.x
    else if (centerX > area.x + area.width * .9) x = maxX
    if (centerY > area.y + area.height * .85) y = maxY
  }
  return { ...bounds, x: Math.round(x), y: Math.round(y), flipped: x + bounds.width / 2 < area.x + area.width / 2 }
}

/** CSS `ease` (0.25, 0.1, 0.25, 1), for the upstream 160ms snap. */
export function snapEase(progress: number): number {
  const p = Math.max(0, Math.min(1, progress))
  let low = 0, high = 1
  for (let i = 0; i < 18; i++) {
    const t = (low + high) / 2, u = 1 - t
    const x = 3 * u * u * t * .25 + 3 * u * t * t * .25 + t * t * t
    if (x < p) low = t
    else high = t
  }
  const t = (low + high) / 2, u = 1 - t
  return 3 * u * u * t * .1 + 3 * u * t * t + t * t * t
}
