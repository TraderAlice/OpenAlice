import { describe, expect, it, vi } from 'vitest'
import { createNetworkCheckTools, runNetworkChecks } from './network-check.js'

describe('runNetworkChecks', () => {
  it('probes UTA, Yahoo Finance, and TraderHub concurrently and returns ok when all succeed', async () => {
    let tick = 100
    const now = () => (tick += 15)
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      if (url.includes('127.0.0.1:47333/__uta/health')) {
        return new Response(JSON.stringify({ ok: true }), { status: 200 })
      }
      if (url.includes('finance.yahoo.com')) {
        return new Response('User-agent: *', { status: 200 })
      }
      if (url.includes('traderhub.openalice.ai')) {
        return new Response(JSON.stringify({ meta: {} }), { status: 200 })
      }
      return new Response('not found', { status: 404 })
    })

    const result = await runNetworkChecks({
      utaUrl: 'http://127.0.0.1:47333',
      utaDisabled: false,
      hub: { enabled: true, baseUrl: 'https://traderhub.openalice.ai' },
      fetchImpl: fetchMock as unknown as typeof globalThis.fetch,
      now,
    })

    expect(result.ok).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(result.checks).toEqual([
      expect.objectContaining({ service: 'uta', host: '127.0.0.1:47333', ok: true, state: 'ok', optional: true, status: 200 }),
      expect.objectContaining({ service: 'yfinance', host: 'finance.yahoo.com', ok: true, state: 'ok', status: 200 }),
      expect.objectContaining({ service: 'traderhub', host: 'traderhub.openalice.ai', ok: true, state: 'ok', status: 200 }),
    ])
    for (const check of result.checks) {
      expect(check.latencyMs).toBeGreaterThanOrEqual(0)
    }
  })

  it('reports UTA as unconfigured in lite mode without crashing or failing overall ok', async () => {
    const fetchMock = vi.fn(async () => new Response('ok', { status: 200 }))

    const result = await runNetworkChecks({
      utaUrl: 'http://127.0.0.1:47333',
      utaDisabled: true,
      hub: { enabled: true, baseUrl: 'https://traderhub.openalice.ai' },
      fetchImpl: fetchMock as unknown as typeof globalThis.fetch,
    })

    expect(result.ok).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(result.checks[0]).toMatchObject({
      service: 'uta',
      host: '127.0.0.1:47333',
      ok: false,
      state: 'unconfigured',
      optional: true,
      latencyMs: 0,
    })
    expect(result.checks[0].error).toMatch(/unconfigured/i)
  })

  it('reports UTA unreachable with host and Bun error code without throwing', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      if (url.includes('127.0.0.1:47333')) {
        throw Object.assign(new Error('Unable to connect'), { code: 'ConnectionRefused' })
      }
      return new Response('ok', { status: 200 })
    })

    const result = await runNetworkChecks({
      utaUrl: 'http://127.0.0.1:47333',
      utaDisabled: false,
      hub: { enabled: true, baseUrl: 'https://traderhub.openalice.ai' },
      fetchImpl: fetchMock as unknown as typeof globalThis.fetch,
    })

    expect(result.ok).toBe(false)
    expect(result.checks[0]).toMatchObject({
      service: 'uta',
      host: '127.0.0.1:47333',
      ok: false,
      state: 'unreachable',
      optional: true,
    })
    expect(result.checks[0].error).toContain('127.0.0.1:47333')
    expect(result.checks[0].error).toContain('ConnectionRefused')
  })

  it('classifies timeouts and HTTP failures with target host attribution', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      if (url.includes('finance.yahoo.com')) {
        throw new DOMException('The operation was aborted', 'AbortError')
      }
      if (url.includes('traderhub.openalice.ai')) {
        return new Response('bad gateway', { status: 502 })
      }
      return new Response('ok', { status: 200 })
    })

    const result = await runNetworkChecks({
      utaUrl: null,
      utaDisabled: false,
      hub: { enabled: true, baseUrl: 'https://traderhub.openalice.ai' },
      timeoutMs: 1200,
      fetchImpl: fetchMock as unknown as typeof globalThis.fetch,
    })

    expect(result.ok).toBe(false)
    expect(result.checks[0]).toMatchObject({ service: 'uta', host: 'unconfigured', state: 'unconfigured', ok: false })
    expect(result.checks[1]).toMatchObject({ service: 'yfinance', host: 'finance.yahoo.com', state: 'timeout', ok: false })
    expect(result.checks[1].error).toContain('timed out after 1200ms')
    expect(result.checks[1].error).toContain('finance.yahoo.com')
    expect(result.checks[2]).toMatchObject({ service: 'traderhub', host: 'traderhub.openalice.ai', state: 'http_error', status: 502, ok: false })
    expect(result.checks[2].error).toContain('traderhub.openalice.ai')
    expect(result.checks[2].error).toContain('502')
  })

  it('exposes the network_check tool wrapper', async () => {
    const fetchMock = vi.fn(async () => new Response('ok', { status: 200 }))
    const { network_check } = createNetworkCheckTools({
      utaUrl: 'http://127.0.0.1:47333',
      utaDisabled: false,
      hub: { enabled: true, baseUrl: 'https://traderhub.openalice.ai' },
      fetchImpl: fetchMock as unknown as typeof globalThis.fetch,
    })
    const res = await network_check.execute!({}, { toolCallId: 't1', messages: [] }) as { ok: boolean; checks: unknown[] }
    expect(res.ok).toBe(true)
    expect(res.checks).toHaveLength(3)
  })
})
