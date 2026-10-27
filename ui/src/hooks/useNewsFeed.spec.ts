// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { NewsListResponse } from '../api/types'
import { demoNewsStoryPreviews } from '../demo/fixtures/news'

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
  it('reloads the server query when reading status changes', async () => {
    mocks.list.mockResolvedValue({ ...response('Stored reports'), stories: [] })
    const { rerender } = renderHook(({ readStatus }: { readStatus: 'unread' | 'updated' }) => useNewsFeed({ includeStories: true, readStatus }), { initialProps: { readStatus: 'unread' } })
    await waitFor(() => expect(mocks.list).toHaveBeenLastCalledWith(expect.objectContaining({ readStatus: 'unread' }), expect.any(AbortSignal)))
    rerender({ readStatus: 'updated' })
    await waitFor(() => expect(mocks.list).toHaveBeenLastCalledWith(expect.objectContaining({ readStatus: 'updated' }), expect.any(AbortSignal)))
    expect(mocks.list).toHaveBeenCalledTimes(2)
  })

  it('does not show events from an earlier query when the new event query fails', async () => {
    mocks.list.mockResolvedValueOnce({ ...response('Original query'), stories: [demoNewsStoryPreviews[0]], storyNextOffset: 50 })
      .mockResolvedValueOnce({ ...response('New query'), items: [], storyError: true })
    const hook = renderHook(({ source }) => useNewsFeed({ includeStories: true, source }, false), { initialProps: { source: 'first' } })
    await waitFor(() => expect(hook.result.current.stories).toHaveLength(1))
    hook.rerender({ source: 'second' })
    await waitFor(() => expect(hook.result.current.storyError).toBe(true))
    expect(hook.result.current.stories).toEqual([])
    expect(hook.result.current.storyNextOffset).toBeNull()
  })

  it('retains the same event page and cursor if refreshing that query fails', async () => {
    mocks.list.mockResolvedValueOnce({ ...response('Original query'), stories: [demoNewsStoryPreviews[0]], storyNextOffset: 50 })
      .mockResolvedValueOnce({ ...response('Original query'), storyError: true })
    const hook = renderHook(() => useNewsFeed({ includeStories: true }, false))
    await waitFor(() => expect(hook.result.current.stories).toHaveLength(1))
    act(() => hook.result.current.refresh())
    await waitFor(() => expect(hook.result.current.storyError).toBe(true))
    expect(hook.result.current.stories).toEqual([demoNewsStoryPreviews[0]])
    expect(hook.result.current.storyNextOffset).toBe(50)
  })

  it('keeps the reading stream until new reports are explicitly accepted', async () => {
    vi.useFakeTimers()
    mocks.list.mockResolvedValueOnce(response('Reading')).mockResolvedValue(response('New report'))
    const hook = renderHook(() => useNewsFeed({ lookback: '24h' }))
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000) })
    expect(hook.result.current.articles[0].title).toBe('Reading')
    expect(hook.result.current.newArticleCount).toBe(1)
    await act(async () => { hook.result.current.acceptUpdates() })
    expect(hook.result.current.articles[0].title).toBe('New report')
    expect(hook.result.current.newArticleCount).toBe(0)
    expect(mocks.list).toHaveBeenCalledTimes(2)
  })

  it('counts new durable IDs rather than changes to an existing headline', async () => {
    vi.useFakeTimers()
    mocks.list.mockResolvedValueOnce({ ...response('Reading'), items: [{ ...response('Reading').items[0], id: 1 }] })
      .mockResolvedValueOnce({ ...response('Reworded'), items: [{ ...response('Reworded').items[0], id: 1 }] })
    const hook = renderHook(() => useNewsFeed({ lookback: '24h' }))
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000) })
    expect(hook.result.current.articles[0].title).toBe('Reading')
    expect(hook.result.current.newArticleCount).toBe(0)
  })

  it('clears pending reports when changing the query', async () => {
    vi.useFakeTimers()
    mocks.list.mockResolvedValueOnce(response('Reading')).mockResolvedValueOnce(response('Old query update'))
      .mockResolvedValueOnce(response('New query'))
    const hook = renderHook(({ source }) => useNewsFeed({ source }), { initialProps: { source: 'first' } })
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000) })
    expect(hook.result.current.newArticleCount).toBe(1)
    hook.rerender({ source: 'second' })
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(hook.result.current.articles[0].title).toBe('New query')
    expect(hook.result.current.newArticleCount).toBe(0)
    await act(async () => { hook.result.current.acceptUpdates() })
    expect(hook.result.current.articles[0].title).toBe('New query')
  })

  it('does not replace the reading stream when an automatic request finishes after pausing', async () => {
    vi.useFakeTimers()
    const pending = deferred<NewsListResponse>()
    mocks.list.mockResolvedValueOnce(response('Reading')).mockReturnValueOnce(pending.promise)
    const hook = renderHook(({ automatic }) => useNewsFeed({ lookback: '24h' }, automatic), { initialProps: { automatic: true } })
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000) })
    hook.rerender({ automatic: false })
    await act(async () => { pending.resolve(response('New report')); await pending.promise })
    expect(hook.result.current.articles[0].title).toBe('Reading')
    expect(hook.result.current.refreshing).toBe(false)
  })
  it('pauses polling without clearing news and still supports manual refresh', async () => {
    vi.useFakeTimers()
    mocks.list.mockResolvedValue(response('Reading'))
    const hook = renderHook(({ automatic }) => useNewsFeed({ lookback: '24h' }, automatic), { initialProps: { automatic: true } })
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    hook.rerender({ automatic: false })
    await act(async () => { await vi.advanceTimersByTimeAsync(120_000) })
    expect(mocks.list).toHaveBeenCalledOnce()
    expect(hook.result.current.articles[0].title).toBe('Reading')
    await act(async () => hook.result.current.refresh())
    expect(mocks.list).toHaveBeenCalledTimes(2)
    hook.rerender({ automatic: true })
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000) })
    expect(mocks.list).toHaveBeenCalledTimes(3)
  })
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
