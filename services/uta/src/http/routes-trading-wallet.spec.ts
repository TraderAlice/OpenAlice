import { describe, expect, it, vi } from 'vitest'
import { createTradingRoutes } from './routes-trading.js'
import { PendingHashConflictError } from '../domain/trading/git/TradingGit.js'
import type { UTAEngineContext } from '../types.js'

function makeRoutes(uta: unknown) {
  const ctx = {
    utaManager: {
      get: (id: string) => (id === 'mock-uta' ? uta : undefined),
    },
    snapshotService: undefined,
  } as unknown as UTAEngineContext
  return createTradingRoutes(ctx)
}

describe('wallet push/reject expected hash', () => {
  it('refuses push without expectedPendingHash and does not mutate', async () => {
    const push = vi.fn()
    const app = makeRoutes({
      status: () => ({ pendingMessage: 'long AAPL', pendingHash: 'abc12345', staged: [{}] }),
      push,
    })
    const res = await app.request('/uta/mock-uta/wallet/push', { method: 'POST', body: '{}' })
    expect(res.status).toBe(409)
    await expect(res.json()).resolves.toMatchObject({ code: 'PENDING_HASH_REQUIRED' })
    expect(push).not.toHaveBeenCalled()
  })

  it('refuses reject without expectedPendingHash and does not mutate', async () => {
    const reject = vi.fn()
    const app = makeRoutes({
      status: () => ({ pendingMessage: 'long AAPL', pendingHash: 'abc12345', staged: [{}] }),
      reject,
    })
    const res = await app.request('/uta/mock-uta/wallet/reject', { method: 'POST', body: '{}' })
    expect(res.status).toBe(409)
    await expect(res.json()).resolves.toMatchObject({ code: 'PENDING_HASH_REQUIRED' })
    expect(reject).not.toHaveBeenCalled()
  })

  it('returns conflict and does not treat a hash change as success', async () => {
    const push = vi.fn(async () => {
      throw new PendingHashConflictError('Pending commit changed')
    })
    const app = makeRoutes({
      status: () => ({ pendingMessage: 'long AAPL', pendingHash: 'freshhash', staged: [{}] }),
      push,
    })
    const res = await app.request('/uta/mock-uta/wallet/push', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ expectedPendingHash: 'stalehash' }),
    })
    expect(res.status).toBe(409)
    await expect(res.json()).resolves.toMatchObject({ code: 'PENDING_HASH_CONFLICT' })
    expect(push).toHaveBeenCalledWith('stalehash')
  })

  it('pushes when the expected hash is supplied', async () => {
    const push = vi.fn(async () => ({
      hash: 'abc12345',
      message: 'long AAPL',
      operationCount: 1,
      submitted: [],
      rejected: [],
    }))
    const app = makeRoutes({
      status: () => ({ pendingMessage: 'long AAPL', pendingHash: 'abc12345', staged: [{}] }),
      push,
    })
    const res = await app.request('/uta/mock-uta/wallet/push', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ expectedPendingHash: 'abc12345' }),
    })
    expect(res.status).toBe(200)
    expect(push).toHaveBeenCalledWith('abc12345')
  })
})
