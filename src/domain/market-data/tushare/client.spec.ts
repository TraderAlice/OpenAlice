import { describe, expect, it, vi } from 'vitest'
import { TushareClient, validateTushareBaseUrl } from './client.js'

const ok = (fields: string[], items: unknown[][]) => new Response(JSON.stringify({
  code: 0,
  msg: null,
  data: { fields, items },
}), { status: 200, headers: { 'content-type': 'application/json' } })

describe('TushareClient', () => {
  it('posts the official envelope, parses field/item rows, and caches identical reads', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(ok(['cal_date', 'is_open'], [['20260901', 1]]))
    const client = new TushareClient({
      getConfig: () => ({ enabled: true, baseUrl: 'https://api.tushare.pro', token: 'secret-token' }),
      fetch,
      minIntervalMs: 0,
    })

    await expect(client.query('trade_cal', { exchange: 'SSE' })).resolves.toEqual([
      { cal_date: '20260901', is_open: 1 },
    ])
    await client.query('trade_cal', { exchange: 'SSE' })

    expect(fetch).toHaveBeenCalledTimes(1)
    const request = fetch.mock.calls[0]
    expect(request?.[0]).toBe('https://api.tushare.pro/')
    expect(JSON.parse(String(request?.[1]?.body))).toEqual({
      api_name: 'trade_cal',
      token: 'secret-token',
      params: { exchange: 'SSE' },
      fields: '',
    })
  })

  it('redacts the token from API errors', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response(JSON.stringify({
      code: -2001,
      msg: 'bad token secret-token',
      data: null,
    }), { status: 200 }))
    const client = new TushareClient({
      getConfig: () => ({ enabled: true, baseUrl: 'https://api.tushare.pro', token: 'secret-token' }),
      fetch,
      retries: 0,
    })
    await expect(client.query('stock_basic')).rejects.toThrow('bad token [redacted]')
  })

  it('hot-reads configuration before each cache lookup', async () => {
    let enabled = true
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(ok(['ts_code'], [['600519.SH']]))
    const client = new TushareClient({
      getConfig: () => ({ enabled, baseUrl: 'https://api.tushare.pro', token: 'token' }),
      fetch,
    })
    await client.query('stock_basic')
    enabled = false
    await expect(client.query('stock_basic')).rejects.toThrow('disabled')
  })

  it('retries transient upstream failures', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(new Response('', { status: 503 }))
      .mockResolvedValueOnce(ok(['ts_code'], [['600519.SH']]))
    const client = new TushareClient({
      getConfig: () => ({ enabled: true, baseUrl: 'https://api.tushare.pro', token: 'token' }),
      fetch,
      sleep: async () => {},
    })
    await expect(client.query('stock_basic')).resolves.toEqual([{ ts_code: '600519.SH' }])
    expect(fetch).toHaveBeenCalledTimes(2)
  })
})

describe('validateTushareBaseUrl', () => {
  it('accepts HTTPS and loopback HTTP only', () => {
    expect(validateTushareBaseUrl('https://example.com/tushare')).toBe('https://example.com/tushare')
    expect(validateTushareBaseUrl('http://127.0.0.1:8000/')).toBe('http://127.0.0.1:8000/')
    expect(() => validateTushareBaseUrl('http://example.com')).toThrow('HTTPS')
  })

  it('rejects query strings, fragments, and URL credentials', () => {
    expect(() => validateTushareBaseUrl('https://example.com/?token=x')).toThrow('query string')
    expect(() => validateTushareBaseUrl('https://example.com/#x')).toThrow('fragment')
    expect(() => validateTushareBaseUrl('https://user:pass@example.com/')).toThrow('credentials')
  })
})
