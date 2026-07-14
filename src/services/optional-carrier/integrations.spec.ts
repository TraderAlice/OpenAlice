import { describe, expect, it, vi } from 'vitest'
import { decodeConnectorServiceHealth } from '../connector-client/index.js'
import { decodeUTAHealth } from '../uta-supervisor/health.js'
import { probeOptionalCarrier } from './health.js'

describe.each([
  {
    id: 'uta',
    path: '/__uta/health',
    body: { ok: true, startedAt: '2026-07-13T00:00:00.000Z', utas: 1 },
    decode: decodeUTAHealth,
  },
  {
    id: 'connector',
    path: '/__connector/health',
    body: { status: 'healthy', startedAt: '2026-07-13T00:00:00.000Z', adapters: [] },
    decode: decodeConnectorServiceHealth,
  },
] as const)('$id health endpoint contract', ({ id, path, body, decode }) => {
  it('accepts the real service health shape', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(body), { status: 200 }))
    const result = await probeOptionalCarrier({
      id,
      enabled: true,
      baseUrl: 'http://127.0.0.1:1',
      healthPath: path,
      fetchImpl,
      decode: decode as (value: unknown) => unknown,
    })
    expect(result.phase).toBe('healthy')
    expect(fetchImpl).toHaveBeenCalledWith(`http://127.0.0.1:1${path}`, expect.objectContaining({ signal: expect.any(AbortSignal) }))
  })

  it('rejects a successful response using the other service shape', async () => {
    const wrongBody = id === 'uta'
      ? { status: 'healthy', startedAt: '2026-07-13T00:00:00.000Z', adapters: [] }
      : { ok: true, startedAt: '2026-07-13T00:00:00.000Z', utas: 1 }
    const result = await probeOptionalCarrier({
      id,
      enabled: true,
      baseUrl: 'http://127.0.0.1:1',
      healthPath: path,
      fetchImpl: vi.fn(async () => new Response(JSON.stringify(wrongBody), { status: 200 })),
      decode: decode as (value: unknown) => unknown,
    })
    expect(result).toMatchObject({ phase: 'degraded', reason: 'invalid_response' })
  })
})
