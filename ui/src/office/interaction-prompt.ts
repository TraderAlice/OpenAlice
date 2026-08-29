export type OfficeInteractionPromptSide = 'above' | 'right' | 'below' | 'left'

export interface OfficeInteractionPromptPlacement {
  side: OfficeInteractionPromptSide
  x: number
  y: number
  width: number
  tailShift: number
}

const OFFICE_PROMPT_GAP = 34
const OFFICE_PROMPT_MAX_WIDTH = 176
const OFFICE_PROMPT_MAX_HEIGHT = 56
const OFFICE_PROMPT_VIEWPORT_MARGIN = 12
const OFFICE_PROMPT_ALICE_HALF_WIDTH = 24
const OFFICE_PROMPT_ALICE_HALF_HEIGHT = 30
export const OFFICE_PROMPT_DETAIL_MAX_WIDTH = 216
export const OFFICE_PROMPT_NARROW_DETAIL_MAX_WIDTH = 168
export const OFFICE_PROMPT_DESTINATION_MAX_WIDTH = 200

interface OfficePromptBounds {
  left: number
  top: number
  right: number
  bottom: number
}

function promptBounds(
  side: OfficeInteractionPromptSide,
  target: { x: number; y: number },
  maxWidth: number,
): OfficePromptBounds {
  if (side === 'left') {
    return {
      left: target.x - OFFICE_PROMPT_GAP - maxWidth,
      top: target.y - OFFICE_PROMPT_MAX_HEIGHT / 2,
      right: target.x - OFFICE_PROMPT_GAP,
      bottom: target.y + OFFICE_PROMPT_MAX_HEIGHT / 2,
    }
  }
  if (side === 'right') {
    return {
      left: target.x + OFFICE_PROMPT_GAP,
      top: target.y - OFFICE_PROMPT_MAX_HEIGHT / 2,
      right: target.x + OFFICE_PROMPT_GAP + maxWidth,
      bottom: target.y + OFFICE_PROMPT_MAX_HEIGHT / 2,
    }
  }
  if (side === 'above') {
    return {
      left: target.x - maxWidth / 2,
      top: target.y - OFFICE_PROMPT_GAP - OFFICE_PROMPT_MAX_HEIGHT,
      right: target.x + maxWidth / 2,
      bottom: target.y - OFFICE_PROMPT_GAP,
    }
  }
  return {
    left: target.x - maxWidth / 2,
    top: target.y + OFFICE_PROMPT_GAP,
    right: target.x + maxWidth / 2,
    bottom: target.y + OFFICE_PROMPT_GAP + OFFICE_PROMPT_MAX_HEIGHT,
  }
}

function boundsFitViewport(bounds: OfficePromptBounds, viewport: { width: number; height: number }) {
  return bounds.left >= OFFICE_PROMPT_VIEWPORT_MARGIN
    && bounds.top >= OFFICE_PROMPT_VIEWPORT_MARGIN
    && bounds.right <= viewport.width - OFFICE_PROMPT_VIEWPORT_MARGIN
    && bounds.bottom <= viewport.height - OFFICE_PROMPT_VIEWPORT_MARGIN
}

function boundsOverlap(left: OfficePromptBounds, right: OfficePromptBounds) {
  return left.left < right.right
    && left.right > right.left
    && left.top < right.bottom
    && left.bottom > right.top
}

function fitPromptCrossAxis(
  side: OfficeInteractionPromptSide,
  bounds: OfficePromptBounds,
  viewport: { width: number; height: number },
): { bounds: OfficePromptBounds; shift: number } {
  let shift = 0
  if (side === 'above' || side === 'below') {
    if (bounds.left < OFFICE_PROMPT_VIEWPORT_MARGIN) {
      shift = OFFICE_PROMPT_VIEWPORT_MARGIN - bounds.left
    }
    if (bounds.right + shift > viewport.width - OFFICE_PROMPT_VIEWPORT_MARGIN) {
      shift = viewport.width - OFFICE_PROMPT_VIEWPORT_MARGIN - bounds.right
    }
    return {
      bounds: {
        left: bounds.left + shift,
        top: bounds.top,
        right: bounds.right + shift,
        bottom: bounds.bottom,
      },
      shift,
    }
  }

  if (bounds.top < OFFICE_PROMPT_VIEWPORT_MARGIN) {
    shift = OFFICE_PROMPT_VIEWPORT_MARGIN - bounds.top
  }
  if (bounds.bottom + shift > viewport.height - OFFICE_PROMPT_VIEWPORT_MARGIN) {
    shift = viewport.height - OFFICE_PROMPT_VIEWPORT_MARGIN - bounds.bottom
  }
  return {
    bounds: {
      left: bounds.left,
      top: bounds.top + shift,
      right: bounds.right,
      bottom: bounds.bottom + shift,
    },
    shift,
  }
}

