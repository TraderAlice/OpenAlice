/** Geometry for docking a surface into a header affordance. */
export function dockDismissTransform(
  from: Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>,
  to: Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>,
): { readonly dx: number; readonly dy: number; readonly scale: number } {
  const fromCx = from.left + from.width / 2
  const fromCy = from.top + from.height / 2
  const toCx = to.left + to.width / 2
  const toCy = to.top + to.height / 2
  const scale = Math.min(
    0.18,
    Math.max(0.05, Math.min(to.width / Math.max(from.width, 1), to.height / Math.max(from.height, 1))),
  )
  return { dx: toCx - fromCx, dy: toCy - fromCy, scale }
}

export function prefersReducedMotion(media: { matches: boolean } | null | undefined = typeof window !== 'undefined'
  ? window.matchMedia?.('(prefers-reduced-motion: reduce)')
  : null): boolean {
  return Boolean(media?.matches)
}

/** Drop WAAPI / fixed-flight residue so a reopened surface is visible. */
export function clearDockDismissStyles(surface: HTMLElement): void {
  for (const animation of surface.getAnimations?.() ?? []) animation.cancel()
  for (const name of [
    'transform',
    'opacity',
    'transform-origin',
    'position',
    'left',
    'top',
    'width',
    'height',
    'margin',
    'z-index',
    'pointer-events',
    'visibility',
  ] as const) {
    surface.style.removeProperty(name)
  }
}

function prepareFixedFlightGhost(surface: HTMLElement, from: DOMRect): HTMLElement {
  const ghost = surface.cloneNode(true) as HTMLElement
  ghost.removeAttribute('id')
  ghost.querySelectorAll('[id]').forEach((node) => node.removeAttribute('id'))
  ghost.setAttribute('aria-hidden', 'true')
  ghost.classList.add('oa-context-continue-panel--flight')
  Object.assign(ghost.style, {
    position: 'fixed',
    left: `${from.left}px`,
    top: `${from.top}px`,
    width: `${from.width}px`,
    height: `${from.height}px`,
    margin: '0',
    zIndex: '1200',
    pointerEvents: 'none',
    transformOrigin: 'center center',
    boxSizing: 'border-box',
    overflow: 'hidden',
  })
  document.body.appendChild(ghost)
  return ghost
}

/**
 * Animate a transcript card toward a header affordance.
 *
 * Flies a fixed-position clone so overflow clipping on the transcript scroller
 * cannot hide the path to the top-right dock control.
 */
export async function playDockDismissAnimation(
  surface: HTMLElement,
  anchor: HTMLElement,
  opts: { readonly durationMs?: number; readonly reducedMotion?: boolean } = {},
): Promise<void> {
  if (opts.reducedMotion ?? prefersReducedMotion()) return
  if (typeof surface.animate !== 'function') return

  const from = surface.getBoundingClientRect()
  const to = anchor.getBoundingClientRect()
  if (from.width < 1 || from.height < 1 || to.width < 1 || to.height < 1) return

  const { dx, dy, scale } = dockDismissTransform(from, to)
  const duration = opts.durationMs ?? 1000
  const ghost = prepareFixedFlightGhost(surface, from)
  surface.style.visibility = 'hidden'

  try {
    await new Promise<void>((resolve) => {
      const animation = ghost.animate(
        [
          { transform: 'translate(0px, 0px) scale(1)', opacity: 1, offset: 0 },
          {
            transform: `translate(${dx * 0.55}px, ${dy * 0.55}px) scale(${Math.max(scale, 0.45)})`,
            opacity: 0.92,
            offset: 0.55,
          },
          {
            transform: `translate(${dx}px, ${dy}px) scale(${scale})`,
            opacity: 0,
            offset: 1,
          },
        ],
        { duration, easing: 'cubic-bezier(0.22, 1, 0.36, 1)', fill: 'forwards' },
      )
      animation.onfinish = () => resolve()
      animation.oncancel = () => resolve()
    })
  } finally {
    ghost.remove()
    clearDockDismissStyles(surface)
  }
}
