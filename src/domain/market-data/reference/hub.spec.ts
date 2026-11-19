import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHubFetcher, markLocal } from './hub.js'
import type { ReferenceMeta } from './types.js'

type Board = { value: number; meta: ReferenceMeta }
const board = (value: number): Board => ({ value, meta: { provider: 'fred', asOf: '2026-06-11T00:00:00Z' } })

describe('createHubFetcher', () => {
  const fetchSpy = vi.fn()

  beforeEach(() => {
    vi.useFakeTimers()
    fetchSpy.mockReset()
    vi.stubGlobal('fetch', fetchSpy)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('serves hub payloads stamped origin=hub', async () => {
    fetchSpy.mockResolvedValue(new Response(JSON.stringify(board(1))))
    const viaHub = createHubFetcher({ enabled: true, baseUrl: 'https://hub.test' })
    const result = await viaHub<Board>('macro')
    expect(result?.value).toBe(1)
    expect(result?.meta.origin).toBe('hub')
    expect(fetchSpy.mock.calls[0][0]).toBe('https://hub.test/api/reference/macro')
  })

  it('returns null when disabled — and never fetches', async () => {
    const viaHub = createHubFetcher({ enabled: false, baseUrl: 'https://hub.test' })
    expect(await viaHub<Board>('macro')).toBeNull()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('returns null on undefined config (local-only deps)', async () => {
    const viaHub = createHubFetcher(undefined)
    expect(await viaHub<Board>('macro')).toBeNull()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('HTTP errors fall to null WITHOUT tripping the breaker (board-specific failure)', async () => {
    fetchSpy.mockResolvedValue(new Response('nope', { status: 502 }))
    const viaHub = createHubFetcher({ enabled: true, baseUrl: 'https://hub.test' }, { breakerMs: 60_000 })
    expect(await viaHub<Board>('macro')).toBeNull()
    expect(await viaHub<Board>('macro')).toBeNull()
    // Reachable hub answering 502 = retried every call, no backoff.
    expect(fetchSpy).toHaveBeenCalledTimes(2)
  })

  it('transport failures trip a PER-BOARD breaker — siblings keep fetching', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      fetchSpy.mockRejectedValue(Object.assign(new TypeError('Unable to connect'), { code: 'FailedToOpenSocket' }))
      const viaHub = createHubFetcher({ enabled: true, baseUrl: 'https://hub.test' }, { breakerMs: 60_000 })
      expect(await viaHub<Board>('global-macro')).toBeNull()
      expect(warnSpy).toHaveBeenCalledWith(expect.stringMatching(/hub\.test.*global-macro.*FailedToOpenSocket/))
      // Same board: breaker open, no second fetch.
      expect(await viaHub<Board>('global-macro')).toBeNull()
      expect(fetchSpy).toHaveBeenCalledTimes(1)
      // Different board: NOT gated by the sibling's breaker.
      // (Fresh Response per call — a body is single-read.)
      fetchSpy.mockImplementation(() => Promise.resolve(new Response(JSON.stringify(board(3)))))
      expect((await viaHub<Board>('macro'))?.value).toBe(3)
      // Original board recovers after the window.
      vi.advanceTimersByTime(61_000)
      expect((await viaHub<Board>('global-macro'))?.value).toBe(3)
    } finally {
      warnSpy.mockRestore()
    }
  })

  it('rejects non-contract shapes (data boundary: shape-checked, never trusted)', async () => {
    fetchSpy.mockResolvedValue(new Response(JSON.stringify({ rows: [] })))
    const viaHub = createHubFetcher({ enabled: true, baseUrl: 'https://hub.test' })
    expect(await viaHub<Board>('macro')).toBeNull()
  })
})

describe('markLocal', () => {
  it('stamps origin=local without touching the rest of meta', () => {
    const stamped = markLocal(board(7))
    expect(stamped.meta).toMatchObject({ provider: 'fred', origin: 'local' })
    expect(stamped.value).toBe(7)
  })
})
