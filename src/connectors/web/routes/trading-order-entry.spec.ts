/**
 * Tests for the one-shot order entry routes:
 *   POST /api/trading/uta/:id/wallet/place-order
 *   POST /api/trading/uta/:id/wallet/close-position
 *   POST /api/trading/uta/:id/wallet/cancel-order
 *
 * These wrap stage → commit → push into a single HTTP roundtrip. We
 * test:
 *   - Happy path returns 200 + push result
 *   - Bad aliceId throws at stage → 400 phase=stage
 *   - Missing message → Zod 400
 *   - Numeric strings preserved through to UTA staging (no float
 *     roundtrip; Decimal precision intact)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createTradingRoutes } from './trading.js'
import type { EngineContext } from '../../../core/types.js'

// Stub the UTA + manager just enough that the handler can call through.
// We capture every call to verify what landed at the staging layer.

interface CapturedCall { method: string; args: unknown[] }

function makeMockUTA(opts: { stageThrows?: 'stage' | 'commit' | 'push' | null; pushResult?: unknown } = {}) {
  const calls: CapturedCall[] = []
  let pendingMessage: string | null = null
  return {
    calls,
    uta: {
      id: 'mock-uta',
      label: 'Mock UTA',
      stagePlaceOrder: vi.fn((p: unknown) => {
        calls.push({ method: 'stagePlaceOrder', args: [p] })
        if (opts.stageThrows === 'stage') throw new Error('Invalid aliceId')
      }),
      stageClosePosition: vi.fn((p: unknown) => {
        calls.push({ method: 'stageClosePosition', args: [p] })
        if (opts.stageThrows === 'stage') throw new Error('No such position')
      }),
      stageCancelOrder: vi.fn((p: unknown) => {
        calls.push({ method: 'stageCancelOrder', args: [p] })
        if (opts.stageThrows === 'stage') throw new Error('No such order')
      }),
      commit: vi.fn((msg: string) => {
        calls.push({ method: 'commit', args: [msg] })
        if (opts.stageThrows === 'commit') throw new Error('Guard rejected')
        pendingMessage = msg
      }),
      push: vi.fn(async () => {
        calls.push({ method: 'push', args: [] })
        if (opts.stageThrows === 'push') throw new Error('Broker offline')
        return opts.pushResult ?? {
          hash: 'abc123',
          message: pendingMessage,
          operationCount: 1,
          submitted: [{ action: 'placeOrder', success: true, orderId: 'ord-1', status: 'Submitted' }],
          rejected: [],
        }
      }),
      reject: vi.fn(async () => {
        calls.push({ method: 'reject', args: [] })
        return { hash: 'rej', message: 'rolled back', operationCount: 0 }
      }),
      status: vi.fn(() => ({ pendingMessage, staged: [], head: null, commitCount: 0 })),
    },
  }
}

function makeRoutes(uta: unknown) {
  // Minimal EngineContext — only `utaManager.get` is exercised.
  const ctx = {
    utaManager: {
      get: (id: string) => (id === 'mock-uta' ? uta : undefined),
      resolve: () => [],
      listUTAs: () => [],
      getAggregatedEquity: vi.fn(),
    },
    snapshotService: undefined,
  } as unknown as EngineContext
  return createTradingRoutes(ctx)
}

async function post(routes: ReturnType<typeof createTradingRoutes>, path: string, body: unknown) {
  const res = await routes.request(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const json = res.status === 204 ? null : await res.json().catch(() => null)
  return { status: res.status, body: json }
}

// ==================== place-order ====================

describe('POST /uta/:id/wallet/place-order', () => {
  let mock: ReturnType<typeof makeMockUTA>
  beforeEach(() => { mock = makeMockUTA() })

  it('happy path: stages + commits + pushes, returns push result', async () => {
    const routes = makeRoutes(mock.uta)
    const { status, body } = await post(routes, '/uta/mock-uta/wallet/place-order', {
      aliceId: 'mock-uta|BTC/USDT',
      action: 'BUY',
      orderType: 'MKT',
      totalQuantity: '0.001',
      message: 'manual test',
    })

    expect(status).toBe(200)
    expect((body as { hash: string }).hash).toBe('abc123')
    expect(mock.calls.map(c => c.method)).toEqual(['stagePlaceOrder', 'commit', 'push'])
  })

  it('rejects body without commit message (Zod 400)', async () => {
    const routes = makeRoutes(mock.uta)
    const { status, body } = await post(routes, '/uta/mock-uta/wallet/place-order', {
      aliceId: 'mock-uta|BTC/USDT',
      action: 'BUY',
      orderType: 'MKT',
      totalQuantity: '0.001',
      // message missing
    })

    expect(status).toBe(400)
    // No staging/commit/push happened
    expect(mock.calls).toHaveLength(0)
  })

  it('rejects body without quantity OR cashQty', async () => {
    const routes = makeRoutes(mock.uta)
    const { status } = await post(routes, '/uta/mock-uta/wallet/place-order', {
      aliceId: 'mock-uta|BTC/USDT',
      action: 'BUY',
      orderType: 'MKT',
      message: 'manual test',
    })

    expect(status).toBe(400)
    expect(mock.calls).toHaveLength(0)
  })

  it('returns phase=stage when staging throws', async () => {
    const failing = makeMockUTA({ stageThrows: 'stage' })
    const routes = makeRoutes(failing.uta)
    const { status, body } = await post(routes, '/uta/mock-uta/wallet/place-order', {
      aliceId: 'mock-uta|BTC/USDT',
      action: 'BUY',
      orderType: 'MKT',
      totalQuantity: '0.001',
      message: 'manual test',
    })

    expect(status).toBe(400)
    expect((body as { phase: string }).phase).toBe('stage')
    // commit + push should NOT have been called
    expect(failing.calls.map(c => c.method)).toEqual(['stagePlaceOrder'])
  })

  it('returns phase=commit when commit throws (and rolls back staging)', async () => {
    const failing = makeMockUTA({ stageThrows: 'commit' })
    const routes = makeRoutes(failing.uta)
    const { status, body } = await post(routes, '/uta/mock-uta/wallet/place-order', {
      aliceId: 'mock-uta|BTC/USDT',
      action: 'BUY',
      orderType: 'MKT',
      totalQuantity: '0.001',
      message: 'manual test',
    })

    expect(status).toBe(400)
    expect((body as { phase: string }).phase).toBe('commit')
    expect(failing.calls.map(c => c.method)).toContain('reject') // auto-rollback
    expect(failing.uta.push).not.toHaveBeenCalled()
  })

  it('returns phase=push when push throws', async () => {
    const failing = makeMockUTA({ stageThrows: 'push' })
    const routes = makeRoutes(failing.uta)
    const { status, body } = await post(routes, '/uta/mock-uta/wallet/place-order', {
      aliceId: 'mock-uta|BTC/USDT',
      action: 'BUY',
      orderType: 'MKT',
      totalQuantity: '0.001',
      message: 'manual test',
    })

    expect(status).toBe(500)
    expect((body as { phase: string }).phase).toBe('push')
  })

  it('returns 404 when UTA does not exist', async () => {
    const routes = makeRoutes(mock.uta)
    const { status } = await post(routes, '/uta/does-not-exist/wallet/place-order', {
      aliceId: 'x|y',
      action: 'BUY',
      orderType: 'MKT',
      totalQuantity: '0.001',
      message: 'manual test',
    })
    expect(status).toBe(404)
  })

  it('preserves quantity precision through to staging (string, not float)', async () => {
    // High-precision quantity that would lose bits as a float.
    const routes = makeRoutes(mock.uta)
    const tinyQty = '0.123456789012345'
    await post(routes, '/uta/mock-uta/wallet/place-order', {
      aliceId: 'mock-uta|BTC/USDT',
      action: 'BUY',
      orderType: 'MKT',
      totalQuantity: tinyQty,
      message: 'precision regression',
    })

    const stagedArg = mock.calls.find(c => c.method === 'stagePlaceOrder')!.args[0] as { totalQuantity: string }
    expect(stagedArg.totalQuantity).toBe(tinyQty)
    expect(typeof stagedArg.totalQuantity).toBe('string')
  })

  it('passes the user message into commit', async () => {
    const routes = makeRoutes(mock.uta)
    await post(routes, '/uta/mock-uta/wallet/place-order', {
      aliceId: 'mock-uta|BTC/USDT',
      action: 'BUY',
      orderType: 'MKT',
      totalQuantity: '1',
      message: 'this exact message',
    })

    expect(mock.uta.commit).toHaveBeenCalledWith('this exact message')
  })
})

// ==================== close-position ====================

describe('POST /uta/:id/wallet/close-position', () => {
  let mock: ReturnType<typeof makeMockUTA>
  beforeEach(() => { mock = makeMockUTA() })

  it('happy path with explicit qty', async () => {
    const routes = makeRoutes(mock.uta)
    const { status } = await post(routes, '/uta/mock-uta/wallet/close-position', {
      aliceId: 'mock-uta|BTC/USDT',
      qty: '0.001',
      message: 'closing test position',
    })

    expect(status).toBe(200)
    const stagedArg = mock.calls.find(c => c.method === 'stageClosePosition')!.args[0] as { qty: string }
    // qty stays a string — preserves precision
    expect(stagedArg.qty).toBe('0.001')
    expect(typeof stagedArg.qty).toBe('string')
  })

  it('happy path without qty (close full position)', async () => {
    const routes = makeRoutes(mock.uta)
    const { status } = await post(routes, '/uta/mock-uta/wallet/close-position', {
      aliceId: 'mock-uta|BTC/USDT',
      message: 'close all',
    })

    expect(status).toBe(200)
    const stagedArg = mock.calls.find(c => c.method === 'stageClosePosition')!.args[0] as { qty?: unknown }
    expect(stagedArg.qty).toBeUndefined()
  })

  it('rejects body without commit message', async () => {
    const routes = makeRoutes(mock.uta)
    const { status } = await post(routes, '/uta/mock-uta/wallet/close-position', {
      aliceId: 'mock-uta|BTC/USDT',
      qty: '0.001',
    })
    expect(status).toBe(400)
    expect(mock.calls).toHaveLength(0)
  })
})

// ==================== cancel-order ====================

describe('POST /uta/:id/wallet/cancel-order', () => {
  let mock: ReturnType<typeof makeMockUTA>
  beforeEach(() => { mock = makeMockUTA() })

  it('happy path', async () => {
    const routes = makeRoutes(mock.uta)
    const { status } = await post(routes, '/uta/mock-uta/wallet/cancel-order', {
      orderId: 'ord-42',
      message: 'cancelling stale order',
    })

    expect(status).toBe(200)
    const stagedArg = mock.calls.find(c => c.method === 'stageCancelOrder')!.args[0] as { orderId: string }
    expect(stagedArg.orderId).toBe('ord-42')
  })

  it('rejects empty orderId', async () => {
    const routes = makeRoutes(mock.uta)
    const { status } = await post(routes, '/uta/mock-uta/wallet/cancel-order', {
      orderId: '',
      message: 'foo',
    })
    expect(status).toBe(400)
  })

  it('rejects empty message', async () => {
    const routes = makeRoutes(mock.uta)
    const { status } = await post(routes, '/uta/mock-uta/wallet/cancel-order', {
      orderId: 'ord-42',
      message: '',
    })
    expect(status).toBe(400)
  })
})
