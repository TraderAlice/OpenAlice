import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { fxmdGet, fxmdGetAllPages, resolveCurrency, resolveCurrencies } from './helpers.js'
import { OpenBBError, UnauthorizedError } from '../../../core/provider/utils/errors.js'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

describe('resolveCurrency', () => {
  it('accepts currency codes and OpenBB-style country names', () => {
    expect(resolveCurrency('eur')).toBe('EUR')
    expect(resolveCurrency('united_states')).toBe('USD')
    expect(resolveCurrency('New Zealand')).toBe('NZD')
    expect(resolveCurrency('euro_area')).toBe('EUR')
    expect(resolveCurrency('china')).toBe('CNY')
    expect(resolveCurrency('CNH')).toBe('CNH')
  })

  it('defaults to USD and rejects uncovered economies', () => {
    expect(resolveCurrency(null)).toBe('USD')
    expect(resolveCurrencies('japan, JPY,gbp')).toEqual(['JPY', 'GBP'])
    expect(() => resolveCurrency('argentina')).toThrow(OpenBBError)
  })
})

describe('fxmdGet', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => { vi.unstubAllGlobals() })

  it('sends the key as X-API-Key and never in the URL', async () => {
    fetchMock.mockResolvedValueOnce(json({ ok: true }))
    await fxmdGet('/calendar/usd', { start_date: '2026-01-01', end_date: null }, 'secret')
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.fxmacrodata.com/v1/calendar/usd?start_date=2026-01-01')
    expect(url).not.toContain('secret')
    expect(init.headers['X-API-Key']).toBe('secret')
  })

  it('omits the header when no key is configured', async () => {
    fetchMock.mockResolvedValueOnce(json({ ok: true }))
    await fxmdGet('/data_catalogue/usd', {}, '')
    expect(fetchMock.mock.calls[0][1].headers).not.toHaveProperty('X-API-Key')
  })

  it('turns 401 into UnauthorizedError with the API explanation', async () => {
    fetchMock.mockResolvedValueOnce(json({ detail: 'This endpoint requires an API key.', code: 'api_key_required' }, 401))
    const err = await fxmdGet('/forex/eur/usd', {}, '').catch((e: unknown) => e) as Error
    expect(err).toBeInstanceOf(UnauthorizedError)
    expect(err.message).toContain('requires an API key')
    expect(err.message).toContain('Settings')
  })

  it('follows offset pagination until has_more is false', async () => {
    fetchMock
      .mockResolvedValueOnce(json({ name: 'first', data: [{ val: 1 }], pagination: { has_more: true } }))
      .mockResolvedValueOnce(json({ name: 'second', data: [{ val: 2 }], pagination: { has_more: false } }))
    const { first, rows } = await fxmdGetAllPages<{ name: string; data?: Record<string, unknown>[] }>('/announcements/usd/inflation', {}, '')
    expect(rows).toEqual([{ val: 1 }, { val: 2 }])
    expect(first?.name).toBe('first')
    expect(fetchMock.mock.calls[0][0]).toContain('limit=100&offset=0')
    expect(fetchMock.mock.calls[1][0]).toContain('limit=100&offset=100')
  })
})
