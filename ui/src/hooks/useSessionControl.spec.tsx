// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { useSessionControl } from './useSessionControl'
afterEach(() => vi.unstubAllGlobals())
const state = { execution: { executionId: 'e', phase: 'running' }, blocks: [], cooldownSeconds: 600, serverNow: 123 }
it('binds interruption to the displayed execution and refreshes authoritative state', async () => {
  const fetcher = vi.fn(async (_path: string, init?: RequestInit) => new Response(JSON.stringify(init ? { stopped: true } : state)))
  vi.stubGlobal('fetch', fetcher)
  const { result, unmount } = renderHook(() => useSessionControl('w', 's'))
  expect(result.current.data).toBeNull()
  await waitFor(() => expect(result.current.data?.execution?.executionId).toBe('e'))
  await act(async () => result.current.interrupt('e'))
  expect(fetcher).toHaveBeenCalledWith('/api/workspaces/w/sessions/s/interrupt', expect.objectContaining({ body: '{"executionId":"e"}' }))
  expect(result.current.busy).toBe(false)
  unmount()
})
it('drops late responses after selection changes and reports failures', async () => {
  let resolve!: (value: Response) => void
  const fetcher = vi.fn((path: string) => path.includes('/old/')
    ? new Promise<Response>(done => { resolve = done })
    : Promise.resolve(new Response(JSON.stringify({ message: 'unavailable' }), { status: 503 })))
  vi.stubGlobal('fetch', fetcher)
  const { result, rerender, unmount } = renderHook(({ id }) => useSessionControl('w', id), { initialProps: { id: 'old' } })
  rerender({ id: 'new' })
  await act(async () => resolve(new Response(JSON.stringify(state))))
  await waitFor(() => expect(result.current.error).toContain('unavailable'))
  expect(result.current.data).toBeNull()
  unmount()
})
