import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useReferenceBoard } from './useReferenceBoard'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

async function flushPromises() {
  await Promise.resolve()
  await Promise.resolve()
}

describe('useReferenceBoard', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('marks a cold first load as slow after the configured threshold', async () => {
    const pending = deferred<{ ok: true }>()
    const fetcher = vi.fn(() => pending.promise)
    const { result } = renderHook(() => useReferenceBoard(fetcher, 60_000, { slowMs: 100 }))

    expect(result.current.loading).toBe(true)
    expect(result.current.slow).toBe(false)

    await act(async () => {
      vi.advanceTimersByTime(100)
    })

    expect(result.current.loading).toBe(true)
    expect(result.current.slow).toBe(true)

    await act(async () => {
      pending.resolve({ ok: true })
      await pending.promise
    })

    expect(result.current.data).toEqual({ ok: true })
    expect(result.current.loading).toBe(false)
    expect(result.current.slow).toBe(false)
  })

  it('does not flash slow when the first load resolves before the threshold', async () => {
    const pending = deferred<{ rows: number[] }>()
    const fetcher = vi.fn(() => pending.promise)
    const { result } = renderHook(() => useReferenceBoard(fetcher, 60_000, { slowMs: 100 }))

    await act(async () => {
      vi.advanceTimersByTime(50)
      pending.resolve({ rows: [1] })
      await pending.promise
    })

    expect(result.current.data).toEqual({ rows: [1] })
    expect(result.current.loading).toBe(false)
    expect(result.current.slow).toBe(false)
  })

  it('surfaces errors and lets callers retry', async () => {
    const fetcher = vi
      .fn<() => Promise<{ value: number }>>()
      .mockRejectedValueOnce(new Error('calendar failed'))
      .mockResolvedValueOnce({ value: 42 })

    const { result } = renderHook(() => useReferenceBoard(fetcher, 60_000, { slowMs: 100 }))

    await act(async () => {
      await flushPromises()
    })

    expect(result.current.error).toBe('calendar failed')
    expect(result.current.loading).toBe(false)
    expect(result.current.slow).toBe(false)

    await act(async () => {
      await result.current.retry()
    })

    expect(result.current.data).toEqual({ value: 42 })
    expect(result.current.error).toBeNull()
    expect(fetcher).toHaveBeenCalledTimes(2)
  })
})
