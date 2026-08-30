// @vitest-environment jsdom

import { act, cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { OfficeAliceSprite, officeAlicePose } from './OfficeAliceSprite'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('OfficeAliceSprite', () => {
  it('uses the generated rear view for north and authored rows for other directions', () => {
    expect(officeAlicePose('right', true)).toBe('walk-right')
    expect(officeAlicePose('left', true)).toBe('walk-left')
    expect(officeAlicePose('up', true)).toBe('idle-back')
    expect(officeAlicePose('up', false)).toBe('idle-back')
    expect(officeAlicePose('down', true)).toBe('idle')

    const { container, rerender } = render(
      <OfficeAliceSprite
        direction="right"
        walking
        reducedMotion
        label="Alice"
        scale={0.2}
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
        scale={0.2}
      />,
    )
    expect(container.firstElementChild?.getAttribute('data-pose')).toBe('walk-left')

    rerender(
      <OfficeAliceSprite
        direction="up"
        walking={false}
        reducedMotion
        label="Alice"
        scale={0.2}
      />,
    )
    expect(container.firstElementChild?.getAttribute('data-pose')).toBe('idle-back')
    expect((container.firstElementChild as HTMLElement).style.backgroundImage).toContain('back-v1.png')
  })

  it('advances the authored run cycle while Alice keeps moving', () => {
    vi.useFakeTimers()
    const { container } = render(
      <OfficeAliceSprite
        direction="right"
        walking
        reducedMotion={false}
        label="Alice"
        scale={0.2}
      />,
    )

    expect(container.firstElementChild?.getAttribute('data-frame')).toBe('0')
    act(() => vi.advanceTimersByTime(80))
    expect(container.firstElementChild?.getAttribute('data-frame')).toBe('1')
    act(() => vi.advanceTimersByTime(80))
    expect(container.firstElementChild?.getAttribute('data-frame')).toBe('2')
  })
})
