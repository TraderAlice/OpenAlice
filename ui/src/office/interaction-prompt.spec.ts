import { describe, expect, it } from 'vitest'

import { officeInteractionPromptPlacement } from './interaction-prompt'

const map = { width: 960, height: 720 }
const camera = { x: 0, y: 0 }

describe('officeInteractionPromptPlacement', () => {
  it('places the callout beyond the target and away from Alice', () => {
    expect(officeInteractionPromptPlacement(
      { x: 480, y: 360 },
      { x: 420, y: 390 },
      map,
      camera,
    )).toEqual({ side: 'left', x: 386, y: 390 })

    expect(officeInteractionPromptPlacement(
      { x: 480, y: 360 },
      { x: 490, y: 280 },
      map,
      camera,
    )).toEqual({ side: 'above', x: 490, y: 246 })
  })

  it('flips the callout inward at every map edge', () => {
    expect(officeInteractionPromptPlacement(
      { x: 300, y: 360 },
      { x: 180, y: 360 },
      map,
      camera,
    ).side).toBe('right')
    expect(officeInteractionPromptPlacement(
      { x: 660, y: 360 },
      { x: 820, y: 360 },
      map,
      camera,
    ).side).toBe('left')
    expect(officeInteractionPromptPlacement(
      { x: 480, y: 160 },
      { x: 480, y: 80 },
      map,
      camera,
    ).side).toBe('below')
    expect(officeInteractionPromptPlacement(
      { x: 480, y: 560 },
      { x: 480, y: 680 },
      map,
      camera,
    ).side).toBe('above')
  })

  it('uses the current camera viewport rather than invisible map space', () => {
    expect(officeInteractionPromptPlacement(
      { x: 480, y: 360 },
      { x: 438, y: 427 },
      { width: 760, height: 530 },
      { x: -113, y: 0 },
    ).side).toBe('above')
  })
})
