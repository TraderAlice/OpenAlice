// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useOfficeFloor } from './useOfficeFloor'

const floor = vi.fn()

vi.mock('../api', () => ({
  api: {
    office: {
      floor: (...args: unknown[]) => floor(...args),
    },
  },
}))

beforeEach(() => {
  floor.mockReset()
})

afterEach(() => {
  cleanup()
})

describe('useOfficeFloor', () => {
  it('loads the building and surfaces errors', async () => {
    floor.mockResolvedValue({
      config: {
        workspaceSleepAfterMs: 3 * 24 * 60 * 60 * 1000,
        harnessMinimumVisibleGroups: { chat: 1, 'auto-quant': 1, prediction: 1, other: 0 },
      },
      offices: [{
        workspace: { id: 'office-1', tag: 'chat', harness: 'chat' },
        lastInteractionAt: 1,
        sleeping: false,
        employees: [],
      }],
      lastSeq: 0,
      firstSeq: 0,
    })
    const { result } = renderHook(() => useOfficeFloor())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.building?.offices[0]?.workspace.id).toBe('office-1')
    expect(floor).toHaveBeenCalledWith(undefined)

    floor.mockRejectedValue(new Error('offline'))
    await act(async () => {
      await result.current.refresh()
    })
    expect(result.current.error).toBe('offline')
  })

  it('passes asOfSeq and does not poll while scrubbing', async () => {
    floor.mockResolvedValue({
      config: {
        workspaceSleepAfterMs: 3 * 24 * 60 * 60 * 1000,
        harnessMinimumVisibleGroups: { chat: 1, 'auto-quant': 1, prediction: 1, other: 0 },
      },
      offices: [],
      lastSeq: 4,
      firstSeq: 1,
      asOfSeq: 2,
    })
    const { result } = renderHook(() => useOfficeFloor(2))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(floor).toHaveBeenCalledWith({ asOfSeq: 2 })
    expect(result.current.building?.asOfSeq).toBe(2)
  })

  it('skips interval polling while hidden and refreshes immediately when visible again', async () => {
    vi.useFakeTimers()
    const visibility = Object.getOwnPropertyDescriptor(document, 'visibilityState')
    try {
      floor.mockResolvedValue({
        config: {
          workspaceSleepAfterMs: 3 * 24 * 60 * 60 * 1000,
          harnessMinimumVisibleGroups: { chat: 1, 'auto-quant': 1, prediction: 1, other: 0 },
        },
        offices: [],
        lastSeq: 1,
        firstSeq: 1,
      })
      const { unmount } = renderHook(() => useOfficeFloor())
      await act(async () => {
        await Promise.resolve()
      })
      expect(floor).toHaveBeenCalledTimes(1)

      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' })
      await act(async () => {
        vi.advanceTimersByTime(8_000)
      })
      expect(floor).toHaveBeenCalledTimes(1)

      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
      await act(async () => {
        document.dispatchEvent(new Event('visibilitychange'))
      })
      expect(floor).toHaveBeenCalledTimes(2)
      unmount()
    } finally {
      if (visibility) Object.defineProperty(document, 'visibilityState', visibility)
      else Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
      vi.useRealTimers()
    }
  })
})
