// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { IssueSnapshot } from '../api/issues'
import { issuesApi } from '../api/issues'
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


it('applies the server Issue after a write and preserves data on failure', async () => {
  getIssuesMock.mockResolvedValue(snapshot('editable'))
  const hook = renderHook(() => useIssues())
  await waitFor(() => expect(hook.result.current.successEpoch).toBe(1))
  const updated = { ...snapshot('editable').workspaces[0].issues[0], status: 'done' as const }
  const update = vi.spyOn(issuesApi, 'update').mockResolvedValue({ issue: updated } as Awaited<ReturnType<typeof issuesApi.update>>)
  await act(async () => { await hook.result.current.updateIssue('ws-a', 'editable', { status: 'done' }) })
  expect(hook.result.current.data?.workspaces[0].issues[0].status).toBe('done')
  update.mockRejectedValueOnce(new Error('write rejected'))
  await act(async () => { await expect(hook.result.current.updateIssue('ws-a', 'editable', { status: 'todo' })).rejects.toThrow('write rejected') })
  expect(hook.result.current.data?.workspaces[0].issues[0].status).toBe('done')
  update.mockRestore()
  hook.unmount()
})
