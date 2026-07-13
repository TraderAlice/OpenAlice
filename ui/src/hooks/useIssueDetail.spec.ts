import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { api } from '../api'
import type { IssueDetail } from '../api/issues'
import { useIssueDetail } from './useIssueDetail'

vi.mock('../api', () => ({
  api: {
    issues: {
      getDetail: vi.fn(),
    },
  },
}))

function detail(what: string): IssueDetail {
  return {
    issue: {
      id: 'issue-a',
      title: 'Issue A',
      what,
      status: 'todo',
      priority: 'medium',
      assignee: 'human',
    },
    runs: [],
  }
}

describe('useIssueDetail', () => {
  beforeEach(() => {
    vi.mocked(api.issues.getDetail).mockReset()
  })

  it('does not let a GET started before a write replace the authoritative result', async () => {
    let resolveStale: ((value: IssueDetail) => void) | undefined
    vi.mocked(api.issues.getDetail).mockReturnValueOnce(new Promise((resolve) => {
      resolveStale = resolve
    }))

    const { result, unmount } = renderHook(() => useIssueDetail('ws-a', 'issue-a'))

    act(() => result.current.mutate(detail('locally saved')))
    await act(async () => {
      resolveStale?.(detail('stale poll'))
      await Promise.resolve()
    })

    expect(result.current.data?.issue.what).toBe('locally saved')
    unmount()
  })
})
