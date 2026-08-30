import { describe, expect, it } from 'vitest'

import {
  OFFICE_PROMPT_DETAIL_MAX_WIDTH,
  OFFICE_PROMPT_SERVICE_MAX_HEIGHT,
  OFFICE_PROMPT_SERVICE_MAX_WIDTH,
  officeInteractionPromptPlacement,
} from './interaction-prompt'

const map = { width: 960, height: 720 }
const camera = { x: 0, y: 0 }

describe('officeInteractionPromptPlacement', () => {
  it('places the callout beyond the target and away from Alice', () => {
    expect(officeInteractionPromptPlacement(
      { x: 480, y: 360 },
      { x: 420, y: 390 },
      map,
      camera,
    )).toEqual({ side: 'left', x: 386, y: 390, width: 176, tailShift: 0 })

    expect(officeInteractionPromptPlacement(
      { x: 480, y: 360 },
      { x: 490, y: 280 },
      map,
      camera,
    )).toEqual({ side: 'above', x: 490, y: 246, width: 176, tailShift: 0 })
  })

  it('uses a visible perpendicular side at every edge before covering Alice', () => {
    expect(officeInteractionPromptPlacement(
      { x: 300, y: 360 },
      { x: 180, y: 360 },
      map,
      camera,
    ).side).toBe('above')
    expect(officeInteractionPromptPlacement(
      { x: 660, y: 360 },
      { x: 820, y: 360 },
      map,
      camera,
    ).side).toBe('above')
    expect(officeInteractionPromptPlacement(
      { x: 480, y: 160 },
      { x: 480, y: 80 },
      map,
      camera,
    ).side).toBe('right')
    expect(officeInteractionPromptPlacement(
      { x: 480, y: 560 },
      { x: 480, y: 680 },
      map,
      camera,
    ).side).toBe('right')
  })

  it('uses the current camera viewport rather than invisible map space', () => {
    expect(officeInteractionPromptPlacement(
      { x: 480, y: 360 },
      { x: 438, y: 450 },
      { width: 760, height: 530 },
      { x: -113, y: 0 },
    ).side).toBe('right')
  })

  it('reserves the wider edge boundary only for a prompt with detail copy', () => {
    const alice = { x: 360, y: 360 }
    const target = { x: 240, y: 360 }

    expect(officeInteractionPromptPlacement(alice, target, map, camera).side).toBe('left')
    expect(officeInteractionPromptPlacement(
      alice,
      target,
      map,
      camera,
      OFFICE_PROMPT_DETAIL_MAX_WIDTH,
    ).side).toBe('above')
  })

  it('uses the opposite side only when it has room without covering Alice', () => {
    expect(officeInteractionPromptPlacement(
      { x: 620, y: 360 },
      { x: 180, y: 360 },
      { width: 960, height: 120 },
      { x: 0, y: -300 },
    ).side).toBe('right')
  })

  it('accounts for the taller two-line service terminal callout', () => {
    expect(officeInteractionPromptPlacement(
      { x: 576, y: 432 },
      { x: 574, y: 510 },
      { width: 760, height: 530 },
      { x: 0, y: 0 },
      OFFICE_PROMPT_SERVICE_MAX_WIDTH,
      OFFICE_PROMPT_SERVICE_MAX_HEIGHT,
    )).toEqual({
      side: 'left',
      x: 540,
      y: 480,
      width: 280,
      tailShift: 30,
    })
  })

  it('slides a perpendicular prompt along the camera edge and keeps its tail on the target', () => {
    expect(officeInteractionPromptPlacement(
      { x: 100, y: 200 },
      { x: 50, y: 200 },
      { width: 374, height: 668 },
      camera,
      168,
    )).toEqual({
      side: 'below',
      x: 96,
      y: 234,
      width: 168,
      tailShift: -46,
    })
  })

  it('chooses the least-obscuring side when a roster is boxed in by its room', () => {
    expect(officeInteractionPromptPlacement(
      { x: 144, y: 480 },
      { x: 186, y: 443 },
      { width: 866, height: 648 },
      { x: 0, y: -24 },
      undefined,
      undefined,
      [
        { left: 180, top: 360, right: 444, bottom: 424 },
        { left: 212, top: 423, right: 304, bottom: 494 },
      ],
    )).toEqual({
      side: 'above',
      x: 186,
      y: 409,
      width: 176,
      tailShift: 0,
    })
  })
})
