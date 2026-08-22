// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { defaultUiLayout } from '../live/ui-layout'
import { useUiLayout, useUiLayoutStore } from './useUiLayout'

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  put: vi.fn(),
}))

vi.mock('../api', () => ({
  api: { uiLayout: { get: mocks.get, put: mocks.put } },
}))

const customLayout = {
  ...defaultUiLayout(),
  hidden: ['dev', 'market'] as const,
}

beforeEach(() => {
  mocks.get.mockResolvedValue(customLayout)
  mocks.put.mockImplementation(async (layout: unknown) => layout)
  useUiLayoutStore.setState({
    layout: defaultUiLayout(),
    loading: true,
    error: null,
    loaded: false,
    inflight: null,
  })
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('useUiLayout', () => {
  it('starts from the default document so Dev stays hidden while loading', async () => {
    const { result } = renderHook(() => useUiLayout())
    expect(result.current.loading).toBe(true)
    expect(result.current.layout.hidden).toContain('dev')
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.layout.hidden).toEqual(['dev', 'market'])
    expect(result.current.error).toBeNull()
  })

  it('reports errors without replacing the optimistic default', async () => {
    mocks.get.mockRejectedValueOnce(new Error('backend offline'))
    const { result } = renderHook(() => useUiLayout())
    await waitFor(() => expect(result.current.error).toBe('backend offline'))
    expect(result.current.layout.hidden).toEqual(['dev'])
  })

  it('saves through the same domain boundary and updates the shared store', async () => {
    const { result } = renderHook(() => useUiLayout())
    await waitFor(() => expect(result.current.loading).toBe(false))

    const next: import('../live/ui-layout').UiLayout = {
      ...defaultUiLayout(),
      hidden: ['dev', 'market'],
    }
    await act(async () => { await result.current.save(next) })
    expect(mocks.put).toHaveBeenCalledWith(next)
    expect(result.current.layout.hidden).toEqual(['dev', 'market'])
  })
})
