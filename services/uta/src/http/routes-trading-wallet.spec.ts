import { describe, expect, it, vi } from 'vitest'
import Decimal from 'decimal.js'
import { Contract, Order } from '@traderalice/ibkr'
import { createTradingRoutes } from './routes-trading.js'
import {
  PendingHashConflictError,
  TradingGit,
  WriteOutcomeUnconfirmedError,
} from '../domain/trading/git/TradingGit.js'
import type { TradingGitConfig } from '../domain/trading/git/interfaces.js'
import type { GitExportState, GitState, Operation } from '../domain/trading/git/types.js'
import type { UTAEngineContext } from '../types.js'
import '../domain/trading/contract-ext.js'

/** The durable commit log, standing in for the real data directory: the retry
 *  verdict's `logPersisted` is derived from it, so both truth values have to be
 *  reachable without touching disk. */
const durableLog = vi.hoisted(() => ({ state: undefined as GitExportState | undefined, readFails: false }))
vi.mock('../domain/trading/git-persistence.js', () => ({
  loadGitState: async () => {
    if (durableLog.readFails) throw new Error('EACCES: durable log unreadable')
    return durableLog.state
  },
  createGitPersister: () => async () => undefined,
}))

/** Post-execution account snapshot TradingGit records on every commit. */
function makeGitState(overrides: Partial<GitState> = {}): GitState {
  return {
    totalCashValue: '100000',
    netLiquidation: '105000',
    unrealizedPnL: '5000',
    realizedPnL: '1000',
    positions: [],
    pendingOrders: [],
    ...overrides,
  }
}

function buyOp(): Operation {
  const contract = new Contract()
  contract.aliceId = 'mock-paper|AAPL'
  contract.symbol = 'AAPL'
  contract.secType = 'STK'
  contract.exchange = 'NASDAQ'
  contract.currency = 'USD'
  const order = new Order()
  order.action = 'BUY'
  order.orderType = 'MKT'
  order.totalQuantity = new Decimal(10)
  return { action: 'placeOrder', contract, order }
}

/** A broker call that never answers — how a wallet write ends with no outcome. */
const neverSettles = () => new Promise<never>(() => {})

/** A REAL TradingGit behind the route. The retry has to survive the write-outcome
 *  machinery itself — the hash-vs-pending check that runs before any dispatch, the
 *  staging cleanup that follows an unconfirmed write, the unconfirmed commit in the
 *  log — so a hand-faked account would only test the fake. `onCommit` is what
 *  production wires to the persister. */
function makeRealAccount(options: { persist?: boolean; settles?: boolean } = {}) {
  const dispatch = vi.fn(options.settles
    ? async () => ({ success: true, orderId: 'order-1', execution: { price: 150, shares: 10 } })
    : neverSettles)
  const config: TradingGitConfig = {
    executeOperation: dispatch,
    getGitState: async () => makeGitState(),
    onCommit: async (state) => {
      if (options.persist === false) throw new Error('disk full')
      durableLog.state = state
    },
    writeTimeoutMs: 25,
  }
  return { git: new TradingGit(config), dispatch }
}

function pushBody(expectedPendingHash: string) {
  return {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ expectedPendingHash }),
  }
}


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

  it('reports an indeterminate write distinctly instead of a generic failure', async () => {
    const push = vi.fn(async () => {
      throw new WriteOutcomeUnconfirmedError(
        'Wallet write abc12345 did not confirm: 1 operation(s) did not settle within the 90000ms write bound — outcome indeterminate, reconcile against broker state',
        {
          hash: 'abc12345',
          unconfirmed: [
            { action: 'placeOrder' as const, success: false, status: 'unconfirmed' as const, error: 'no answer' },
          ],
          logPersisted: true,
        },
      )
    })
    const app = makeRoutes({
      status: () => ({ pendingMessage: 'long AAPL', pendingHash: 'abc12345', staged: [{}] }),
      push,
    })
    const res = await app.request('/uta/mock-uta/wallet/push', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ expectedPendingHash: 'abc12345' }),
    })

    // Not 500 (unhandled) and not 409 PENDING_HASH_CONFLICT (which would invite a
    // pointless retry): the caller is told the outcome is unknown, and given the
    // commit hash to reconcile against.
    expect(res.status).toBe(504)
    await expect(res.json()).resolves.toMatchObject({
      code: 'WRITE_OUTCOME_UNCONFIRMED',
      hash: 'abc12345',
      logPersisted: true,
      unconfirmed: [expect.objectContaining({ status: 'unconfirmed' })],
    })
  })
})

