// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useRef } from 'react'
import { afterEach, describe, expect, it } from 'vitest'

import { useScrollEdgeFade } from './useScrollEdgeFade'

function ScrollFixture() {
  const ref = useRef<HTMLDivElement>(null)
  useScrollEdgeFade(ref)
  return <div ref={ref} data-testid="scroller" />
}

afterEach(cleanup)

function setMetric(node: HTMLElement, property: 'clientHeight' | 'scrollHeight' | 'scrollTop', value: number): void {
  Object.defineProperty(node, property, { configurable: true, value })
}

describe('useScrollEdgeFade', () => {
  it('marks the clipped edges at each scroll position', () => {
    render(<ScrollFixture />)
    const scroller = screen.getByTestId('scroller')
    setMetric(scroller, 'clientHeight', 100)
    setMetric(scroller, 'scrollHeight', 300)

    setMetric(scroller, 'scrollTop', 0)
    fireEvent.scroll(scroller)
    expect(scroller.hasAttribute('data-scroll-before')).toBe(false)
    expect(scroller.hasAttribute('data-scroll-after')).toBe(true)

    setMetric(scroller, 'scrollTop', 100)
    fireEvent.scroll(scroller)
    expect(scroller.hasAttribute('data-scroll-before')).toBe(true)
    expect(scroller.hasAttribute('data-scroll-after')).toBe(true)

    setMetric(scroller, 'scrollTop', 200)
    fireEvent.scroll(scroller)
    expect(scroller.hasAttribute('data-scroll-before')).toBe(true)
    expect(scroller.hasAttribute('data-scroll-after')).toBe(false)
  })
})
