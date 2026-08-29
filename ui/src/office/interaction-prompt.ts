export type OfficeInteractionPromptSide = 'above' | 'right' | 'below' | 'left'

export interface OfficeInteractionPromptPlacement {
  side: OfficeInteractionPromptSide
  x: number
  y: number
}

const OFFICE_PROMPT_GAP = 34
const OFFICE_PROMPT_MAX_WIDTH = 176
const OFFICE_PROMPT_MAX_HEIGHT = 56
const OFFICE_PROMPT_VIEWPORT_MARGIN = 12
export const OFFICE_PROMPT_DETAIL_MAX_WIDTH = 216

/**
 * Put the action callout on the far side of its target from Alice. This keeps
 * the prompt attached to the world object without painting over the player.
 * Near map edges, flip the callout inward so the complete action stays legible.
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

  const screenX = target.x + camera.x
  const screenY = target.y + camera.y
  if (
    side === 'left'
    && screenX - OFFICE_PROMPT_GAP - maxWidth < OFFICE_PROMPT_VIEWPORT_MARGIN
  ) side = 'right'
  if (
    side === 'right'
    && screenX + OFFICE_PROMPT_GAP + maxWidth
      > viewport.width - OFFICE_PROMPT_VIEWPORT_MARGIN
  ) side = 'left'
  if (
    side === 'above'
    && screenY - OFFICE_PROMPT_GAP - OFFICE_PROMPT_MAX_HEIGHT < OFFICE_PROMPT_VIEWPORT_MARGIN
  ) side = 'below'
  if (
    side === 'below'
    && screenY + OFFICE_PROMPT_GAP + OFFICE_PROMPT_MAX_HEIGHT
      > viewport.height - OFFICE_PROMPT_VIEWPORT_MARGIN
  ) side = 'above'

  return {
    side,
    x: target.x + (side === 'left' ? -OFFICE_PROMPT_GAP : side === 'right' ? OFFICE_PROMPT_GAP : 0),
    y: target.y + (side === 'above' ? -OFFICE_PROMPT_GAP : side === 'below' ? OFFICE_PROMPT_GAP : 0),
  }
}
