// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { NewsListResponse } from '../api/types'

const mocks = vi.hoisted(() => ({ list: vi.fn() }))
vi.mock('../api', () => ({ api: { news: { list: mocks.list } } }))

import { useNewsFeed } from './useNewsFeed'

function response(title: string): NewsListResponse {
  return {
    items: [{ time: '2026-07-29T10:00:00.000Z', title, content: title, source: 'Reuters', link: null, categories: 'markets' }],
    count: 1,
    lookback: '24h',
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

beforeEach(() => { mocks.list.mockReset() })
afterEach(() => { cleanup(); vi.useRealTimers(); vi.clearAllMocks() })

describe('useNewsFeed request lifecycle', () => {
  it('aborts the previous request when a refresh supersedes it', async () => {
    const first = deferred<NewsListResponse>()
    mocks.list.mockReturnValueOnce(first.promise).mockResolvedValueOnce(response('fresh'))
    const hook = renderHook(() => useNewsFeed({ lookback: '24h', limit: 200 }))

    await waitFor(() => expect(mocks.list).toHaveBeenCalledOnce())
    const firstSignal = mocks.list.mock.calls[0][1] as AbortSignal

    act(() => { hook.result.current.refresh() })
    await waitFor(() => expect(mocks.list).toHaveBeenCalledTimes(2))

    expect(firstSignal.aborted).toBe(true)
    await waitFor(() => expect(hook.result.current.articles[0]?.title).toBe('fresh'))
    hook.unmount()
  })
  it('allows a slow initial request to finish across polling intervals', async () => {
    vi.useFakeTimers()
    const pending = deferred<NewsListResponse>()
    mocks.list.mockReturnValue(pending.promise)
    const hook = renderHook(() => useNewsFeed({ lookback: '24h' }))
    await act(async () => { await vi.advanceTimersByTimeAsync(120_000) })
    expect(mocks.list).toHaveBeenCalledOnce()
    await act(async () => { pending.resolve(response('Slow but complete')); await pending.promise })
    expect(hook.result.current.loading).toBe(false)
    expect(hook.result.current.articles[0]?.title).toBe('Slow but complete')
  })
})
