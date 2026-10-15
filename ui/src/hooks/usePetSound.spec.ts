// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { usePetSound } from './usePetSound'
afterEach(() => { cleanup(); Reflect.deleteProperty(window, 'openAlice'); vi.unstubAllGlobals() })
function bridge() {
  let state: PetSoundSettings = { enabled: true, volume: .5, source: null }
  let notify = (_value: PetSoundSettings) => {}
  const api = {
    getSound: vi.fn(async () => state),
    updateSound: vi.fn(async (patch: Partial<PetSoundSettings>) => { state = { ...state, ...patch }; notify(state); return state }),
    resetSound: vi.fn(async () => { state = { enabled: true, volume: .5, source: null }; notify(state); return state }),
    onSound: vi.fn((callback: typeof notify) => { notify = callback; return vi.fn() }),
  }
  Object.defineProperty(window, 'openAlice', { configurable: true, value: { companion: api } })
  return api
}
describe('pet sound settings hook', () => {
  it('has no fake browser audio settings', () => {
    const { result } = renderHook(usePetSound)
    expect(result.current.settings).toBeNull(); expect(result.current.loading).toBe(false)
  })
  it('loads defaults, persists patches and resets', async () => {
    const api = bridge(), { result } = renderHook(usePetSound)
    await waitFor(() => expect(result.current.loading).toBe(false))
    await act(() => result.current.update({ enabled: false, volume: .1 }))
    expect(result.current.settings?.enabled).toBe(false)
    await act(() => result.current.reset())
    expect(api.resetSound).toHaveBeenCalledOnce()
  })
  it('rejects unsupported audio without changing saved settings', async () => {
    const api = bridge(), { result } = renderHook(usePetSound)
    await waitFor(() => expect(result.current.settings).not.toBeNull())
    await act(() => result.current.importFile(new File(['x'], 'script.html')))
    expect(result.current.error).toBe('invalidFile')
    expect(api.updateSound).not.toHaveBeenCalled()
  })
  it('reports load and save errors without claiming success', async () => {
    const api = bridge(); api.getSound.mockRejectedValue(new Error('offline'))
    const { result } = renderHook(usePetSound)
    await waitFor(() => expect(result.current.error).toBe('unavailable'))
    api.updateSound.mockRejectedValue(new Error('disk full'))
    await act(() => result.current.update({ volume: .1 }))
    expect(result.current.error).toBe('failed'); expect(result.current.pending).toBe(false)
  })
})
