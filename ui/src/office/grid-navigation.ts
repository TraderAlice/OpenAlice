export type OfficeGridDirection = 'left' | 'right' | 'up' | 'down'

export interface OfficeGridFocusRect {
  left: number
  right: number
  top: number
  bottom: number
}

function rectCenter(rect: OfficeGridFocusRect) {
  return {
    x: (rect.left + rect.right) / 2,
    y: (rect.top + rect.bottom) / 2,
  }
}

export function nextOfficeGridIndex(
  rects: readonly OfficeGridFocusRect[],
  currentIndex: number,
  direction: OfficeGridDirection,
) {
  const current = rects[currentIndex]
  if (!current) return currentIndex
  const origin = rectCenter(current)
  const horizontal = direction === 'left' || direction === 'right'
  const sign = direction === 'left' || direction === 'up' ? -1 : 1
  let bestIndex = currentIndex
  let bestScore = Number.POSITIVE_INFINITY

  rects.forEach((rect, index) => {
    if (index === currentIndex) return
    const center = rectCenter(rect)
    const dx = center.x - origin.x
    const dy = center.y - origin.y
    const primary = (horizontal ? dx : dy) * sign
    if (primary <= 1) return
    const secondary = Math.abs(horizontal ? dy : dx)
    const score = primary + secondary * 4
    if (score < bestScore) {
      bestIndex = index
      bestScore = score
    }
  })

  return bestIndex
}
