// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useActivityBarCollapse } from '../live/activity-bar-collapse'
import { useActivityRailState } from './useActivityRailState'

beforeEach(() => useActivityBarCollapse.setState({ railCollapsed: false }))
afterEach(cleanup)

describe('contextual activity rail', () => {
  it.each([true, false])('restores saved preference %s after temporary workbench expansion', (saved) => {
    useActivityBarCollapse.setState({ railCollapsed: saved })
    const view = renderHook(({ workbench }) => useActivityRailState(workbench, false), { initialProps: { workbench: false } })
    expect(view.result.current.collapsed).toBe(saved)
    view.rerender({ workbench: true })
    expect(view.result.current.collapsed).toBe(true)
    act(() => view.result.current.toggle())
    expect(view.result.current.collapsed).toBe(false)
    expect(useActivityBarCollapse.getState().railCollapsed).toBe(saved)
    view.rerender({ workbench: false })
    expect(view.result.current.collapsed).toBe(saved)
    view.rerender({ workbench: true })
    expect(view.result.current.collapsed).toBe(true)
  })

  it('allows manual expansion at compact widths, both inside and outside a workbench', () => {
    useActivityBarCollapse.setState({ railCollapsed: null })
    const view = renderHook(({ workbench }) => useActivityRailState(workbench, true), { initialProps: { workbench: false } })
    expect(view.result.current.collapsed).toBe(true)
    act(() => view.result.current.toggle())
    expect(view.result.current.collapsed).toBe(false)
    expect(useActivityBarCollapse.getState().railCollapsed).toBe(false)
    view.rerender({ workbench: true })
    expect(view.result.current.collapsed).toBe(true)
    act(() => view.result.current.toggle())
    expect(view.result.current.collapsed).toBe(false)
    act(() => view.result.current.toggle())
    expect(view.result.current.collapsed).toBe(true)
    expect(useActivityBarCollapse.getState().railCollapsed).toBe(false)
  })
})
