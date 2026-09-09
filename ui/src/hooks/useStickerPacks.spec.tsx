// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { useStickerPacks } from './useStickerPacks'
afterEach(() => { cleanup(); vi.unstubAllGlobals() })
it('loads catalog, refreshes after mutation, and exposes failures', async () => {
  const data = { packs: [], defaultPackId: 'color', workspaces: [] }
  const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => data })
  vi.stubGlobal('fetch', fetch)
  const { result } = renderHook(() => useStickerPacks())
  await waitFor(() => expect(result.current.data).toEqual(data))
  await act(async () => { await result.current.request('/default', { packId: 'ink' }, 'PUT'); result.current.refresh() })
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(3))
  fetch.mockResolvedValueOnce({ ok: false, status: 400, json: async () => ({ error: 'invalid pack' }) })
  await act(async () => { await expect(result.current.request('/import', new FormData())).rejects.toThrow('invalid pack') })
  expect(result.current.error).toBe('invalid pack')
  expect(result.current.busy).toBe(false)
})
