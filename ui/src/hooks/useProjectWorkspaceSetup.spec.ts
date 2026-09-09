// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { fetchJson } from '../api/client'
import { useProjectWorkspaceSetup } from './useProjectWorkspaceSetup'
vi.mock('../api/client', () => ({ fetchJson: vi.fn() }))
beforeEach(() => vi.mocked(fetchJson).mockReset())
it('loads pending workspaces and retries through the backend', async () => {
  vi.mocked(fetchJson).mockResolvedValueOnce({ pending: ['chat'], errors: { chat: 'offline' } }).mockResolvedValueOnce({ pending: [] })
  const { result } = renderHook(() => useProjectWorkspaceSetup())
  expect(result.current.setup).toBeNull()
  await waitFor(() => expect(result.current.setup?.pending).toEqual(['chat']))
  await act(async () => { await result.current.retry() })
  expect(fetchJson).toHaveBeenLastCalledWith('/api/workspaces/project-setup/retry', { method: 'POST' })
  expect(result.current.setup?.pending).toEqual([])
})
it('exposes a read failure without pretending setup is complete', async () => {
  vi.mocked(fetchJson).mockRejectedValueOnce(new Error('unavailable'))
  const { result } = renderHook(() => useProjectWorkspaceSetup())
  await waitFor(() => expect(result.current.error).toBe('unavailable'))
  expect(result.current.setup).toBeNull()
  expect(result.current.busy).toBe(false)
})
