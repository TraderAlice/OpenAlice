// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { IssueSnapshot } from '../api/issues'
import { useIssues } from './useIssues'

const { getIssuesMock } = vi.hoisted(() => ({ getIssuesMock: vi.fn() }))

vi.mock('../api', () => ({
  api: { issues: { get: getIssuesMock } },
}))

function snapshot(id: string): IssueSnapshot {
  return {
    workspaces: [{
      wsId: 'ws-a',
      tag: 'weekly',
      status: 'ok',
      issues: [{
        id,
        title: `Issue ${id}`,
        status: 'todo',
        priority: 'medium',
        assignee: '@new-each-run',
      }],
    }],
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

describe('useIssues source epochs', () => {
  it('does not attribute a process-warm cache to the current hook request', async () => {
    getIssuesMock.mockReset()
    getIssuesMock.mockResolvedValueOnce(snapshot('cached'))
    const first = renderHook(() => useIssues())
    await waitFor(() => expect(first.result.current).toMatchObject({
      requestEpoch: 1,
      successEpoch: 1,
    }))
    first.unmount()

    const fresh = deferred<IssueSnapshot>()
    getIssuesMock.mockReturnValueOnce(fresh.promise)
    const remounted = renderHook(() => useIssues())
    expect(remounted.result.current.data?.workspaces[0]?.issues[0]?.id).toBe('cached')
    await waitFor(() => expect(remounted.result.current).toMatchObject({
      requestEpoch: 1,
      successEpoch: 0,
    }))

    await act(async () => {
      fresh.resolve(snapshot('fresh'))
      await fresh.promise
    })
    await waitFor(() => expect(remounted.result.current).toMatchObject({
      requestEpoch: 1,
      successEpoch: 1,
    }))
    expect(remounted.result.current.data?.workspaces[0]?.issues[0]?.id).toBe('fresh')
  })
})
