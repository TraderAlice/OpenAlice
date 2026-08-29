// @vitest-environment jsdom

import { act, cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { OfficeAliceSprite, officeAlicePose } from './OfficeAliceSprite'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('OfficeAliceSprite', () => {
  it('uses dedicated idle and walk poses for all four directions', () => {
    expect(officeAlicePose('right', true)).toBe('walk-right')
    expect(officeAlicePose('left', true)).toBe('walk-left')
    expect(officeAlicePose('up', true)).toBe('walk-up')
    expect(officeAlicePose('up', false)).toBe('idle-up')
    expect(officeAlicePose('down', true)).toBe('walk-down')
    expect(officeAlicePose('down', false)).toBe('idle-down')

    const { container, rerender } = render(
      <OfficeAliceSprite
        direction="right"
        walking
        reducedMotion
        label="Alice"
        scale={1}
      />,
    )
    expect(container.firstElementChild?.getAttribute('data-pose')).toBe('walk-right')
    expect(container.firstElementChild?.getAttribute('data-frame')).toBe('0')

    rerender(
      <OfficeAliceSprite
        direction="left"
        walking
        reducedMotion
        label="Alice"
        scale={1}
      />,
    )
    expect(container.firstElementChild?.getAttribute('data-pose')).toBe('walk-left')

    rerender(
      <OfficeAliceSprite
        direction="up"
        walking={false}
        reducedMotion
        label="Alice"
        scale={1}
      />,
    )
    expect(container.firstElementChild?.getAttribute('data-pose')).toBe('idle-up')
    expect((container.firstElementChild as HTMLElement).style.backgroundImage)
      .toContain('alice-overworld-v1.png')
    expect((container.firstElementChild as HTMLElement).style.backgroundPosition)
      .toBe('-48px -144px')
  })

  it('advances the authored run cycle while Alice keeps moving', () => {
    vi.useFakeTimers()
    const { container } = render(
      <OfficeAliceSprite
        direction="right"
        walking
        reducedMotion={false}
        label="Alice"
        scale={1}
      />,
    )

    expect(container.firstElementChild?.getAttribute('data-frame')).toBe('0')
    act(() => vi.advanceTimersByTime(120))
    expect(container.firstElementChild?.getAttribute('data-frame')).toBe('1')
    act(() => vi.advanceTimersByTime(120))
    expect(container.firstElementChild?.getAttribute('data-frame')).toBe('2')
  })
})
