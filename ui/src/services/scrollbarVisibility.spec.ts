// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { installScrollbarVisibilityController } from './scrollbarVisibility'

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  document.body.replaceChildren()
})

describe('installScrollbarVisibilityController', () => {
  it('marks the scrolling owner through gesture settlement', () => {
    const scroller = document.createElement('div')
    document.body.append(scroller)
    const cleanup = installScrollbarVisibilityController()

    scroller.dispatchEvent(new Event('scroll'))
    expect(scroller.hasAttribute('data-scrollbar-active')).toBe(true)

    scroller.dispatchEvent(new Event('scrollend'))
    expect(scroller.hasAttribute('data-scrollbar-active')).toBe(false)
    cleanup()
  })

  it('clears active owners during teardown', () => {
    const scroller = document.createElement('div')
    document.body.append(scroller)
    const cleanup = installScrollbarVisibilityController()

    scroller.dispatchEvent(new Event('scroll'))
    cleanup()

    expect(scroller.hasAttribute('data-scrollbar-active')).toBe(false)
    vi.advanceTimersByTime(1_000)
    expect(scroller.hasAttribute('data-scrollbar-active')).toBe(false)
  })
})
