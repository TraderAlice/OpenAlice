/**
 * `POST /uta/:id/historical` wire shape. Dropping `session`/`forced` on the way
 * out would leave the client unable to tell a regular series from a continuous
 * one.
 */

import { describe, expect, it, vi } from 'vitest'
import { createTradingRoutes } from './routes-trading.js'
import type { UTAEngineContext } from '../types.js'

function makeRoutes(uta: unknown) {
  const ctx = {
    utaManager: { get: (id: string) => (id === 'mock-uta' ? uta : undefined) },
    snapshotService: undefined,
  } as unknown as UTAEngineContext
  return createTradingRoutes(ctx)
}

const BARS = [{ timestamp: new Date('2026-09-03T00:00:00.000Z'), open: '1', high: '2', low: '0.5', close: '1.5', volume: '10' }]

async function post(app: ReturnType<typeof createTradingRoutes>, body: unknown) {
  return app.request('/uta/mock-uta/historical', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('POST /uta/:id/historical', () => {
  it('returns bars alongside the effective session and forced flag', async () => {
    const getHistorical = vi.fn(async (_contract: unknown, _params: Record<string, unknown>) => ({ bars: BARS, session: 'regular', forced: false }))
    const res = await post(makeRoutes({ getHistorical }), { contract: { aliceId: 'mock-uta|AAPL' }, params: { interval: '1d', limit: 1 } })
    expect(res.status).toBe(200)
    const body = await res.json() as { bars: unknown[]; session: string; forced: boolean }
    expect(body.bars).toHaveLength(1)
    expect(body.session).toBe('regular')
    expect(body.forced).toBe(false)
  })

  it('surfaces a forced session rather than echoing the request', async () => {
    const getHistorical = vi.fn(async (_contract: unknown, _params: Record<string, unknown>) => ({ bars: [], session: 'extended', forced: true }))
    const res = await post(makeRoutes({ getHistorical }), { contract: { aliceId: 'mock-uta|EURUSD' }, params: { interval: '1h', session: 'regular' } })
    await expect(res.json()).resolves.toMatchObject({ session: 'extended', forced: true })
    expect(getHistorical.mock.calls[0]![1]).toMatchObject({ session: 'regular' })
  })

  it('revives start/end to Date and forwards the requested session', async () => {
    const getHistorical = vi.fn(async (_contract: unknown, _params: Record<string, unknown>) => ({ bars: [], session: 'extended', forced: false }))
    await post(makeRoutes({ getHistorical }), {
      contract: { aliceId: 'mock-uta|AAPL' },
      params: { interval: '1h', start: '2026-09-01T00:00:00.000Z', end: '2026-09-03T00:00:00.000Z', session: 'extended' },
    })
    const params = getHistorical.mock.calls[0]![1] as unknown as { start: Date; end: Date; session: string }
    expect(params.start).toBeInstanceOf(Date)
    expect(params.end).toBeInstanceOf(Date)
    expect(params.session).toBe('extended')
  })

  it('404s for an unknown account', async () => {
    const res = await makeRoutes({}).request('/uta/nope/historical', { method: 'POST', body: '{}' })
    expect(res.status).toBe(404)
  })
})
