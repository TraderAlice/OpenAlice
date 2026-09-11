export interface ChromeRect { x: number; y: number; width: number; height: number }

/** All coordinates are CSS pixels, as supplied by Window Controls Overlay.
 * Only a header intersecting the caption band needs to yield horizontal space. */
export function captionInsets(rect: ChromeRect, safe: ChromeRect | null) {
  if (!safe || rect.width <= 0 || rect.height <= 0 || rect.y >= safe.y + safe.height || rect.y + rect.height <= safe.y) {
    return { left: 0, right: 0, caption: false }
  }
  return {
    left: Math.min(rect.width, Math.max(0, safe.x - rect.x)),
    right: Math.min(rect.width, Math.max(0, rect.x + rect.width - safe.x - safe.width)),
    caption: true,
  }
}

export function opaqueHex(value: string): string | null {
  if (/^#[0-9a-f]{6}$/i.test(value)) return value
  const rgb = value.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)$/)
  if (!rgb || (rgb[4] !== undefined && Number(rgb[4]) !== 1)) return null
  return '#' + rgb.slice(1, 4).map((n) => Math.min(255, Number(n)).toString(16).padStart(2, '0')).join('')
}