function perpendicularSides(
  side: OfficeInteractionPromptSide,
  target: { x: number; y: number },
  viewport: { width: number; height: number },
): OfficeInteractionPromptSide[] {
  if (side === 'left' || side === 'right') {
    return target.y >= viewport.height - target.y ? ['above', 'below'] : ['below', 'above']
  }
  return target.x > viewport.width - target.x ? ['left', 'right'] : ['right', 'left']
}

const OPPOSITE_SIDE: Record<OfficeInteractionPromptSide, OfficeInteractionPromptSide> = {
  above: 'below',
  right: 'left',
  below: 'above',
  left: 'right',
}

/**
 * Put the action callout on the far side of its target from Alice. When that
 * side leaves the camera, prefer a perpendicular edge with enough room before
 * falling back toward Alice. The prompt stays attached to its world object
 * without trading edge legibility for a callout painted over the player.
 */
export function officeInteractionPromptPlacement(
  alice: { x: number; y: number },
  target: { x: number; y: number },
  viewport: { width: number; height: number },
  camera: { x: number; y: number },
  maxWidth = OFFICE_PROMPT_MAX_WIDTH,
): OfficeInteractionPromptPlacement {
  const dx = target.x - alice.x
  const dy = target.y - alice.y
  let side: OfficeInteractionPromptSide

  if (Math.abs(dx) > Math.abs(dy)) {
    side = dx < 0 ? 'left' : 'right'
  } else {
    side = dy < 0 ? 'above' : 'below'
  }

  const screenTarget = { x: target.x + camera.x, y: target.y + camera.y }
  const screenAlice = { x: alice.x + camera.x, y: alice.y + camera.y }
  const promptWidth = Math.min(
    maxWidth,
    Math.max(0, viewport.width - OFFICE_PROMPT_VIEWPORT_MARGIN * 2),
  )
  const aliceBounds: OfficePromptBounds = {
    left: screenAlice.x - OFFICE_PROMPT_ALICE_HALF_WIDTH,
    top: screenAlice.y - OFFICE_PROMPT_ALICE_HALF_HEIGHT,
    right: screenAlice.x + OFFICE_PROMPT_ALICE_HALF_WIDTH,
    bottom: screenAlice.y + OFFICE_PROMPT_ALICE_HALF_HEIGHT,
  }
  const candidates = [
    side,
    ...perpendicularSides(side, screenTarget, viewport),
    OPPOSITE_SIDE[side],
  ].map((candidateSide) => {
    const fitted = fitPromptCrossAxis(
      candidateSide,
      promptBounds(candidateSide, screenTarget, promptWidth),
      viewport,
    )
    return { side: candidateSide, ...fitted }
  })
  const chosen = candidates.find((candidate) => (
    boundsFitViewport(candidate.bounds, viewport)
      && !boundsOverlap(candidate.bounds, aliceBounds)
  )) ?? candidates.find((candidate) => boundsFitViewport(candidate.bounds, viewport))
    ?? candidates[candidates.length - 1]!
  side = chosen.side

  return {
    side,
    x: target.x
      + (side === 'left' ? -OFFICE_PROMPT_GAP : side === 'right' ? OFFICE_PROMPT_GAP : 0)
      + (side === 'above' || side === 'below' ? chosen.shift : 0),
    y: target.y
      + (side === 'above' ? -OFFICE_PROMPT_GAP : side === 'below' ? OFFICE_PROMPT_GAP : 0)
      + (side === 'left' || side === 'right' ? chosen.shift : 0),
    width: promptWidth,
    tailShift: chosen.shift === 0 ? 0 : -chosen.shift,
  }
}
