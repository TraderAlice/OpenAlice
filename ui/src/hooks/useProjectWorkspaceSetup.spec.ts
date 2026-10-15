// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { fetchJson } from '../api/client'
import { useProjectWorkspaceSetup } from './useProjectWorkspaceSetup'
vi.mock('../api/client', () => ({ fetchJson: vi.fn() }))
beforeEach(() => vi.mocked(fetchJson).mockReset())
afterEach(cleanup)
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

it('clears a transient read error on the next successful poll', async () => {
  vi.mocked(fetchJson).mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ pending: [], phase: 'complete' })
  const { result } = renderHook(useProjectWorkspaceSetup)
  await waitFor(() => expect(result.current.error).toBe('offline'))
  await waitFor(() => expect(result.current.error).toBeNull(), { timeout: 2500 })
  expect(result.current.setup?.phase).toBe('complete')
})

it('joins repeated retries and keeps polling from superseding the write', async () => {
  let finish!: (value: unknown) => void
  vi.mocked(fetchJson).mockResolvedValueOnce({ pending: ['chat'], phase: 'complete', errors: { chat: 'clone failed' } })
    .mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  const { result } = renderHook(useProjectWorkspaceSetup)
  await waitFor(() => expect(result.current.setup?.phase).toBe('complete'))
  let first!: Promise<unknown>
  let second!: Promise<unknown>
  act(() => { first = result.current.retry(); second = result.current.retry() })
  expect(first).toBe(second)
  await waitFor(() => expect(result.current.busy).toBe(true))
  expect(fetchJson).toHaveBeenCalledTimes(2)
  await act(async () => { finish({ pending: [], phase: 'complete' }); await first })
  expect(result.current.busy).toBe(false)
  expect(result.current.setup?.pending).toEqual([])
})

it('does not let an older read restore errors after a successful retry', async () => {
  let finishRead!: (value: unknown) => void
  vi.mocked(fetchJson).mockImplementationOnce(() => new Promise(resolve => { finishRead = resolve }))
    .mockResolvedValueOnce({ pending: [], phase: 'complete' })
  const { result } = renderHook(useProjectWorkspaceSetup)
  await waitFor(() => expect(fetchJson).toHaveBeenCalledOnce())
  await act(async () => { await result.current.retry() })
  await act(async () => { finishRead({ pending: ['chat'], errors: { chat: 'stale failure' }, phase: 'complete' }) })
  expect(result.current.setup?.pending).toEqual([])
  expect(result.current.error).toBeNull()
})
