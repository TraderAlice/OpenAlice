// @vitest-environment jsdom

import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { OverflowMarquee } from './OverflowMarquee'

class ResizeObserverStub {
  observe(): void {}
  disconnect(): void {}
  unobserve(): void {}
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', ResizeObserverStub)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function setWidth(node: Element, property: 'clientWidth' | 'scrollWidth', value: number): void {
  Object.defineProperty(node, property, { configurable: true, value })
}

describe('OverflowMarquee', () => {
  it('reveals a duplicated track for a clipped label after hover', async () => {
    const { container } = render(<OverflowMarquee text="A detailed research conversation title" />)
    const viewport = container.querySelector('[data-overflow-marquee="viewport"]')!
    const label = container.querySelector('[data-overflow-marquee="label"]')!
    setWidth(viewport, 'clientWidth', 104)
    setWidth(label, 'scrollWidth', 224)

    fireEvent.mouseEnter(viewport)

    await waitFor(() => expect(viewport.getAttribute('data-marquee-active')).toBe('true'))
    const track = container.querySelector('[data-overflow-marquee="track"]')
    expect(track?.getAttribute('aria-hidden')).toBe('true')
    expect(track?.textContent).toBe(
      'A detailed research conversation titleA detailed research conversation title',
    )
  })

  it('keeps a fitting label on the stable track', async () => {
    const { container } = render(<OverflowMarquee text="Brief title" />)
    const viewport = container.querySelector('[data-overflow-marquee="viewport"]')!
    const label = container.querySelector('[data-overflow-marquee="label"]')!
    setWidth(viewport, 'clientWidth', 160)
    setWidth(label, 'scrollWidth', 72)

    fireEvent.mouseEnter(viewport)

    await waitFor(() => expect(viewport.getAttribute('data-overflowing')).toBe('false'))
    expect(container.querySelector('[data-overflow-marquee="track"]')).toBeNull()
  })
})