describe('wallet push retry after an indeterminate write', () => {
  it('re-learns the verdict instead of answering "Nothing to push"', async () => {
    const { git, dispatch } = makeRealAccount()
    const app = makeRoutes(git)

    git.add(buyOp())
    const { hash } = git.commit('Buy AAPL')
    const first = await app.request('/uta/mock-uta/wallet/push', pushBody(hash))

    // The write ended with the broker unanswered: the commit is in the log with
    // its operation marked unconfirmed, and the pending commit is gone by design.
    expect(first.status).toBe(504)
    await expect(first.json()).resolves.toMatchObject({ code: 'WRITE_OUTCOME_UNCONFIRMED', hash })

    // The retry carries the SAME hash. Answering it "Nothing to push" would tell
    // the owner the opposite of what the log says: the order MAY be live.
    const retry = await app.request('/uta/mock-uta/wallet/push', pushBody(hash))
    expect(retry.status).toBe(504)
    await expect(retry.json()).resolves.toMatchObject({
      code: 'WRITE_OUTCOME_UNCONFIRMED',
      hash,
      unconfirmed: [expect.objectContaining({ status: 'unconfirmed' })],
      logPersisted: true,
    })

    // One dispatch, ever — the retry may not resubmit an operation whose outcome
    // is already unknown.
    expect(dispatch).toHaveBeenCalledTimes(1)
  })

  it('repeats that the record is not durable when the persist never landed', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const { git, dispatch } = makeRealAccount({ persist: false })
      const app = makeRoutes(git)
      git.add(buyOp())
      const { hash } = git.commit('Buy AAPL')

      const first = await app.request('/uta/mock-uta/wallet/push', pushBody(hash))
      expect(first.status).toBe(504)
      await expect(first.json()).resolves.toMatchObject({ logPersisted: false })

      const retry = await app.request('/uta/mock-uta/wallet/push', pushBody(hash))
      expect(retry.status).toBe(504)
      await expect(retry.json()).resolves.toMatchObject({
        code: 'WRITE_OUTCOME_UNCONFIRMED',
        hash,
        logPersisted: false,
      })
      expect(dispatch).toHaveBeenCalledTimes(1)
    } finally {
      consoleError.mockRestore()
    }
  })

  it('keeps the verdict when the durable log cannot even be read', async () => {
    const { git } = makeRealAccount()
    const app = makeRoutes(git)
    git.add(buyOp())
    const { hash } = git.commit('Buy AAPL')
    await app.request('/uta/mock-uta/wallet/push', pushBody(hash))

    durableLog.readFails = true
    try {
      const retry = await app.request('/uta/mock-uta/wallet/push', pushBody(hash))
      // Not a 500: a durability probe that cannot run is no reason to lose the
      // reconcile notice the caller came back for. It just cannot claim durability.
      expect(retry.status).toBe(504)
      await expect(retry.json()).resolves.toMatchObject({
        code: 'WRITE_OUTCOME_UNCONFIRMED',
        hash,
        logPersisted: false,
      })
    } finally {
      durableLog.readFails = false
    }
  })

  it('keeps the bare "Nothing to push" for the genuinely empty wallet', async () => {
    const { git, dispatch } = makeRealAccount()
    const app = makeRoutes(git)
    const res = await app.request('/uta/mock-uta/wallet/push', { method: 'POST', body: '{}' })
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({ error: 'Nothing to push' })
    expect(dispatch).not.toHaveBeenCalled()
  })

  it('answers a hash the log does not hold as indeterminate with the conflict', async () => {
    const { git, dispatch } = makeRealAccount()
    const app = makeRoutes(git)

    const unknown = await app.request('/uta/mock-uta/wallet/push', pushBody('deadbeef'))
    expect(unknown.status).toBe(409)
    await expect(unknown.json()).resolves.toMatchObject({ code: 'PENDING_HASH_CONFLICT' })
    expect(dispatch).not.toHaveBeenCalled()
  })

  it('does not dress an already-confirmed commit up as an indeterminate write', async () => {
    const { git, dispatch } = makeRealAccount({ settles: true })
    const app = makeRoutes(git)
    git.add(buyOp())
    const { hash } = git.commit('Buy AAPL')
    const pushed = await app.request('/uta/mock-uta/wallet/push', pushBody(hash))
    expect(pushed.status).toBe(200)

    // Same hash, no pending commit — but this commit DID settle, so the retry is a
    // stale approval, not an unknown outcome.
    const retry = await app.request('/uta/mock-uta/wallet/push', pushBody(hash))
    expect(retry.status).toBe(409)
    await expect(retry.json()).resolves.toMatchObject({ code: 'PENDING_HASH_CONFLICT' })
    expect(dispatch).toHaveBeenCalledTimes(1)
  })
})
