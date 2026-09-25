// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { SessionTakeoverProvider, useSessionTakeovers, type TakeoverRequest } from './useSessionTakeovers'
afterEach(() => { cleanup(); vi.unstubAllGlobals() })
const row: TakeoverRequest = { id: 'ask', workspaceId: 'ws', recordId: 'session', resumeId: 'resume', sessionTitle: 'Research', origin: { kind: 'issue', entry: 'scan' }, requestedAt: Date.now(), deadline: Date.now() + 60000, idleSeconds: 60, state: 'pending' }
it('opens a new request once, keeps a dismissed request, and submits the exact decision', async () => {
  let requests = [row]
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith('/decision')) { expect(JSON.parse(String(init?.body))).toEqual({ decision: 'reject' }); requests = [{ ...row, state: 'rejected' }] }
    return { ok: true, json: async () => ({ requests, idleSeconds: 60, serverNow: Date.now() }) }
  })
  vi.stubGlobal('fetch', fetcher)
  const { result } = renderHook(useSessionTakeovers, { wrapper: SessionTakeoverProvider })
  await waitFor(() => expect(result.current?.selected).toBe('ask'))
  act(() => result.current?.select(null))
  expect(result.current?.requests[0].state).toBe('pending')
  act(() => { result.current?.activity('ws', 'session'); result.current?.activity('ws', 'session') })
  expect(fetcher.mock.calls.filter(([url]) => url.endsWith('/activity'))).toHaveLength(1)
  await act(async () => { await result.current?.decide('ask', 'reject') })
  expect(result.current?.requests[0].state).toBe('rejected')
  expect(result.current?.selected).toBeNull()
})
it('shows decision failure without falsely removing the pending request', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => ({ ok: !url.endsWith('/decision'), status: 409, json: async () => url.endsWith('/decision') ? { message: 'Already handed over' } : { requests: [row], idleSeconds: 60, serverNow: Date.now() } })))
  const { result } = renderHook(useSessionTakeovers, { wrapper: SessionTakeoverProvider })
  await waitFor(() => expect(result.current?.selected).toBe('ask'))
  await act(async () => { await result.current?.decide('ask', 'approve') })
  expect(result.current?.error).toContain('Already handed over')
  expect(result.current?.requests[0].state).toBe('pending')
})
