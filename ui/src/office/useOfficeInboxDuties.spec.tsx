// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { InboxEntry, InboxHistoryResponse } from '../api/inbox'
import {
  projectOfficeInboxDeliveries,
  projectOfficeInboxEvidence,
  readOfficeInboxHistory,
  useOfficeInboxDuties,
} from './useOfficeInboxDuties'

const {
  historyMock,
  markReadMock,
  refreshInboxMock,
  setReadAtMock,
} = vi.hoisted(() => ({
  historyMock: vi.fn(),
  markReadMock: vi.fn(),
  refreshInboxMock: vi.fn(),
  setReadAtMock: vi.fn(),
}))

vi.mock('../api', () => ({
  api: {
    inbox: {
      history: historyMock,
      markRead: markReadMock,
    },
  },
}))

vi.mock('../live/inbox', () => ({
  refreshInbox: refreshInboxMock,
  setInboxReadAtOptimistically: setReadAtMock,
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, params?: { count?: number }) => params?.count == null
      ? key
      : `${key}:${params.count}`,
  }),
}))

function entry(id: string, ts: number, overrides: Partial<InboxEntry> = {}): InboxEntry {
  return {
    id,
    ts,
    workspaceId: 'research-desk',
    workspaceLabel: 'Research desk',
    comments: `# Delivery ${id}\n\nEvidence is ready.`,
    docs: [{ path: `reports/${id}.md`, revision: `rev-${id}` }],
    ...overrides,
  }
}

function page(entries: InboxEntry[], hasMore = false): InboxHistoryResponse {
  return { entries, hasMore }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((done, fail) => {
    resolve = done
    reject = fail
  })
  return { promise, resolve, reject }
}

beforeEach(() => {
  historyMock.mockReset()
  markReadMock.mockReset()
  refreshInboxMock.mockReset()
  setReadAtMock.mockReset()
})

describe('readOfficeInboxHistory', () => {
  it('reads every page newest-first and deduplicates overlapping rows', async () => {
    const newest = entry('newest', 300)
    const overlap = entry('overlap', 200)
    const oldest = entry('oldest', 100)
    const history = vi.fn()
      .mockResolvedValueOnce(page([newest, overlap], true))
      .mockResolvedValueOnce(page([overlap, oldest]))

    await expect(readOfficeInboxHistory(history)).resolves.toEqual([
      newest,
      overlap,
      oldest,
    ])
    expect(history).toHaveBeenNthCalledWith(1, { limit: 200 })
    expect(history).toHaveBeenNthCalledWith(2, { limit: 200, before: 'overlap' })
  })

  it('fails closed when a paginated response cannot advance', async () => {
    const repeated = entry('same-cursor', 100)
    const history = vi.fn().mockResolvedValue(page([repeated], true))

    await expect(readOfficeInboxHistory(history)).rejects.toThrow(
      'Inbox history pagination did not advance.',
    )
  })

  it('fails closed when a page cursor disappears between reads', async () => {
    const cursor = entry('deleted-cursor', 100)
    const history = vi.fn()
      .mockResolvedValueOnce(page([cursor], true))
      .mockResolvedValueOnce(page([]))

    await expect(readOfficeInboxHistory(history)).rejects.toThrow(
      'Inbox history pagination cursor disappeared.',
    )
  })
})

describe('projectOfficeInboxDeliveries', () => {
  it('keeps every durable unread entry and excludes server-confirmed reads', () => {
    const unread = entry('unread', 200)
    const commentsOnly = entry('comments', 100, { docs: undefined })
    const read = entry('read', 300, { readAt: 400 })

    const projected = projectOfficeInboxDeliveries([read, unread, commentsOnly], {
      untitled: 'Untitled',
      unreadLabel: 'Unread',
      moreAttachments: (count) => `+${count}`,
    })

    expect(projected.map((item) => item.entry.id)).toEqual(['unread', 'comments'])
    expect(projected[0]).toMatchObject({
      title: 'Delivery unread',
      excerpt: 'Evidence is ready.',
    })
  })

  it('keeps presentation evidence for already-read history rows', () => {
    const read = entry('read-report', 300, { readAt: 400 })

    const projected = projectOfficeInboxEvidence([read], {
      untitled: 'Untitled',
      unreadLabel: 'Unread',
      moreAttachments: (count) => `+${count}`,
    })

    expect(projected.get('read-report')).toMatchObject({
      title: 'Delivery read-report',
      excerpt: 'Evidence is ready.',
      entry: { id: 'read-report', readAt: 400 },
    })
  })
})

