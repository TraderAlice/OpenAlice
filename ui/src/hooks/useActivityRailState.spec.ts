// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useActivityBarCollapse } from '../live/activity-bar-collapse'
import { useActivityRailState } from './useActivityRailState'

beforeEach(() => useActivityBarCollapse.setState({ railCollapsed: false }))
afterEach(cleanup)

describe('primary activity rail', () => {
  it.each([true, false])('preserves saved preference %s across rerenders', (saved) => {
    useActivityBarCollapse.setState({ railCollapsed: saved })
    const view = renderHook(() => useActivityRailState(false))
    expect(view.result.current.collapsed).toBe(saved)
    view.rerender()
    expect(view.result.current.collapsed).toBe(saved)
    act(() => view.result.current.toggle())
    expect(view.result.current.collapsed).toBe(!saved)
    expect(useActivityBarCollapse.getState().railCollapsed).toBe(!saved)
    view.rerender()
    expect(view.result.current.collapsed).toBe(!saved)
  })

  it('allows manual expansion at compact widths and preserves it across breakpoints', () => {
    useActivityBarCollapse.setState({ railCollapsed: null })
    const view = renderHook(({ compact }) => useActivityRailState(compact), { initialProps: { compact: true } })
    expect(view.result.current.collapsed).toBe(true)
    act(() => view.result.current.toggle())
    expect(view.result.current.collapsed).toBe(false)
    expect(useActivityBarCollapse.getState().railCollapsed).toBe(false)
    view.rerender({ compact: false })
    expect(view.result.current.collapsed).toBe(false)
    act(() => view.result.current.toggle())
    expect(view.result.current.collapsed).toBe(true)
    expect(useActivityBarCollapse.getState().railCollapsed).toBe(true)
  })
})
