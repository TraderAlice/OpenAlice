import { describe, expect, it, vi } from 'vitest'
import { probeOptionalCarrier, waitForOptionalCarrier } from './health.js'

const decode = (value: unknown) => {
  if (!value || typeof value !== 'object' || (value as { ok?: unknown }).ok !== true) {
    throw new Error('health body must contain ok=true')
  }
  return value as { ok: true; startedAt?: string }
}

describe('optional carrier health contract', () => {
  it('treats disabled as intentional and performs no network request', async () => {
    const fetchImpl = vi.fn()
    const result = await probeOptionalCarrier({
      id: 'uta', enabled: false, healthPath: '/__uta/health', decode, fetchImpl,
    })
    expect(result.phase).toBe('disabled')
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('distinguishes missing configuration from a disabled carrier', async () => {
    const result = await probeOptionalCarrier({ id: 'connector', enabled: true, healthPath: '/health', decode })
    expect(result).toMatchObject({ phase: 'degraded', reason: 'not_configured' })
  })

  it('returns a decoded healthy body and latency', async () => {
    const ticks = [1_000, 1_012]
    const result = await probeOptionalCarrier({
      id: 'uta', enabled: true, baseUrl: 'http://127.0.0.1:1/', healthPath: '/__uta/health', decode,
      now: () => ticks.shift() ?? 1_012,
      fetchImpl: vi.fn(async () => new Response(JSON.stringify({ ok: true, startedAt: 'now' }), { status: 200 })),
    })
    expect(result).toMatchObject({ phase: 'healthy', latencyMs: 12, body: { ok: true, startedAt: 'now' } })
  })

  it.each([
    [503, 'http_error'],
    [404, 'http_error'],
  ] as const)('maps HTTP %s to %s', async (status, reason) => {
    const result = await probeOptionalCarrier({
      id: 'connector', enabled: true, baseUrl: 'http://local', healthPath: '/health', decode,
      fetchImpl: vi.fn(async () => new Response('{}', { status })),
    })
    expect(result).toMatchObject({ phase: 'degraded', reason })
  })

  it('rejects a 200 response with an invalid health body', async () => {
    const result = await probeOptionalCarrier({
      id: 'uta', enabled: true, baseUrl: 'http://local', healthPath: '/health', decode,
      fetchImpl: vi.fn(async () => new Response('{}', { status: 200 })),
    })
    expect(result).toMatchObject({ phase: 'degraded', reason: 'invalid_response' })
  })

  it('separates timeout from an unreachable carrier', async () => {
    const timeout = new Error('aborted'); timeout.name = 'TimeoutError'
    const timedOut = await probeOptionalCarrier({
      id: 'uta', enabled: true, baseUrl: 'http://local', healthPath: '/health', decode,
      fetchImpl: vi.fn(async () => { throw timeout }),
    })
    const unreachable = await probeOptionalCarrier({
      id: 'connector', enabled: true, baseUrl: 'http://local', healthPath: '/health', decode,
      fetchImpl: vi.fn(async () => { throw new Error('ECONNREFUSED') }),
    })
    expect(timedOut.reason).toBe('timeout')
    expect(unreachable).toMatchObject({ reason: 'unreachable', detail: 'ECONNREFUSED' })
  })

  it('waits through startup failures and returns the first healthy probe', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response('{}', { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }))
    let now = 0
    const result = await waitForOptionalCarrier({
      id: 'connector', enabled: true, baseUrl: 'http://local', healthPath: '/health', decode, fetchImpl,
      now: () => now,
      sleep: async (ms) => { now += ms },
      intervalMs: 10,
      waitTimeoutMs: 100,
    })
    expect(result.phase).toBe('healthy')
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('stops polling at the wait budget and returns degraded evidence', async () => {
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 503 }))
    let now = 0
    const result = await waitForOptionalCarrier({
      id: 'uta', enabled: true, baseUrl: 'http://local', healthPath: '/health', decode, fetchImpl,
      now: () => now,
      sleep: async (ms) => { now += ms },
      intervalMs: 10,
      waitTimeoutMs: 25,
    })
    expect(result).toMatchObject({ phase: 'degraded', reason: 'http_error' })
    expect(fetchImpl).toHaveBeenCalledTimes(4)
    expect(now).toBe(25)
  })
})
