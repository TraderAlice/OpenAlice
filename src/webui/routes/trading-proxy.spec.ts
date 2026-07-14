import { describe, expect, it, vi, afterEach } from 'vitest'
import { createTradingProxyRoutes } from './trading-proxy.js'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('createTradingProxyRoutes — UTA optional carrier', () => {
  it('reports lite-mode status when the carrier is intentionally disabled', async () => {
    const app = createTradingProxyRoutes({ disabledReason: 'lite_mode' })
    const res = await app.request('/status')
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({
      available: false,
      state: 'unavailable',
      reason: 'lite_mode',
    })
  })

  it('returns 503 for trading calls when lite mode disables the carrier', async () => {
    const app = createTradingProxyRoutes({ disabledReason: 'lite_mode' })
    const res = await app.request('/uta')
    expect(res.status).toBe(503)
    await expect(res.json()).resolves.toMatchObject({
      error: 'UTA disabled',
      detail: 'Trading mode is lite',
    })
  })

  it('reports the effective mode in status', async () => {
    const app = createTradingProxyRoutes({ disabledReason: 'lite_mode' })
    const res = await app.request('/status')
    await expect(res.json()).resolves.toMatchObject({
      mode: 'lite',
      modeSource: 'env',
      envLocked: true,
    })
  })

  it('blocks venue-mutating writes in readonly mode', async () => {
    const app = createTradingProxyRoutes({
      utaBaseUrl: 'http://127.0.0.1:47333',
      getPolicy: () => ({ mode: 'readonly', source: 'config', envLocked: false, hasUTAConfig: true }),
    })
    const res = await app.request('/api/trading/uta/alpaca/wallet/push', { method: 'POST' })
    expect(res.status).toBe(403)
    await expect(res.json()).resolves.toMatchObject({
      error: 'Trading mode is readonly',
    })
  })

  it('allows local proposal writes in readonly mode', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ))
    const app = createTradingProxyRoutes({
      utaBaseUrl: 'http://127.0.0.1:47333',
      getPolicy: () => ({ mode: 'readonly', source: 'config', envLocked: false, hasUTAConfig: true }),
    })
    const res = await app.request('/api/trading/uta/alpaca/wallet/stage-place-order', { method: 'POST', body: '{}' })
    expect(res.status).toBe(200)
  })

  it('reports unavailable status when no carrier URL is configured', async () => {
    const app = createTradingProxyRoutes({})
    const res = await app.request('/status')
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({
      available: false,
      state: 'unavailable',
      reason: 'not_configured',
    })
  })

  it('returns 503 for trading calls when no carrier URL is configured', async () => {
    const app = createTradingProxyRoutes({})
    const res = await app.request('/uta')
    expect(res.status).toBe(503)
    await expect(res.json()).resolves.toMatchObject({
      error: 'UTA unavailable',
    })
  })

  it('reports available status from UTA health', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(JSON.stringify({ ok: true, startedAt: '2026-07-05T00:00:00.000Z', utas: 2 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ))
    const app = createTradingProxyRoutes({ utaBaseUrl: 'http://127.0.0.1:47333' })
    const res = await app.request('/status')
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({
      available: true,
      state: 'available',
      startedAt: '2026-07-05T00:00:00.000Z',
      utas: 2,
    })
  })

  it.each([
    [503, 'http_error'],
    [404, 'http_error'],
  ] as const)('classifies UTA HTTP %s health failures as %s', async (status, reason) => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status })))
    const app = createTradingProxyRoutes({ utaBaseUrl: 'http://127.0.0.1:47333' })
    const res = await app.request('/status')
    await expect(res.json()).resolves.toMatchObject({ available: false, reason })
  })

  it('rejects malformed UTA health JSON instead of reporting a false healthy state', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 })))
    const app = createTradingProxyRoutes({ utaBaseUrl: 'http://127.0.0.1:47333' })
    const res = await app.request('/status')
    await expect(res.json()).resolves.toMatchObject({ available: false, reason: 'invalid_response' })
  })

  it('classifies connection errors without leaking them as availability', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNREFUSED') }))
    const app = createTradingProxyRoutes({ utaBaseUrl: 'http://127.0.0.1:47333' })
    const res = await app.request('/status')
    await expect(res.json()).resolves.toMatchObject({
      available: false,
      reason: 'unreachable',
      detail: 'ECONNREFUSED',
    })
  })
})
