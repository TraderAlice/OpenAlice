// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useDesktopCompanion } from './useDesktopCompanion'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })
function setup(visible = false) {
  let listener: (value: boolean) => void = () => {}
  const bridge = {
    getVisible: vi.fn().mockResolvedValue(visible),
    toggle: vi.fn().mockResolvedValue(!visible),
    onVisibility: vi.fn((callback: typeof listener) => { listener = callback; return vi.fn() }),
  }
  Object.defineProperty(window, 'openAlice', { configurable: true, value: { companion: bridge } })
  return { bridge, notify: (value: boolean) => listener(value) }
}
afterEach(() => { Reflect.deleteProperty(window, 'openAlice') })
describe('desktop companion visibility', () => {
  it('does not offer a browser toggle', () => {
    expect(renderHook(() => useDesktopCompanion(true)).result.current.visible).toBeNull()
  })
  it('loads hidden state, toggles it, and follows native tray changes', async () => {
    const { bridge, notify } = setup()
    const { result } = renderHook(() => useDesktopCompanion(true))
    await waitFor(() => expect(result.current.visible).toBe(false))
    await act(() => result.current.toggle())
    expect(bridge.toggle).toHaveBeenCalledOnce()
    expect(result.current.visible).toBe(true)
    act(() => notify(false))
    expect(result.current.visible).toBe(false)
  })
  it('keeps state and reports a failed toggle', async () => {
    const { bridge } = setup()
    bridge.toggle.mockRejectedValue(new Error('IPC unavailable'))
    const { result } = renderHook(() => useDesktopCompanion(true))
    await waitFor(() => expect(result.current.visible).toBe(false))
    await act(() => result.current.toggle())
    expect(result.current.visible).toBe(false)
    expect(result.current.failed).toBe(true)
    expect(result.current.pending).toBe(false)
  })
  it('omits unavailable companions', async () => {
    const { bridge } = setup()
    bridge.getVisible.mockRejectedValue(new Error('disabled'))
    const { result } = renderHook(() => useDesktopCompanion(true))
    await act(async () => {})
    expect(result.current.visible).toBeNull()
  })
})
