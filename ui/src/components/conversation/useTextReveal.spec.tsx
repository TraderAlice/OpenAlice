import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { revealPrefix, useTextReveal } from './useTextReveal'

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })
describe('conversation text reveal', () => {
  it('keeps emoji graphemes and rich references intact', () => {
    expect(revealPrefix('👩‍💻你好', 1)).toBe('👩‍💻')
    expect(revealPrefix('Hi [[sticker/wave.png]]!', 10)).toBe('Hi ')
    expect(revealPrefix('Hi [[market/a/1d', 100)).toBe('Hi ')
    expect(revealPrefix('[Install](https://example.com)', 12)).toBe('')
    expect(revealPrefix('**hello**', 1)).toBe('')
  })
  it('animates fresh text, catches up, and flushes immediately on stop', () => {
    vi.useFakeTimers()
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => window.setTimeout(() => cb(performance.now()), 16))
    vi.stubGlobal('cancelAnimationFrame', clearTimeout)
    const { result, rerender, unmount } = renderHook(({ text, animate }) => useTextReveal(text, animate), { initialProps: { text: 'abcdefghijklmnopqrstuvwxyz', animate: true } })
    expect(result.current).toBe('')
    act(() => vi.advanceTimersByTime(80))
    expect(result.current.length).toBeGreaterThan(0)
    expect(result.current.length).toBeLessThan(26)
    rerender({ text: 'abcdefghijklmnopqrstuvwxyz!', animate: false })
    expect(result.current).toBe('abcdefghijklmnopqrstuvwxyz!')
    unmount()
    expect(vi.getTimerCount()).toBe(0)
  })
  it('renders history and reduced-motion text without animation', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }))
    const { result } = renderHook(() => useTextReveal('History', false))
    expect(result.current).toBe('History')
    const reduced = renderHook(() => useTextReveal('Live', true))
    expect(reduced.result.current).toBe('Live')
  })
})
