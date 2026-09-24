// @vitest-environment jsdom
import { renderHook, waitFor, cleanup } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { useSessionDetails } from './useSessionDetails'
import { getWorkspaceSessionDirectory } from '../components/workspace/api'
import { issuesApi } from '../api/issues'
vi.mock('../components/workspace/api', () => ({ getWorkspaceSessionDirectory: vi.fn() }))
vi.mock('../api/issues', () => ({ issuesApi: { get: vi.fn() } }))
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks() })
it('selects the exact identity and sorts execution history newest first', async () => {
  vi.mocked(getWorkspaceSessionDirectory).mockResolvedValue({ sessions: [{ resumeId: 'other' }, { resumeId: 'wanted', active: false }] } as never)
  vi.mocked(issuesApi.get).mockResolvedValue({ workspaces: [] })
  const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ executions: [{ executionId: 'old', requestedAt: 1 }, { executionId: 'new', requestedAt: 2 }] }) })
  vi.stubGlobal('fetch', fetcher)
  const { result } = renderHook(() => useSessionDetails('ws', 'record', 'wanted'))
  expect(result.current.loading).toBe(true)
  await waitFor(() => expect(result.current.loading).toBe(false))
  expect(result.current.entry?.resumeId).toBe('wanted')
  expect(result.current.executions.map(row => row.executionId)).toEqual(['new', 'old'])
  expect(fetcher).toHaveBeenCalledWith('/api/workspaces/ws/sessions/record/executions')
})
it('preserves available details when history fails instead of presenting total success', async () => {
  vi.mocked(getWorkspaceSessionDirectory).mockResolvedValue({ sessions: [{ resumeId: 'wanted' }] } as never)
  vi.mocked(issuesApi.get).mockResolvedValue({ workspaces: [] })
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503 }))
  const { result } = renderHook(() => useSessionDetails('ws', 'record', 'wanted'))
  await waitFor(() => expect(result.current.loading).toBe(false))
  expect(result.current.entry?.resumeId).toBe('wanted')
  expect(result.current.errors).toHaveLength(1)
  expect(result.current.issues).toEqual({ workspaces: [] })
})