describe('useOfficeInboxDuties', () => {
  it('retains an addressable presentation map for read history', async () => {
    const read = entry('read-report', 300, { readAt: 400 })
    historyMock.mockResolvedValueOnce(page([read]))

    const hook = renderHook(() => useOfficeInboxDuties())

    await waitFor(() => expect(hook.result.current.status).toBe('ready'))
    expect(hook.result.current.deliveries).toEqual([])
    expect(hook.result.current.evidenceByEntryId.get('read-report')).toMatchObject({
      title: 'Delivery read-report',
      entry: { id: 'read-report', readAt: 400 },
    })
  })

  it('hard-fences Shift clear while the first authoritative read is loading or failed', async () => {
    const first = deferred<InboxHistoryResponse>()
    historyMock.mockReturnValueOnce(first.promise)
    const hook = renderHook(() => useOfficeInboxDuties())

    expect(hook.result.current.status).toBe('loading')
    expect(hook.result.current).toMatchObject({ requestEpoch: 1, successEpoch: 0 })
    expect(hook.result.current.deliveries).toEqual([])

    await act(async () => {
      first.reject(new Error('offline'))
      await first.promise.catch(() => undefined)
    })
    await waitFor(() => expect(hook.result.current.status).toBe('error'))
    expect(hook.result.current).toMatchObject({ requestEpoch: 1, successEpoch: 0 })
    expect(hook.result.current.deliveries).toEqual([])
  })

  it('exposes request-start provenance across deferred authoritative responses', async () => {
    const beforeBaseline = deferred<InboxHistoryResponse>()
    historyMock.mockReturnValueOnce(beforeBaseline.promise)
    const hook = renderHook(
      ({ activitySeq }) => useOfficeInboxDuties(activitySeq),
      { initialProps: { activitySeq: 1 } },
    )
    await waitFor(() => expect(hook.result.current.requestEpoch).toBe(1))
    expect(hook.result.current.successEpoch).toBe(0)

    await act(async () => {
      beforeBaseline.resolve(page([]))
      await beforeBaseline.promise
    })
    expect(hook.result.current).toMatchObject({ requestEpoch: 1, successEpoch: 1 })

    const afterBaseline = deferred<InboxHistoryResponse>()
    historyMock.mockReturnValueOnce(afterBaseline.promise)
    hook.rerender({ activitySeq: 2 })
    await waitFor(() => expect(hook.result.current).toMatchObject({
      requestEpoch: 2,
      successEpoch: 1,
    }))

    await act(async () => {
      afterBaseline.resolve(page([]))
      await afterBaseline.promise
    })
    expect(hook.result.current).toMatchObject({ requestEpoch: 2, successEpoch: 2 })
  })

  it('keeps A after a failed receipt and removes only A after server confirmation', async () => {
    const a = entry('a', 200)
    const b = entry('b', 100)
    historyMock.mockResolvedValueOnce(page([a, b]))
    const hook = renderHook(() => useOfficeInboxDuties())
    await waitFor(() => expect(hook.result.current.status).toBe('ready'))

    historyMock.mockResolvedValueOnce(page([a, b]))
    markReadMock.mockRejectedValueOnce(new Error('write failed'))
    await expect(act(async () => {
      await hook.result.current.markReadConfirmed('a')
    })).rejects.toThrow('write failed')
    expect(hook.result.current.deliveries.map((item) => item.entry.id)).toEqual(['a', 'b'])
    expect(hook.result.current.status).toBe('ready')

    const refreshed = deferred<InboxHistoryResponse>()
    markReadMock.mockResolvedValueOnce({ ok: true, id: 'a', readAt: 500 })
    historyMock
      .mockResolvedValueOnce(page([a, b]))
      .mockReturnValueOnce(refreshed.promise)
    await act(async () => {
      await hook.result.current.markReadConfirmed('a')
    })

    expect(hook.result.current.status).toBe('loading')
    expect(hook.result.current.deliveries.map((item) => item.entry.id)).toEqual(['b'])
    expect(hook.result.current.evidenceByEntryId.get('a')).toMatchObject({
      entry: { id: 'a', readAt: 500 },
    })
    expect(setReadAtMock).toHaveBeenCalledWith('a', 500)
    expect(refreshInboxMock).toHaveBeenCalledOnce()

    await act(async () => {
      refreshed.resolve(page([b]))
      await refreshed.promise
    })
    await waitFor(() => expect(hook.result.current.status).toBe('ready'))
    expect(hook.result.current.deliveries.map((item) => item.entry.id)).toEqual(['b'])
  })

  it('does not let an older refresh resurrect A after its exact receipt succeeds', async () => {
    const a = entry('a', 200)
    const b = entry('b', 100)
    historyMock.mockResolvedValueOnce(page([a, b]))
    const hook = renderHook(
      ({ activitySeq }) => useOfficeInboxDuties(activitySeq),
      { initialProps: { activitySeq: 1 } },
    )
    await waitFor(() => expect(hook.result.current.status).toBe('ready'))

    const stale = deferred<InboxHistoryResponse>()
    historyMock.mockReturnValueOnce(stale.promise)
    hook.rerender({ activitySeq: 2 })

    const authoritative = deferred<InboxHistoryResponse>()
    markReadMock.mockResolvedValueOnce({ ok: true, id: 'a', readAt: 500 })
    historyMock
      .mockResolvedValueOnce(page([a, b]))
      .mockReturnValueOnce(authoritative.promise)
    await act(async () => {
      await hook.result.current.markReadConfirmed('a')
    })
    expect(hook.result.current.deliveries.map((item) => item.entry.id)).toEqual(['b'])

    await act(async () => {
      stale.resolve(page([a, b]))
      await stale.promise
    })
    expect(hook.result.current.deliveries.map((item) => item.entry.id)).toEqual(['b'])

    await act(async () => {
      authoritative.resolve(page([b]))
      await authoritative.promise
    })
    await waitFor(() => expect(hook.result.current.status).toBe('ready'))
    expect(hook.result.current.deliveries.map((item) => item.entry.id)).toEqual(['b'])
  })

  it('rejects duplicate stamps and a mismatched server receipt without clearing the duty', async () => {
    const a = entry('a', 100)
    historyMock.mockResolvedValueOnce(page([a]))
    const hook = renderHook(() => useOfficeInboxDuties())
    await waitFor(() => expect(hook.result.current.status).toBe('ready'))

    const pending = deferred<{ ok: true; id: string; readAt: number }>()
    markReadMock.mockReturnValueOnce(pending.promise)
    historyMock.mockResolvedValueOnce(page([a]))
    let first!: ReturnType<typeof hook.result.current.markReadConfirmed>
    act(() => {
      first = hook.result.current.markReadConfirmed('a')
    })
    await expect(hook.result.current.markReadConfirmed('a')).rejects.toThrow(
      'already in progress',
    )
    await act(async () => {
      pending.resolve({ ok: true, id: 'wrong', readAt: 500 })
      await first.catch(() => undefined)
    })

    expect(hook.result.current.status).toBe('ready')
    expect(hook.result.current.deliveries.map((item) => item.entry.id)).toEqual(['a'])
    expect(setReadAtMock).not.toHaveBeenCalled()
  })

  it('continues without a second server write when the exact entry is already resolved', async () => {
    const a = entry('a', 100)
    historyMock.mockResolvedValueOnce(page([a]))
    const hook = renderHook(() => useOfficeInboxDuties())
    await waitFor(() => expect(hook.result.current.status).toBe('ready'))

    const resolved = { ...a, readAt: 650 }
    historyMock.mockResolvedValueOnce(page([resolved]))

    let result: Awaited<ReturnType<typeof hook.result.current.markReadConfirmed>> | undefined
    await act(async () => {
      result = await hook.result.current.markReadConfirmed('a')
    })
    expect(result).toBe('already-resolved')
    expect(markReadMock).not.toHaveBeenCalled()
    expect(hook.result.current.status).toBe('ready')
    expect(hook.result.current.deliveries).toEqual([])
    expect(setReadAtMock).toHaveBeenCalledWith('a', 650)
    expect(refreshInboxMock).toHaveBeenCalledOnce()
  })

  it('serializes the same receipt across Office tabs and claims the server only once', async () => {
    const a = entry('a', 100)
    const resolved = { ...a, readAt: 700 }
    historyMock
      .mockResolvedValueOnce(page([a]))
      .mockResolvedValueOnce(page([a]))
    const first = renderHook(() => useOfficeInboxDuties())
    await waitFor(() => expect(first.result.current.status).toBe('ready'))
    const second = renderHook(() => useOfficeInboxDuties())
    await waitFor(() => expect(second.result.current.status).toBe('ready'))

    let lockTail: Promise<unknown> = Promise.resolve()
    const request = vi.fn((_name: string, task: () => Promise<unknown>) => {
      const result = lockTail.then(task)
      lockTail = result.then(() => undefined, () => undefined)
      return result
    })
    Object.defineProperty(navigator, 'locks', {
      configurable: true,
      value: { request },
    })
    historyMock
      .mockResolvedValueOnce(page([a]))
      .mockResolvedValueOnce(page([resolved]))
      .mockResolvedValueOnce(page([resolved]))
    markReadMock.mockResolvedValueOnce({ ok: true, id: 'a', readAt: 700 })

    let results: unknown[] = []
    await act(async () => {
      results = await Promise.all([
        first.result.current.markReadConfirmed('a'),
        second.result.current.markReadConfirmed('a'),
      ])
    })

    expect(results).toEqual(['acknowledged', 'already-resolved'])
    expect(request).toHaveBeenCalledTimes(2)
    expect(markReadMock).toHaveBeenCalledTimes(1)
    expect(second.result.current.deliveries).toEqual([])
    Object.defineProperty(navigator, 'locks', { configurable: true, value: undefined })
    first.unmount()
    second.unmount()
  })
})
