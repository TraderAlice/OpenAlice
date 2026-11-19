import { describe, expect, it, vi } from 'vitest'
import { createUTAClient, UTAHttpError } from './UTAClient.js'

describe('createUTAClient — transport error attribution', () => {
  it('wraps Bun connection failures with method, safe URL, and underlying code/message', async () => {
    const bunErr = Object.assign(
      new Error('Unable to connect. Is the computer able to access the url?'),
      { code: 'ConnectionRefused' },
    )
    const fetchMock = vi.fn(async () => { throw bunErr })
    const client = createUTAClient({
      baseUrl: 'http://127.0.0.1:47333',
      fetch: fetchMock as unknown as typeof globalThis.fetch,
    })

    const err = await client.get('/api/accounts').catch((e) => e)
    expect(err).toBeInstanceOf(Error)
    expect(err.message).toContain('UTA GET http://127.0.0.1:47333/api/accounts failed:')
    expect(err.message).toContain('ConnectionRefused')
    expect(err.message).toContain('Unable to connect')
    expect(err.cause).toBe(bunErr)
  })

  it('strips URL credentials and query secrets from transport errors', async () => {
    const fetchMock = vi.fn(async () => {
      throw Object.assign(new Error('Failed to open socket'), { code: 'FailedToOpenSocket' })
    })
    const client = createUTAClient({
      baseUrl: 'http://alice:supersecret@127.0.0.1:47333',
      fetch: fetchMock as unknown as typeof globalThis.fetch,
    })

    const err = await client.get('/api/orders', { token: 'top-secret-token', symbol: 'AAPL' }).catch((e) => e)
    expect(err).toBeInstanceOf(Error)
    expect(err.message).toContain('UTA GET http://127.0.0.1:47333/api/orders failed:')
    expect(err.message).toContain('FailedToOpenSocket')
    expect(err.message).not.toContain('supersecret')
    expect(err.message).not.toContain('top-secret-token')
  })

  it('reports explicit timeout wording on AbortError', async () => {
    const abortErr = new DOMException('The operation was aborted', 'AbortError')
    const fetchMock = vi.fn(async () => { throw abortErr })
    const client = createUTAClient({
      baseUrl: 'http://127.0.0.1:47333',
      timeoutMs: 2500,
      fetch: fetchMock as unknown as typeof globalThis.fetch,
    })

    const err = await client.post('/api/orders', { symbol: 'AAPL' }).catch((e) => e)
    expect(err).toBeInstanceOf(Error)
    expect(err.message).toBe('UTA POST http://127.0.0.1:47333/api/orders timed out after 2500ms')
    expect(err.cause).toBe(abortErr)
  })

  it('preserves UTAHttpError for non-2xx HTTP responses', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ error: 'Account disabled' }), { status: 403 }),
    )
    const client = createUTAClient({
      baseUrl: 'http://127.0.0.1:47333',
      fetch: fetchMock as unknown as typeof globalThis.fetch,
    })

    await expect(client.get('/api/accounts')).rejects.toThrowError(UTAHttpError)
  })
})
