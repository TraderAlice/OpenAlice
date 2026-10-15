import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { withHubCalendars } from './hub-data.js'
import type { EquityClientLike } from './client/types.js'

const HUB = { enabled: true, baseUrl: 'https://hub.test' }

function fakeClient(rows: unknown[]): EquityClientLike {
  return {
    getCalendarEarnings: vi.fn(async () => rows),
    getCalendarIpo: vi.fn(async () => rows),
    getCalendarDividend: vi.fn(async () => rows),
    getGainers: vi.fn(async () => [{ symbol: 'LOCAL' }]),
  } as unknown as EquityClientLike
}

describe('withHubCalendars', () => {
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

  const params = { provider: 'fmp', start_date: '2026-06-11', end_date: '2026-06-25' }

  it('serves calendar rows from the hub dataset endpoint', async () => {
    fetchSpy.mockResolvedValue(new Response(JSON.stringify([{ symbol: 'HUB' }])))
    const local = fakeClient([{ symbol: 'LOCAL' }])
    const wrapped = withHubCalendars(local, HUB)
    const rows = await wrapped.getCalendarEarnings(params)
    expect(rows).toEqual([{ symbol: 'HUB' }])
    expect(fetchSpy.mock.calls[0][0]).toBe('https://hub.test/api/data/earnings-calendar?from=2026-06-11&to=2026-06-25')
    expect(local.getCalendarEarnings).not.toHaveBeenCalled()
  })

  it('bypasses the hub for params it does not understand', async () => {
    const local = fakeClient([{ symbol: 'LOCAL' }])
    const wrapped = withHubCalendars(local, HUB)
    const rows = await wrapped.getCalendarDividend({ ...params, symbol: 'AAPL' })
    expect(rows).toEqual([{ symbol: 'LOCAL' }])
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('falls back to local on hub failure and opens the breaker', async () => {
    fetchSpy.mockResolvedValue(new Response('down', { status: 502 }))
    const local = fakeClient([{ symbol: 'LOCAL' }])
    const wrapped = withHubCalendars(local, HUB)
    expect(await wrapped.getCalendarIpo(params)).toEqual([{ symbol: 'LOCAL' }])
    expect(await wrapped.getCalendarIpo(params)).toEqual([{ symbol: 'LOCAL' }])
    expect(fetchSpy).toHaveBeenCalledTimes(1) // breaker open on the second call
  })

  it('leaves non-calendar methods untouched (bound to the real client)', async () => {
    const local = fakeClient([])
    const wrapped = withHubCalendars(local, HUB)
    expect(await wrapped.getGainers()).toEqual([{ symbol: 'LOCAL' }])
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('is a no-op when the hub is disabled', () => {
    const local = fakeClient([])
    expect(withHubCalendars(local, { enabled: false, baseUrl: 'x' })).toBe(local)
    expect(withHubCalendars(local, undefined)).toBe(local)
  })
})
