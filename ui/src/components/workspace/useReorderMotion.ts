import { useLayoutEffect, useRef } from 'react'

const REORDER_DURATION_MS = 360
const REORDER_EASING = 'cubic-bezier(0.22, 1, 0.36, 1)'

function measureChildren(container: HTMLElement): Map<string, number> {
  const containerTop = container.getBoundingClientRect().top
  const positions = new Map<string, number>()
  for (const child of Array.from(container.children)) {
    if (!(child instanceof HTMLElement)) continue
    const id = child.dataset.reorderId
    if (!id) continue
    positions.set(id, child.getBoundingClientRect().top - containerTop)
  }
  return positions
}

/**
 * Animate direct children from their previous vertical position to their new
 * sorted position. This is a small FLIP transition: layout remains the source
 * of truth while transforms bridge the visual jump between two orders.
 */
export function useReorderMotion<T extends HTMLElement>(orderedIds: readonly string[]) {
  const containerRef = useRef<T | null>(null)
  const previousPositions = useRef(new Map<string, number>())
  const animations = useRef(new Map<string, Animation>())
  const orderKey = orderedIds.join('\u001f')

  useLayoutEffect(() => {
    const container = containerRef.current
    if (!container) return

    for (const animation of animations.current.values()) animation.cancel()
    animations.current.clear()

    const nextPositions = measureChildren(container)
    const reduceMotion = typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches

    if (!reduceMotion && previousPositions.current.size > 0) {
      for (const child of Array.from(container.children)) {
        if (!(child instanceof HTMLElement)) continue
        const id = child.dataset.reorderId
        if (!id) continue
        const previousTop = previousPositions.current.get(id)
        const nextTop = nextPositions.get(id)
        if (previousTop === undefined || nextTop === undefined) continue

        const deltaY = previousTop - nextTop
        if (Math.abs(deltaY) < 1) continue
        const overshoot = Math.sign(deltaY) * -2
        const animation = child.animate(
          [
            { transform: `translate3d(0, ${deltaY}px, 0) scale(0.985)` },
            { transform: `translate3d(0, ${overshoot}px, 0) scale(1.006)`, offset: 0.78 },
            { transform: 'translate3d(0, 0, 0) scale(1)' },
          ],
          { duration: REORDER_DURATION_MS, easing: REORDER_EASING },
        )
        animations.current.set(id, animation)
        animation.addEventListener('finish', () => animations.current.delete(id), { once: true })
      }
    }

    previousPositions.current = nextPositions
    return () => {
      for (const animation of animations.current.values()) animation.cancel()
      animations.current.clear()
    }
  }, [orderKey])

  return containerRef
}
