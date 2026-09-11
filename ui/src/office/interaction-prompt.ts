export type OfficeInteractionPromptSide = 'above' | 'right' | 'below' | 'left'

export interface OfficeInteractionPromptPlacement {
  side: OfficeInteractionPromptSide
  x: number
  y: number
  width: number
  tailShift: number
}

export interface OfficePromptAvoidBounds {
  left: number
  top: number
  right: number
  bottom: number
}

const OFFICE_PROMPT_GAP = 34
const OFFICE_PROMPT_MAX_WIDTH = 176
const OFFICE_PROMPT_MAX_HEIGHT = 56
const OFFICE_PROMPT_VIEWPORT_MARGIN = 12
const OFFICE_PROMPT_ALICE_HALF_WIDTH = 24
const OFFICE_PROMPT_ALICE_HALF_HEIGHT = 30
const OFFICE_PROMPT_TARGET_GAP = 8
export const OFFICE_PROMPT_DETAIL_MAX_WIDTH = 216
export const OFFICE_PROMPT_NARROW_DETAIL_MAX_WIDTH = 168
export const OFFICE_PROMPT_DESTINATION_MAX_WIDTH = 200
export const OFFICE_PROMPT_DIALOGUE_MAX_WIDTH = 320
export const OFFICE_PROMPT_NARROW_DIALOGUE_MAX_WIDTH = 240
export const OFFICE_PROMPT_SERVICE_MAX_WIDTH = 280
export const OFFICE_PROMPT_NARROW_SERVICE_MAX_WIDTH = 240
export const OFFICE_PROMPT_SERVICE_MAX_HEIGHT = 76

interface OfficePromptBounds {
  left: number
  top: number
  right: number
  bottom: number
}

function promptAnchor(
  side: OfficeInteractionPromptSide,
  target: { x: number; y: number },
  targetBounds?: OfficePromptAvoidBounds,
): { x: number; y: number } {
  if (!targetBounds) {
    return {
      x: target.x + (side === 'left' ? -OFFICE_PROMPT_GAP : side === 'right' ? OFFICE_PROMPT_GAP : 0),
      y: target.y + (side === 'above' ? -OFFICE_PROMPT_GAP : side === 'below' ? OFFICE_PROMPT_GAP : 0),
    }
  }
  return {
    x: side === 'left'
      ? targetBounds.left - OFFICE_PROMPT_TARGET_GAP
      : side === 'right'
        ? targetBounds.right + OFFICE_PROMPT_TARGET_GAP
        : target.x,
    y: side === 'above'
      ? targetBounds.top - OFFICE_PROMPT_TARGET_GAP
      : side === 'below'
        ? targetBounds.bottom + OFFICE_PROMPT_TARGET_GAP
        : target.y,
  }
}

function promptBounds(
  side: OfficeInteractionPromptSide,
  target: { x: number; y: number },
  maxWidth: number,
  maxHeight: number,
  targetBounds?: OfficePromptAvoidBounds,
): OfficePromptBounds {
  const anchor = promptAnchor(side, target, targetBounds)
  if (side === 'left') {
    return {
      left: anchor.x - maxWidth,
      top: anchor.y - maxHeight / 2,
      right: anchor.x,
      bottom: anchor.y + maxHeight / 2,
    }
  }
  if (side === 'right') {
    return {
      left: anchor.x,
      top: anchor.y - maxHeight / 2,
      right: anchor.x + maxWidth,
      bottom: anchor.y + maxHeight / 2,
    }
  }
  if (side === 'above') {
    return {
      left: anchor.x - maxWidth / 2,
      top: anchor.y - maxHeight,
      right: anchor.x + maxWidth / 2,
      bottom: anchor.y,
    }
  }
  return {
    left: anchor.x - maxWidth / 2,
    top: anchor.y,
    right: anchor.x + maxWidth / 2,
    bottom: anchor.y + maxHeight,
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

function boundsOverlapArea(left: OfficePromptBounds, right: OfficePromptBounds) {
  return Math.max(0, Math.min(left.right, right.right) - Math.max(left.left, right.left))
    * Math.max(0, Math.min(left.bottom, right.bottom) - Math.max(left.top, right.top))
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
  maxHeight = OFFICE_PROMPT_MAX_HEIGHT,
  avoidBounds: readonly OfficePromptAvoidBounds[] = [],
  targetBounds?: OfficePromptAvoidBounds,
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
  const screenAvoidBounds = avoidBounds.map((bounds) => ({
    left: bounds.left + camera.x,
    top: bounds.top + camera.y,
    right: bounds.right + camera.x,
    bottom: bounds.bottom + camera.y,
  }))
  const screenTargetBounds = targetBounds
    ? {
        left: targetBounds.left + camera.x,
        top: targetBounds.top + camera.y,
        right: targetBounds.right + camera.x,
        bottom: targetBounds.bottom + camera.y,
      }
    : undefined
  const candidates = [
    side,
    ...perpendicularSides(side, screenTarget, viewport),
    OPPOSITE_SIDE[side],
  ].map((candidateSide) => {
    const fitted = fitPromptCrossAxis(
      candidateSide,
      promptBounds(candidateSide, screenTarget, promptWidth, maxHeight, screenTargetBounds),
      viewport,
    )
    return { side: candidateSide, ...fitted }
  })
  const visibleCandidates = candidates.filter((candidate) => boundsFitViewport(candidate.bounds, viewport))
  const playerClearCandidates = visibleCandidates.filter(
    (candidate) => !boundsOverlap(candidate.bounds, aliceBounds),
  )
  const preferredCandidates = playerClearCandidates.length > 0
    ? playerClearCandidates
    : visibleCandidates
  const chosen = preferredCandidates.find((candidate) => (
    screenAvoidBounds.every((bounds) => !boundsOverlap(candidate.bounds, bounds))
  )) ?? preferredCandidates.reduce((best, candidate) => {
    const overlap = screenAvoidBounds.reduce(
      (total, bounds) => total + boundsOverlapArea(candidate.bounds, bounds),
      0,
    )
    const bestOverlap = screenAvoidBounds.reduce(
      (total, bounds) => total + boundsOverlapArea(best.bounds, bounds),
      0,
    )
    return overlap < bestOverlap ? candidate : best
  }, preferredCandidates[0] ?? candidates[candidates.length - 1]!)
  side = chosen.side
  const anchor = promptAnchor(side, target, targetBounds)

  return {
    side,
    x: anchor.x
      + (side === 'above' || side === 'below' ? chosen.shift : 0),
    y: anchor.y
      + (side === 'left' || side === 'right' ? chosen.shift : 0),
    width: promptWidth,
    tailShift: chosen.shift === 0 ? 0 : -chosen.shift,
  }
}
