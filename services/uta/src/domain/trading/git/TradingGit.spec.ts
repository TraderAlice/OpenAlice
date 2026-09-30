import { describe, it, expect, vi, beforeEach } from 'vitest'
import Decimal from 'decimal.js'
import { Contract, Order, OrderState } from '@traderalice/ibkr'
import { PendingHashConflictError, TradingGit, WriteOutcomeUnconfirmedError } from './TradingGit.js'
import type { TradingGitConfig } from './interfaces.js'
import { classifyOperationFailure } from '../brokers/operation-failure-classification.js'
import type { Operation, GitState, GitExportState } from './types.js'
import '../contract-ext.js'

// ==================== Helpers ====================

function makeContract(overrides: { aliceId?: string; symbol?: string } = {}): Contract {
  const c = new Contract()
  c.aliceId = overrides.aliceId ?? 'mock-paper|AAPL'
  c.symbol = overrides.symbol ?? 'AAPL'
  c.secType = 'STK'
  c.exchange = 'NASDAQ'
  c.currency = 'USD'
  return c
}

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

function makeConfig(overrides: Partial<TradingGitConfig> = {}): TradingGitConfig {
  return {
    executeOperation: overrides.executeOperation ?? vi.fn().mockResolvedValue({
      success: true,
      orderId: 'order-1',
      execution: { price: 150, shares: 10 },
    }),
    getGitState: overrides.getGitState ?? vi.fn().mockResolvedValue(makeGitState()),
    onCommit: overrides.onCommit,
    // Forward anything else the caller set (e.g. writeTimeoutMs): the enumerated
    // form silently dropped overrides for the newer config fields.
    ...overrides,
  }
}

function buyOp(symbol = 'AAPL'): Operation {
  const contract = makeContract({ symbol })
  const order = new Order()
  order.action = 'BUY'
  order.orderType = 'MKT'
  order.totalQuantity = new Decimal(10)
  return { action: 'placeOrder', contract, order }
}

function sellOp(symbol = 'AAPL'): Operation {
  const contract = makeContract({ symbol })
  return { action: 'closePosition', contract }
}

/** Fail fast when the promise under test never settles: a wedged `push()` must
 *  surface as an assertion failure, not as a hung spec. */
async function withWatchdog<T>(promise: Promise<T>, ms = 1500): Promise<T | 'still-pending'> {
  let timer: NodeJS.Timeout | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<'still-pending'>((resolve) => {
        timer = setTimeout(() => resolve('still-pending'), ms)
        timer.unref?.()
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

// ==================== Tests ====================

describe('TradingGit', () => {
  let config: TradingGitConfig
  let git: TradingGit

  beforeEach(() => {
    config = makeConfig()
    git = new TradingGit(config)
  })

  // ==================== add ====================

  describe('add', () => {
    it('stages an operation and returns AddResult', () => {
      const result = git.add(buyOp())
      expect(result.staged).toBe(true)
      expect(result.index).toBe(0)
      expect(result.operation.action).toBe('placeOrder')
    })

    it('increments index for multiple adds', () => {
      git.add(buyOp('AAPL'))
      const r2 = git.add(buyOp('GOOG'))
      expect(r2.index).toBe(1)
    })

    it('shows staged operations in status', () => {
      git.add(buyOp())
      const status = git.status()
      expect(status.staged).toHaveLength(1)
      expect(status.pendingMessage).toBeNull()
    })

    it('does not allow the reviewed payload to change while a commit awaits approval', async () => {
      git.add(buyOp('AAPL'))
      const { hash } = git.commit('Buy AAPL')

      expect(() => git.add(buyOp('MSFT'))).toThrow(PendingHashConflictError)
      expect(git.status()).toMatchObject({
        pendingHash: hash,
        pendingMessage: 'Buy AAPL',
        staged: [expect.objectContaining({ action: 'placeOrder' })],
      })

      await git.push(hash)
      expect(config.executeOperation).toHaveBeenCalledOnce()
    })
  })

  // ==================== commit ====================

  describe('commit', () => {
    it('prepares a commit with hash and message', () => {
      git.add(buyOp())
      const result = git.commit('Buy AAPL')
      expect(result.prepared).toBe(true)
      expect(result.hash).toHaveLength(8)
      expect(result.message).toBe('Buy AAPL')
      expect(result.operationCount).toBe(1)
    })

    it('throws when staging area is empty', () => {
      expect(() => git.commit('empty commit')).toThrow('Nothing to commit')
    })

    it('updates status with pending message', () => {
      git.add(buyOp())
      git.commit('msg')
      const status = git.status()
      expect(status.pendingMessage).toBe('msg')
    })
  })

  // ==================== push ====================

  describe('push', () => {
    it('executes operations and returns PushResult', async () => {
      git.add(buyOp())
      git.commit('Buy AAPL')
      const result = await git.push(git.status().pendingHash!)

      expect(result.hash).toHaveLength(8)
      expect(result.message).toBe('Buy AAPL')
      expect(result.operationCount).toBe(1)
      expect(result.submitted).toHaveLength(1)
      expect(result.rejected).toHaveLength(0)
    })

    it('calls executeOperation for each staged op', async () => {
      git.add(buyOp('AAPL'))
      git.add(buyOp('GOOG'))
      git.commit('Two buys')
      await git.push(git.status().pendingHash!)

      expect(config.executeOperation).toHaveBeenCalledTimes(2)
    })

    it('calls getGitState after execution', async () => {
      git.add(buyOp())
      git.commit('msg')
      await git.push(git.status().pendingHash!)

      expect(config.getGitState).toHaveBeenCalled()
    })

    it('clears staging area after push', async () => {
      git.add(buyOp())
      git.commit('msg')
      await git.push(git.status().pendingHash!)

      const status = git.status()
      expect(status.staged).toHaveLength(0)
      expect(status.pendingMessage).toBeNull()
    })

    it('throws when staging area is empty', async () => {
      await expect(git.push(git.status().pendingHash!)).rejects.toThrow('Nothing to push')
    })

    it('throws when not committed', async () => {
      git.add(buyOp())
      await expect(git.push(git.status().pendingHash!)).rejects.toThrow('please commit first')
    })

    it('refuses a mismatched expected hash without executing', async () => {
      git.add(buyOp())
      git.commit('Buy AAPL')
      await expect(git.push('stalehash')).rejects.toBeInstanceOf(PendingHashConflictError)
      expect(config.executeOperation).not.toHaveBeenCalled()
      expect(git.status().pendingMessage).toBe('Buy AAPL')
    })

    it('refuses a missing expected hash at the domain boundary', async () => {
      git.add(buyOp())
      git.commit('Buy AAPL')
      const pushWithoutHash = git.push as unknown as () => Promise<unknown>

      await expect(pushWithoutHash.call(git)).rejects.toBeInstanceOf(PendingHashConflictError)
      expect(config.executeOperation).not.toHaveBeenCalled()
      expect(git.status().pendingMessage).toBe('Buy AAPL')
    })

    it('pushes when the expected hash still matches', async () => {
      git.add(buyOp())
      const { hash } = git.commit('Buy AAPL')
      const result = await git.push(hash)
      expect(result.hash).toBe(hash)
      expect(config.executeOperation).toHaveBeenCalledOnce()
    })

    it('rejects a second write while one is in flight', async () => {
      let release!: () => void
      const blocked = new Promise<void>((resolve) => { release = resolve })
      const slow = makeConfig({
        executeOperation: vi.fn(async () => {
          await blocked
          return { success: true, orderId: 'order-1' }
        }),
      })
      const slowGit = new TradingGit(slow)
      slowGit.add(buyOp())
      const { hash } = slowGit.commit('Buy AAPL')
      const first = slowGit.push(hash)
      await expect(slowGit.push(hash)).rejects.toBeInstanceOf(PendingHashConflictError)
      release()
      await first
    })

    it('rejects staging and recommit while a write is in flight', async () => {
      let release!: () => void
      const blocked = new Promise<void>((resolve) => { release = resolve })
      const slow = makeConfig({
        executeOperation: vi.fn(async () => {
          await blocked
          return { success: true, orderId: 'order-1' }
        }),
      })
      const slowGit = new TradingGit(slow)
      slowGit.add(buyOp())
      const { hash } = slowGit.commit('Buy AAPL')
      const first = slowGit.push(hash)

      expect(() => slowGit.add(buyOp('MSFT'))).toThrow(PendingHashConflictError)
      expect(() => slowGit.commit('changed')).toThrow(PendingHashConflictError)

      release()
      await first
    })

    it('calls onCommit callback with exported state', async () => {
      const onCommit = vi.fn()
      const gitWithCb = new TradingGit({ ...config, onCommit })

      gitWithCb.add(buyOp())
      gitWithCb.commit('msg')
      await gitWithCb.push(gitWithCb.status().pendingHash!)

      expect(onCommit).toHaveBeenCalledTimes(1)
      const exported = onCommit.mock.calls[0][0]
      expect(exported.commits).toHaveLength(1)
      expect(exported.head).toHaveLength(8)
    })

    it('handles rejected operations gracefully', async () => {
      const failConfig = makeConfig({
        executeOperation: vi.fn().mockResolvedValue({ success: false, error: 'Insufficient funds' }),
      })
      const gitFail = new TradingGit(failConfig)

      gitFail.add(buyOp())
      gitFail.commit('msg')
      const result = await gitFail.push(gitFail.status().pendingHash!)

      expect(result.rejected).toHaveLength(1)
      expect(result.submitted).toHaveLength(0)
    })

    it('handles operation exceptions', async () => {
      const failConfig = makeConfig({
        executeOperation: vi.fn().mockRejectedValue(new Error('Network error')),
      })
      const gitFail = new TradingGit(failConfig)

      gitFail.add(buyOp())
      gitFail.commit('msg')
      const result = await gitFail.push(gitFail.status().pendingHash!)

      expect(result.rejected).toHaveLength(1)
      expect(result.rejected[0].error).toBe('Network error')
    })

    it('categorizes pending orders correctly', async () => {
      const pendingConfig = makeConfig({
        executeOperation: vi.fn().mockResolvedValue({
          success: true,
          orderId: 'order-2',
        }),
      })
      const gitPending = new TradingGit(pendingConfig)

      gitPending.add(buyOp())
      gitPending.commit('limit order')
      const result = await gitPending.push(gitPending.status().pendingHash!)

      expect(result.submitted).toHaveLength(1)
      expect(result.rejected).toHaveLength(0)
    })

    it('maps Filled orderState to filled status', async () => {
      const orderState = new OrderState()
      orderState.status = 'Filled'
      const filledConfig = makeConfig({
        executeOperation: vi.fn().mockResolvedValue({
          success: true,
          orderId: 'order-filled',
          orderState,
        }),
      })
      const gitFilled = new TradingGit(filledConfig)

      gitFilled.add(buyOp())
      gitFilled.commit('market buy')
      const result = await gitFilled.push(gitFilled.status().pendingHash!)

      expect(result.submitted).toHaveLength(1)
      expect(result.submitted[0].status).toBe('filled')
      expect(result.rejected).toHaveLength(0)
    })

    it('maps Cancelled orderState to cancelled status', async () => {
      const orderState = new OrderState()
      orderState.status = 'Cancelled'
      const cancelConfig = makeConfig({
        executeOperation: vi.fn().mockResolvedValue({
          success: true,
          orderId: 'order-cancel',
          orderState,
        }),
      })
      const gitCancel = new TradingGit(cancelConfig)

      gitCancel.add({ action: 'cancelOrder', orderId: 'order-cancel' })
      gitCancel.commit('cancel order')
      const result = await gitCancel.push(gitCancel.status().pendingHash!)

      expect(result.submitted).toHaveLength(1)
      expect(result.submitted[0].status).toBe('cancelled')
      expect(result.rejected).toHaveLength(0)
    })

    it('defaults to submitted when no orderState', async () => {
      const noStateConfig = makeConfig({
        executeOperation: vi.fn().mockResolvedValue({
          success: true,
          orderId: 'order-async',
        }),
      })
      const gitAsync = new TradingGit(noStateConfig)

      gitAsync.add(buyOp())
      gitAsync.commit('async limit')
      const result = await gitAsync.push(gitAsync.status().pendingHash!)

      expect(result.submitted).toHaveLength(1)
      expect(result.submitted[0].status).toBe('submitted')
    })

    it('maps Inactive orderState to rejected status', async () => {
      const orderState = new OrderState()
      orderState.status = 'Inactive'
      const inactiveConfig = makeConfig({
        executeOperation: vi.fn().mockResolvedValue({
          success: true,
          orderId: 'order-inactive',
          orderState,
        }),
      })
      const gitInactive = new TradingGit(inactiveConfig)

      gitInactive.add(buyOp())
      gitInactive.commit('rejected by exchange')
      const result = await gitInactive.push(gitInactive.status().pendingHash!)

      // Inactive maps to rejected — but success is still true from broker
      // so it lands in submitted (success-based), with status 'rejected'
      expect(result.submitted).toHaveLength(1)
      expect(result.submitted[0].status).toBe('rejected')
    })

    it('records failed cancelOrder in rejected array', async () => {
      const failConfig = makeConfig({
        executeOperation: vi.fn().mockResolvedValue({
          success: false,
          error: 'Order not found',
        }),
      })
      const gitFail = new TradingGit(failConfig)

      gitFail.add({ action: 'cancelOrder', orderId: 'nonexistent' })
      gitFail.commit('cancel unknown')
      const result = await gitFail.push(gitFail.status().pendingHash!)

      expect(result.rejected).toHaveLength(1)
      expect(result.rejected[0].error).toBe('Order not found')
      expect(result.submitted).toHaveLength(0)
    })
  })

  // ==================== log ====================

  describe('log', () => {
    it('returns empty array when no commits', () => {
      expect(git.log()).toEqual([])
    })

    it('returns commits in reverse chronological order', async () => {
      git.add(buyOp('AAPL'))
      git.commit('First')
      await git.push(git.status().pendingHash!)

      git.add(buyOp('GOOG'))
      git.commit('Second')
      await git.push(git.status().pendingHash!)

      const entries = git.log()
      expect(entries).toHaveLength(2)
      expect(entries[0].message).toBe('Second')
      expect(entries[1].message).toBe('First')
    })

    it('filters by symbol', async () => {
      git.add(buyOp('AAPL'))
      git.commit('Buy AAPL')
      await git.push(git.status().pendingHash!)

      git.add(buyOp('GOOG'))
      git.commit('Buy GOOG')
      await git.push(git.status().pendingHash!)

      const entries = git.log({ symbol: 'AAPL' })
      expect(entries).toHaveLength(1)
      expect(entries[0].message).toBe('Buy AAPL')
    })

    it('respects limit', async () => {
      for (let i = 0; i < 5; i++) {
        git.add(buyOp('AAPL'))
        git.commit(`Commit ${i}`)
        await git.push(git.status().pendingHash!)
      }

      const entries = git.log({ limit: 2 })
      expect(entries).toHaveLength(2)
    })

    it('includes operation summaries', async () => {
      git.add(buyOp('AAPL'))
      git.commit('Buy')
      await git.push(git.status().pendingHash!)

      const entries = git.log()
      expect(entries[0].operations).toHaveLength(1)
      expect(entries[0].operations[0].symbol).toBe('AAPL')
      expect(entries[0].operations[0].action).toBe('placeOrder')
    })

    it('keeps limit-order review terms in structured and text summaries', async () => {
      const operation = buyOp('MU')
      if (operation.action !== 'placeOrder') throw new Error('expected placeOrder')
      operation.order.orderType = 'LMT'
      operation.order.lmtPrice = new Decimal('971')
      operation.order.tif = 'GTC'
      git.add(operation)
      git.commit('MU entry')
      await git.push(git.status().pendingHash!)

      const [entry] = git.log()
      expect(entry.operations[0].change).toBe('BUY 10 LMT @971 GTC (submitted)')
      expect(entry.operations[0].order).toEqual({
        side: 'BUY',
        orderType: 'LMT',
        totalQuantity: '10',
        cashQuantity: undefined,
        limitPrice: '971',
        auxPrice: undefined,
        timeInForce: 'GTC',
      })
    })
  })

  describe('reject expected hash', () => {
    it('refuses a mismatched expected hash without recording a reject commit', async () => {
      git.add(buyOp())
      git.commit('Buy AAPL')
      await expect(git.reject('nope', 'stalehash')).rejects.toBeInstanceOf(PendingHashConflictError)
      expect(git.status().pendingMessage).toBe('Buy AAPL')
      expect(git.status().commitCount).toBe(0)
    })

    it('rejects when the expected hash still matches', async () => {
      git.add(buyOp())
      const { hash } = git.commit('Buy AAPL')
      const result = await git.reject('changed mind', hash)
      expect(result.hash).toBe(hash)
      expect(git.status().pendingMessage).toBeNull()
    })

    it('refuses reject without an expected hash', async () => {
      git.add(buyOp())
      git.commit('Buy AAPL')
      const rejectWithoutHash = git.reject as unknown as (reason?: string) => Promise<unknown>

      await expect(rejectWithoutHash.call(git, 'nope')).rejects.toBeInstanceOf(PendingHashConflictError)
      expect(git.status().pendingMessage).toBe('Buy AAPL')
      expect(git.status().commitCount).toBe(0)
    })
  })

  // ==================== show ====================

  describe('show', () => {
    it('returns null for unknown hash', () => {
      expect(git.show('deadbeef')).toBeNull()
    })

    it('returns the full commit for a known hash', async () => {
      git.add(buyOp())
      const { hash } = git.commit('msg')
      await git.push(git.status().pendingHash!)

      const commit = git.show(hash)
      expect(commit).not.toBeNull()
      expect(commit!.hash).toBe(hash)
      expect(commit!.message).toBe('msg')
      expect(commit!.operations).toHaveLength(1)
      expect(commit!.results).toHaveLength(1)
    })
  })

  // ==================== status ====================

  describe('status', () => {
    it('reports clean state initially', () => {
      const s = git.status()
      expect(s.staged).toHaveLength(0)
      expect(s.pendingMessage).toBeNull()
      expect(s.head).toBeNull()
      expect(s.commitCount).toBe(0)
    })

    it('tracks head and commitCount after push', async () => {
      git.add(buyOp())
      git.commit('msg')
      await git.push(git.status().pendingHash!)

      const s = git.status()
      expect(s.head).toHaveLength(8)
      expect(s.commitCount).toBe(1)
    })
  })

  // ==================== sentinel boundary ====================

  describe('sentinel boundary (OrderHelper.toWire)', () => {
    // Regression: 2026-05-13 — MKT order on Bybit rendered as
    // "BUY 0.0005 BTC/USDT MKT @ 1.70141183460469231731687303715884105727e+38"
    // in PushApprovalPanel. UNSET_DECIMAL (2^127-1) leaked from Order's
    // class defaults through c.json into the UI. Every public observer of
    // staged/committed Operations must strip Order-class sentinels.
    const UNSET_DECIMAL_STR = '1.70141183460469231731687303715884105727e+38'

    it('status().staged strips sentinel fields from a MKT placeOrder', () => {
      // MKT order — totalQuantity is the only price-shaped field user set.
      // lmtPrice / auxPrice / trailStopPrice / trailingPercent / cashQty
      // all hold the UNSET_DECIMAL class default and must NOT appear.
      git.add(buyOp())
      const s = git.status()
      const op = s.staged[0] as Extract<Operation, { action: 'placeOrder' }>
      expect(op.order).not.toHaveProperty('lmtPrice')
      expect(op.order).not.toHaveProperty('auxPrice')
      expect(op.order).not.toHaveProperty('trailStopPrice')
      expect(op.order).not.toHaveProperty('trailingPercent')
      expect(op.order).not.toHaveProperty('cashQty')
      expect(op.order).not.toHaveProperty('filledQuantity')
      // Real value passes through.
      expect(op.order.totalQuantity).toBeInstanceOf(Decimal)
      expect(op.order.totalQuantity.toFixed()).toBe('10')
    })

    it('show()/exportState()/status() JSON output contains no sentinel literal', async () => {
      git.add(buyOp())
      git.commit('mkt buy')
      await git.push(git.status().pendingHash!)

      const head = git.status().head!
      for (const blob of [git.status(), git.show(head), git.exportState()]) {
        const serialised = JSON.stringify(blob)
        expect(serialised).not.toContain(UNSET_DECIMAL_STR)
        expect(serialised).not.toContain('170141183460469231731687303715884105727')
      }
    })

    it('modifyOrder.changes also strips sentinels', () => {
      const partialChanges = new Order()
      partialChanges.lmtPrice = new Decimal('150')
      // All other fields remain at UNSET_DECIMAL class defaults.
      git.add({ action: 'modifyOrder', orderId: 'o-1', changes: partialChanges })
      const s = git.status()
      const op = s.staged[0] as Extract<Operation, { action: 'modifyOrder' }>
      expect(op.changes.lmtPrice).toBeInstanceOf(Decimal)
      expect((op.changes.lmtPrice as Decimal).toFixed()).toBe('150')
      expect(op.changes).not.toHaveProperty('auxPrice')
      expect(op.changes).not.toHaveProperty('trailStopPrice')
      expect(op.changes).not.toHaveProperty('totalQuantity')
    })

    it('non-sentinel Decimal fields survive (round-trip safety)', async () => {
      const contract = makeContract({ symbol: 'ETH' })
      const order = new Order()
      order.action = 'BUY'
      order.orderType = 'LMT'
      order.totalQuantity = new Decimal('0.5')
      order.lmtPrice = new Decimal('3500.25')
      git.add({ action: 'placeOrder', contract, order })
      git.commit('lmt buy')
      await git.push(git.status().pendingHash!)

      const exported = git.exportState()
      const op = exported.commits[0].operations[0] as Extract<Operation, { action: 'placeOrder' }>
      expect(op.order.lmtPrice).toBeInstanceOf(Decimal)
      expect((op.order.lmtPrice as Decimal).toFixed()).toBe('3500.25')
      expect(op.order.totalQuantity.toFixed()).toBe('0.5')
      // But unset auxPrice still gone.
      expect(op.order).not.toHaveProperty('auxPrice')
    })

    it('staging mutation after status() does not affect prior projection', () => {
      // Defensive: projectOperation must spread, not return raw ref.
      git.add(buyOp())
      const s1 = git.status()
      const op1 = s1.staged[0] as Extract<Operation, { action: 'placeOrder' }>
      // Mutate the projection — should not bleed back into staging.
      ;(op1.order as unknown as Record<string, unknown>).lmtPrice = 'tampered'
      const s2 = git.status()
      const op2 = s2.staged[0] as Extract<Operation, { action: 'placeOrder' }>
      expect(op2.order).not.toHaveProperty('lmtPrice')
    })
  })

  // ==================== exportState / restore ====================

  describe('exportState / restore', () => {
    it('round-trips state', async () => {
      git.add(buyOp('AAPL'))
      git.commit('Buy AAPL')
      await git.push(git.status().pendingHash!)

      const exported = git.exportState()
      expect(exported.commits).toHaveLength(1)
      expect(exported.head).toHaveLength(8)

      const restored = TradingGit.restore(exported, config)
      expect(restored.status().commitCount).toBe(1)
      expect(restored.status().head).toBe(exported.head)

      const log = restored.log()
      expect(log).toHaveLength(1)
      expect(log[0].message).toBe('Buy AAPL')
    })

    it('rehydrates Decimal price fields through JSON round-trip', async () => {
      const contract = makeContract({ symbol: 'ETH' })
      const order = new Order()
      order.action = 'BUY'
      order.orderType = 'LMT'
      order.totalQuantity = new Decimal('0.12345678')
      order.lmtPrice = new Decimal('0.00001234')
      order.auxPrice = new Decimal('0.3')
      order.trailStopPrice = new Decimal('145.5')
      order.trailingPercent = new Decimal('2.5')
      order.cashQty = new Decimal('1000')
      git.add({ action: 'placeOrder', contract, order })
      git.commit('precise eth order')
      await git.push(git.status().pendingHash!)

      // Simulate persist → reload by going through JSON.
      const exported = JSON.parse(JSON.stringify(git.exportState()))
      const restored = TradingGit.restore(exported, config)
      const commit = restored.show(restored.status().head!)
      const op = commit!.operations[0] as Extract<Operation, { action: 'placeOrder' }>
      expect(op.order.totalQuantity).toBeInstanceOf(Decimal)
      expect(op.order.totalQuantity.toFixed()).toBe('0.12345678')
      expect(op.order.lmtPrice).toBeInstanceOf(Decimal)
      expect(op.order.lmtPrice.toFixed()).toBe('0.00001234')
      expect(op.order.auxPrice.toFixed()).toBe('0.3')
      expect(op.order.trailStopPrice.toFixed()).toBe('145.5')
      expect(op.order.trailingPercent.toFixed()).toBe('2.5')
      expect(op.order.cashQty.toFixed()).toBe('1000')
    })

    it('rehydrates legacy number-typed price fields to Decimal', async () => {
      // Simulate an older persisted file where price fields were JSON numbers.
      const contract = makeContract({ symbol: 'AAPL' })
      const order = new Order()
      order.action = 'BUY'
      order.orderType = 'LMT'
      order.totalQuantity = new Decimal(10)
      order.lmtPrice = new Decimal(145.25)
      git.add({ action: 'placeOrder', contract, order })
      git.commit('legacy order')
      await git.push(git.status().pendingHash!)

      const exported = git.exportState()
      // Tamper: rewrite lmtPrice as a bare number in the serialised form.
      const raw = JSON.parse(JSON.stringify(exported)) as typeof exported
      const committedOp = raw.commits[0].operations[0] as Extract<Operation, { action: 'placeOrder' }>
      ;(committedOp.order as unknown as { lmtPrice: number }).lmtPrice = 145.25
      const restored = TradingGit.restore(raw, config)
      const commit = restored.show(restored.status().head!)
      const op = commit!.operations[0] as Extract<Operation, { action: 'placeOrder' }>
      expect(op.order.lmtPrice).toBeInstanceOf(Decimal)
      expect(op.order.lmtPrice.toNumber()).toBe(145.25)
    })

    it('reconcileBalance commits survive JSON round-trip and log() does not throw', async () => {
      // Regression: previously stored quantityDelta/markPrice as Decimal in the
      // Operation type. After JSON.stringify (via onCommit persistence) they
      // came back as strings, and `formatOperationChange` calling .gte()/.toFixed()
      // exploded with "is not a function". Now the type is `string` end-to-end.
      await git.recordReconcile({
        aliceId: 'bybit-main|BTC',
        quantityDelta: new Decimal('1.0093'),
        markPrice: new Decimal('80569.90'),
        stateAfter: makeGitState(),
      })

      const exported = JSON.parse(JSON.stringify(git.exportState()))
      const restored = TradingGit.restore(exported, config)

      // Direct field check — values stay as strings.
      const commit = restored.show(restored.status().head!)
      const op = commit!.operations[0] as Extract<Operation, { action: 'reconcileBalance' }>
      expect(typeof op.quantityDelta).toBe('string')
      expect(typeof op.markPrice).toBe('string')
      expect(op.quantityDelta).toBe('1.0093')
      expect(op.markPrice).toBe('80569.9')

      // The crash path: log() walks commits, formatOperationChange parses
      // the string back to Decimal via `new Decimal(...)`. Should not throw.
      const log = restored.log()
      expect(log).toHaveLength(1)
      expect(log[0].operations[0].change).toContain('observed')
      expect(log[0].operations[0].change).toContain('1.0093')
    })
  })

  // ==================== setCurrentRound ====================

  describe('setCurrentRound', () => {
    it('tags commits with the current round', async () => {
      git.setCurrentRound(42)
      git.add(buyOp())
      git.commit('msg')
      await git.push(git.status().pendingHash!)

      const commit = git.show(git.status().head!)
      expect(commit!.round).toBe(42)
    })
  })

  // ==================== sync ====================

  describe('sync', () => {
    it('creates a sync commit for order updates', async () => {
      const state = makeGitState()
      const result = await git.sync(
        [
          {
            orderId: 'order-1',
            symbol: 'AAPL',
            previousStatus: 'submitted',
            currentStatus: 'filled',
            filledPrice: '155',
            filledQty: '10',
          },
        ],
        state,
      )

      expect(result.updatedCount).toBe(1)
      expect(result.hash).toHaveLength(8)
      expect(git.status().commitCount).toBe(1)
    })

    it('returns empty result for no updates', async () => {
      const result = await git.sync([], makeGitState())
      expect(result.updatedCount).toBe(0)
    })
  })

  // ==================== getPendingOrderIds ====================

  describe('getPendingOrderIds', () => {
    it('returns empty when no commits', () => {
      expect(git.getPendingOrderIds()).toEqual([])
    })

    it('finds pending orders from commits', async () => {
      const pendingConfig = makeConfig({
        executeOperation: vi.fn().mockResolvedValue({
          success: true,
          orderId: 'lmt-1',
        }),
      })
      const gitP = new TradingGit(pendingConfig)

      gitP.add(buyOp('AAPL'))
      gitP.commit('limit buy')
      await gitP.push(gitP.status().pendingHash!)

      const pending = gitP.getPendingOrderIds()
      expect(pending).toHaveLength(1)
      // localSymbol/aliceId ride along when the operation's contract has
      // them — broker lookup hint + reconcile race guard respectively.
      expect(pending[0]).toMatchObject({ orderId: 'lmt-1', symbol: 'AAPL' })
    })

    it('excludes orders that have been synced to filled', async () => {
      const pendingConfig = makeConfig({
        executeOperation: vi.fn().mockResolvedValue({
          success: true,
          orderId: 'lmt-1',
        }),
      })
      const gitP = new TradingGit(pendingConfig)

      gitP.add(buyOp('AAPL'))
      gitP.commit('limit buy')
      await gitP.push(gitP.status().pendingHash!)

      // Sync to filled
      await gitP.sync(
        [{
          orderId: 'lmt-1',
          symbol: 'AAPL',
          previousStatus: 'submitted',
          currentStatus: 'filled',
          filledPrice: '155',
          filledQty: '10',
        }],
        makeGitState(),
      )

      expect(gitP.getPendingOrderIds()).toHaveLength(0)
    })

    it('tracks bracket TP/SL legs from birth (Alpaca naked-ledger bug)', async () => {
      // The bug: bracket legs existed only on the exchange — order list,
      // sync poller, and cancel were all blind to them; the held SL leg
      // never even appears in the venue's open-orders listing.
      const legConfig = makeConfig({
        executeOperation: vi.fn().mockResolvedValue({
          success: true,
          orderId: 'parent-1',
          legs: [
            { orderId: 'leg-tp', kind: 'takeProfit' },
            { orderId: 'leg-sl', kind: 'stopLoss' },
          ],
        }),
      })
      const gitP = new TradingGit(legConfig)

      gitP.add(buyOp('AAPL'))
      gitP.commit('bracket buy')
      await gitP.push(gitP.status().pendingHash!)

      const pending = gitP.getPendingOrderIds()
      expect(pending.map((p) => p.orderId).sort()).toEqual(['leg-sl', 'leg-tp', 'parent-1'])
      // Legs inherit the parent operation's contract (symbol-scoped lookups
      // + restart survival need it).
      for (const p of pending) expect(p.symbol).toBe('AAPL')

      // Observation pass must never re-record our own legs as external.
      const known = gitP.getKnownOrderIds()
      expect(known.has('leg-tp')).toBe(true)
      expect(known.has('leg-sl')).toBe(true)

      // A later sync resolving a leg removes it from pending, keeps the rest.
      await gitP.sync(
        [{
          orderId: 'leg-tp', symbol: 'AAPL',
          previousStatus: 'submitted', currentStatus: 'filled',
          filledPrice: '297', filledQty: '1',
        }],
        makeGitState(),
      )
      expect(gitP.getPendingOrderIds().map((p) => p.orderId).sort()).toEqual(['leg-sl', 'parent-1'])
    })

    it('survives a multi-update sync commit (1 op, N results — boot-loop regression)', async () => {
      const gitP = new TradingGit(makeConfig({
        executeOperation: vi.fn().mockResolvedValue({ success: true, orderId: 'o-1' }),
      }))
      gitP.add(buyOp('AAPL'))
      gitP.commit('buy')
      await gitP.push(gitP.status().pendingHash!)

      // One sync commit carrying TWO updates → operations[1] is undefined;
      // the pending scan crashed the whole UTA process on every boot once
      // such a commit was persisted in the journal.
      await gitP.sync(
        [
          { orderId: 'o-1', symbol: 'AAPL', previousStatus: 'submitted', currentStatus: 'filled', filledPrice: '10', filledQty: '1' },
          { orderId: 'o-2', symbol: 'MSFT', previousStatus: 'submitted', currentStatus: 'cancelled' },
        ],
        makeGitState(),
      )

      expect(() => gitP.getPendingOrderIds()).not.toThrow()
      expect(gitP.getPendingOrderIds()).toHaveLength(0)
    })

    it('excludes orders that were filled at push time (no sync needed)', async () => {
      const orderState = new OrderState()
      orderState.status = 'Filled'
      const filledConfig = makeConfig({
        executeOperation: vi.fn().mockResolvedValue({
          success: true,
          orderId: 'mkt-1',
          orderState,
        }),
      })
      const gitP = new TradingGit(filledConfig)

      gitP.add(buyOp('AAPL'))
      gitP.commit('market buy')
      await gitP.push(gitP.status().pendingHash!)

      // Filled at push time → should NOT appear as pending
      expect(gitP.getPendingOrderIds()).toHaveLength(0)
    })
  })

  describe('log — sync commit attribution', () => {
    it('renders one row per sync update, attributed by the update symbol', async () => {
      const gitS = new TradingGit(makeConfig({
        executeOperation: vi.fn().mockResolvedValue({ success: true, orderId: 'o-1' }),
      }))
      gitS.add(buyOp('AAPL'))
      gitS.commit('buy')
      await gitS.push(gitS.status().pendingHash!)

      await gitS.sync(
        [
          { orderId: 'o-1', symbol: 'AAPL', previousStatus: 'submitted', currentStatus: 'filled', filledPrice: '150', filledQty: '10' },
          { orderId: 'o-2', symbol: 'TSLA', previousStatus: 'submitted', currentStatus: 'cancelled' },
        ],
        makeGitState(),
      )

      const [head] = gitS.log({ limit: 1 })
      expect(head.operations).toHaveLength(2)
      expect(head.operations.map((o) => o.symbol)).toEqual(['AAPL', 'TSLA'])
      expect(head.operations[0].change).toContain('@150')
    })
  })

  // ==================== simulatePriceChange ====================

  describe('simulatePriceChange — derivative handling (community sign-flip report)', () => {
    it('excludes option rows from a symbol-level change and applies multiplier to applied rows', async () => {
      const optContract = makeContract({ symbol: 'AAPL' })
      optContract.secType = 'OPT'
      optContract.strike = 260
      optContract.right = 'P'
      const gitS = new TradingGit(makeConfig({
        getGitState: vi.fn().mockResolvedValue(makeGitState({
          positions: [
            { contract: makeContract({ symbol: 'AAPL' }), currency: 'USD', side: 'long',
              quantity: new Decimal(10), avgCost: '261', marketPrice: '290',
              marketValue: '2900', unrealizedPnL: '290', realizedPnL: '0', multiplier: '1' },
            // short put — its own price must NOT be replaced by the stock's
            { contract: optContract, currency: 'USD', side: 'short',
              quantity: new Decimal(1), avgCost: '1.03', marketPrice: '1.15',
              marketValue: '115', unrealizedPnL: '-12', realizedPnL: '0', multiplier: '100' },
          ] as never,
        })),
      }))

      const r = await gitS.simulatePriceChange([{ symbol: 'AAPL', change: '-5%' }])
      expect(r.success).toBe(true)
      const rows = r.simulatedState.positions
      // Stock row moved; option row untouched (no +23,000% garbage)
      expect(Number(rows[0].simulatedPrice)).toBeCloseTo(275.5, 1)
      expect(rows[1].simulatedPrice).toBe('1.15')
      expect(rows[1].pnlChange).toBe('0')
      // exclusion is loud, not silent
      expect(r.summary.worstCase).toMatch(/derivative positions not simulated/i)
      expect(r.summary.worstCase).toMatch(/OPT/)
    })

    it("'all' scales a derivative's OWN mark with multiplier-aware math", async () => {
      const optContract = makeContract({ symbol: 'AAPL' })
      optContract.secType = 'OPT'
      const gitS = new TradingGit(makeConfig({
        getGitState: vi.fn().mockResolvedValue(makeGitState({
          positions: [
            { contract: optContract, currency: 'USD', side: 'short',
              quantity: new Decimal(1), avgCost: '1.03', marketPrice: '1.00',
              marketValue: '100', unrealizedPnL: '3', realizedPnL: '0', multiplier: '100' },
          ] as never,
        })),
      }))
      const r = await gitS.simulatePriceChange([{ symbol: 'all', change: '+10%' }])
      const row = r.simulatedState.positions[0]
      // own mark 1.00 → 1.10; short: (1.03 − 1.10) × 1 × 100 = −7
      expect(Number(row.simulatedPrice)).toBeCloseTo(1.10, 8)
      expect(Number(row.unrealizedPnL)).toBeCloseTo(-7, 6)
      expect(Number(row.marketValue)).toBeCloseTo(110, 6)
    })
  })

  describe('simulatePriceChange', () => {
    it('returns empty state when no positions', async () => {
      const result = await git.simulatePriceChange([{ symbol: 'AAPL', change: '-10%' }])
      expect(result.success).toBe(true)
      expect(result.summary.totalPnLChange).toBe('0')
    })

    it('simulates relative price change on long position', async () => {
      const stateWithPositions = makeGitState({
        positions: [
          {
            contract: makeContract({ aliceId: 'mock-paper|AAPL', symbol: 'AAPL' }),
            currency: 'USD',
            side: 'long',
            quantity: new Decimal(10),
            avgCost: '150',
            marketPrice: '160',
            marketValue: '1600',
            unrealizedPnL: '100',
            realizedPnL: '0',
            multiplier: '1',
          },
        ],
      })
      const simConfig = makeConfig({
        getGitState: vi.fn().mockResolvedValue(stateWithPositions),
      })
      const simGit = new TradingGit(simConfig)

      const result = await simGit.simulatePriceChange([{ symbol: 'AAPL', change: '-10%' }])
      expect(result.success).toBe(true)
      // Price drops 10%: 160 -> 144
      const simPos = result.simulatedState.positions[0]
      expect(simPos.simulatedPrice).toBe('144')
      // PnL: (144 - 150) * 10 = -60
      expect(simPos.unrealizedPnL).toBe('-60')
    })

    it('simulates absolute price change', async () => {
      const stateWithPositions = makeGitState({
        positions: [
          {
            contract: makeContract({ aliceId: 'mock-paper|AAPL', symbol: 'AAPL' }),
            currency: 'USD',
            side: 'long',
            quantity: new Decimal(10),
            avgCost: '150',
            marketPrice: '160',
            marketValue: '1600',
            unrealizedPnL: '100',
            realizedPnL: '0',
            multiplier: '1',
          },
        ],
      })
      const simConfig = makeConfig({
        getGitState: vi.fn().mockResolvedValue(stateWithPositions),
      })
      const simGit = new TradingGit(simConfig)

      const result = await simGit.simulatePriceChange([{ symbol: 'AAPL', change: '@200' }])
      expect(result.success).toBe(true)
      expect(result.simulatedState.positions[0].simulatedPrice).toBe('200')
      // PnL: (200 - 150) * 10 = 500
      expect(result.simulatedState.positions[0].unrealizedPnL).toBe('500')
    })

    it('simulates "all" positions', async () => {
      const stateWithPositions = makeGitState({
        positions: [
          {
            contract: makeContract({ symbol: 'AAPL' }),
            currency: 'USD', side: 'long', quantity: new Decimal(10), avgCost: '100', marketPrice: '100',
            marketValue: '1000', unrealizedPnL: '0', realizedPnL: '0', multiplier: '1',
          },
          {
            contract: makeContract({ symbol: 'GOOG' }),
            currency: 'USD', side: 'long', quantity: new Decimal(5), avgCost: '200', marketPrice: '200',
            marketValue: '1000', unrealizedPnL: '0', realizedPnL: '0', multiplier: '1',
          },
        ],
      })
      const simConfig = makeConfig({ getGitState: vi.fn().mockResolvedValue(stateWithPositions) })
      const simGit = new TradingGit(simConfig)

      const result = await simGit.simulatePriceChange([{ symbol: 'all', change: '+10%' }])
      expect(result.success).toBe(true)
      expect(result.simulatedState.positions).toHaveLength(2)
      expect(Number(result.simulatedState.positions[0].simulatedPrice)).toBeCloseTo(110)
      expect(Number(result.simulatedState.positions[1].simulatedPrice)).toBeCloseTo(220)
    })

    it('returns error for invalid price change format', async () => {
      const stateWithPositions = makeGitState({
        positions: [
          {
            contract: makeContract({ symbol: 'AAPL' }),
            currency: 'USD', side: 'long', quantity: new Decimal(10), avgCost: '100', marketPrice: '100',
            marketValue: '1000', unrealizedPnL: '0', realizedPnL: '0', multiplier: '1',
          },
        ],
      })
      const simConfig = makeConfig({ getGitState: vi.fn().mockResolvedValue(stateWithPositions) })
      const simGit = new TradingGit(simConfig)

      const result = await simGit.simulatePriceChange([{ symbol: 'AAPL', change: 'bad' }])
      expect(result.success).toBe(false)
      expect(result.error).toContain('Invalid change format')
    })
  })

  // ==================== write liveness bound ====================
  //
  // Observed live defect: `inflightWrite` is released in the `finally` of
  // push()/reject(), so a broker call whose promise NEVER settles held the
  // wallet write lock forever. Every later add/commit/push/reject then threw
  // PENDING_HASH_CONFLICT and ITradingGit has no unlock — the account could no
  // longer stage or push anything, a stop-loss included. The bound frees it and
  // the commit records an honest 'unconfirmed' instead of a 'rejected' the
  // exchange never gave.

  describe('write liveness bound', () => {
    const WRITE_BOUND_MS = 50

    it('settles within the bound and releases the lock when a broker call never settles', async () => {
      let capturedSignal: AbortSignal | undefined
      let attempts = 0
      const executeOperation = vi.fn((_op: Operation, signal?: AbortSignal) => {
        attempts += 1
        if (attempts === 1) {
          // Ignores the signal on purpose: no IBroker method can be cancelled,
          // so the bound — not cooperative abort — is what frees the lock.
          capturedSignal = signal
          return new Promise<never>(() => {})
        }
        return Promise.resolve({ success: true, orderId: 'order-2' })
      })
      const bounded = new TradingGit(makeConfig({ executeOperation, writeTimeoutMs: WRITE_BOUND_MS }))
      bounded.add(buyOp())
      const { hash } = bounded.commit('Buy AAPL')

      const outcome = await withWatchdog(bounded.push(hash).then(() => null, (err: unknown) => err))

      expect(outcome).toBeInstanceOf(WriteOutcomeUnconfirmedError)
      const unconfirmed = outcome as WriteOutcomeUnconfirmedError
      expect(unconfirmed.hash).toBe(hash)
      expect(unconfirmed.code).toBe('WRITE_OUTCOME_UNCONFIRMED')
      expect(capturedSignal?.aborted).toBe(true)

      // The account is usable again — stage, commit, push.
      bounded.add(buyOp('MSFT'))
      const second = bounded.commit('Buy MSFT')
      await expect(bounded.push(second.hash)).resolves.toMatchObject({ operationCount: 1 })
      expect(attempts).toBe(2)
    })

    it('lets the next write through once the bound expires', async () => {
      let attempts = 0
      const executeOperation = vi.fn((_op: Operation, _signal?: AbortSignal) => {
        attempts += 1
        return attempts === 1
          ? new Promise<never>(() => {})
          : Promise.resolve({ success: true, orderId: 'order-1' })
      })
      const bounded = new TradingGit(makeConfig({ executeOperation, writeTimeoutMs: WRITE_BOUND_MS }))
      bounded.add(buyOp())
      const { hash } = bounded.commit('Buy AAPL')

      // Give the bound time to expire (pre-fix this never returns: the wedged
      // push holds the lock, and the next `add` below throws
      // PendingHashConflictError — the bricked-account symptom).
      await withWatchdog(bounded.push(hash).catch(() => null))

      bounded.add(buyOp('MSFT'))
      const second = bounded.commit('Buy MSFT')
      await expect(bounded.push(second.hash)).resolves.toMatchObject({ operationCount: 1 })
      expect(attempts).toBe(2)
    })

    it('records the unsettled operation as unconfirmed and the undispatched one as not executed', async () => {
      let attempts = 0
      const executeOperation = vi.fn((_op: Operation, _signal?: AbortSignal) => {
        attempts += 1
        return new Promise<never>(() => {})
      })
      const bounded = new TradingGit(makeConfig({ executeOperation, writeTimeoutMs: WRITE_BOUND_MS }))
      bounded.add(buyOp('AAPL')) // broker never answers this one
      bounded.add(buyOp('GOOG')) // never handed to the broker
      const { hash } = bounded.commit('Two buys')

      const outcome = await withWatchdog(bounded.push(hash).then(() => null, (err: unknown) => err))

      expect(outcome).toBeInstanceOf(WriteOutcomeUnconfirmedError)
      expect((outcome as WriteOutcomeUnconfirmedError).unconfirmed).toHaveLength(1)
      expect(attempts).toBe(1)

      const commit = bounded.show(hash)
      expect(commit?.results).toHaveLength(2)
      expect(commit?.results[0]).toMatchObject({ success: false, status: 'unconfirmed' })
      expect(commit?.results[0].error).toContain(`${WRITE_BOUND_MS}ms`)
      expect(commit?.results[1]).toMatchObject({ success: false, status: 'rejected' })
      expect(commit?.results[1].error).toContain('Not executed')

      // A record, not a claim: nothing unsettled is reported as submitted, and
      // the log surfaces the honest status.
      expect(bounded.log()[0].operations.map((o) => o.status)).toEqual(['unconfirmed', 'rejected'])

      // Staging is cleared, so the order of unknown fate cannot be re-pushed.
      const status = bounded.status()
      expect(status.pendingHash).toBeNull()
      expect(status.pendingMessage).toBeNull()
      expect(status.staged).toHaveLength(0)
    })

    it('ignores a straggler that answers only after the bound expired', async () => {
      let rejectLate!: (err: Error) => void
      const executeOperation = vi.fn(
        (_op: Operation, _signal?: AbortSignal) => new Promise((_resolve, reject) => { rejectLate = reject }),
      )
      const bounded = new TradingGit(makeConfig({ executeOperation, writeTimeoutMs: WRITE_BOUND_MS }))
      bounded.add(buyOp())
      const { hash } = bounded.commit('Buy AAPL')

      const outcome = await withWatchdog(bounded.push(hash).then(() => null, (err: unknown) => err))
      expect(outcome).toBeInstanceOf(WriteOutcomeUnconfirmedError)
      const commitCount = bounded.status().commitCount

      // The broker answers only after we stopped waiting. A late failure must
      // not be rewritten into a definite 'rejected' the caller never saw, and
      // the abandoned attempt must not surface as an unhandled rejection.
      rejectLate(new Error('ECONNRESET after the bound'))
      await new Promise((resolve) => setTimeout(resolve, 10))

      expect(bounded.show(hash)?.results[0]).toMatchObject({ success: false, status: 'unconfirmed' })
      expect(bounded.status().commitCount).toBe(commitCount)
    })

    it('does not record an abort-caused failure as rejected', async () => {
      const executeOperation = vi.fn((_op: Operation, signal?: AbortSignal) =>
        new Promise<never>((_resolve, reject) => {
          // A broker that honours the signal: it fails only because we aborted.
          signal?.addEventListener('abort', () => reject(new Error('The operation was aborted')))
        }),
      )
      const bounded = new TradingGit(makeConfig({ executeOperation, writeTimeoutMs: WRITE_BOUND_MS }))
      bounded.add(buyOp())
      const { hash } = bounded.commit('Buy AAPL')

      const outcome = await withWatchdog(bounded.push(hash).then(() => null, (err: unknown) => err))

      expect(outcome).toBeInstanceOf(WriteOutcomeUnconfirmedError)
      // That failure is the abort, not the exchange's verdict — the order may be
      // live, so it must never be recorded as a definite 'rejected'.
      const result = bounded.show(hash)?.results[0]
      expect(result).toMatchObject({ success: false, status: 'unconfirmed' })
      expect(result?.error).toContain('reconcile against broker state')
    })

    it('frees the lock when the order AND the post-execution snapshot never settle', async () => {
      let dead = true
      const executeOperation = vi.fn((_op: Operation, _signal?: AbortSignal) =>
        dead ? new Promise<never>(() => {}) : Promise.resolve({ success: true, orderId: 'order-1' }))
      const getGitState = vi.fn(() =>
        dead ? new Promise<never>(() => {}) : Promise.resolve(makeGitState()))
      const bounded = new TradingGit(makeConfig({ executeOperation, getGitState, writeTimeoutMs: WRITE_BOUND_MS }))
      bounded.add(buyOp())
      const { hash } = bounded.commit('Buy AAPL')

      // The realistic failure mode: one broker connection stops answering, so the
      // order AND the snapshot hang. Pre-fix (snapshot unbounded) this never
      // settles and the `add` below throws PendingHashConflictError — the account
      // stays bricked and a stop-loss could not be staged.
      const firstOutcome = await withWatchdog(bounded.push(hash).then(() => null, (err: unknown) => err))

      dead = false
      bounded.add(buyOp('MSFT'))
      const second = bounded.commit('Buy MSFT')
      await expect(bounded.push(second.hash)).resolves.toMatchObject({ operationCount: 1 })

      // The write that wedged is reported honestly instead of dropped.
      expect(firstOutcome).toBeInstanceOf(WriteOutcomeUnconfirmedError)
      const abandoned = bounded.show(hash)
      expect(abandoned?.results[0]).toMatchObject({ success: false, status: 'unconfirmed' })
      expect(abandoned?.stateAfterSource).toBe('unavailable')
    })

    it("carries the previous commit's state forward when the snapshot does not settle", async () => {
      let dead = false
      const healthyState = makeGitState({ netLiquidation: '111111', totalCashValue: '222222' })
      const executeOperation = vi.fn((_op: Operation, _signal?: AbortSignal) =>
        dead ? new Promise<never>(() => {}) : Promise.resolve({ success: true, orderId: 'order-1' }))
      const getGitState = vi.fn(() =>
        dead ? new Promise<never>(() => {}) : Promise.resolve(healthyState))
      const bounded = new TradingGit(makeConfig({ executeOperation, getGitState, writeTimeoutMs: WRITE_BOUND_MS }))

      bounded.add(buyOp('AAPL'))
      const { hash: firstHash } = bounded.commit('Buy AAPL')
      await bounded.push(firstHash)
      expect(bounded.show(firstHash)?.stateAfter).toEqual(healthyState)

      dead = true
      bounded.add(buyOp('GOOG'))
      const { hash } = bounded.commit('Buy GOOG')
      const outcome = await withWatchdog(bounded.push(hash).then(() => null, (err: unknown) => err))

      expect(outcome).toBeInstanceOf(WriteOutcomeUnconfirmedError)
      expect((outcome as WriteOutcomeUnconfirmedError).message)
        .toContain("previous commit's state was carried forward")

      const commit = bounded.show(hash)
      expect(commit?.results[0]).toMatchObject({ success: false, status: 'unconfirmed' })
      expect(commit?.stateAfterSource).toBe('last-known')
      // The carried-over snapshot is exactly what the log already held — never a
      // fresh read dressed up as this commit's outcome.
      expect(commit?.stateAfter).toEqual(healthyState)
    })

    it('appends no snapshot at all when the first write cannot read one', async () => {
      const executeOperation = vi.fn((_op: Operation, _signal?: AbortSignal) => new Promise<never>(() => {}))
      const getGitState = vi.fn(() => new Promise<never>(() => {}))
      const bounded = new TradingGit(makeConfig({ executeOperation, getGitState, writeTimeoutMs: WRITE_BOUND_MS }))
      bounded.add(buyOp())
      const { hash } = bounded.commit('Buy AAPL')

      const outcome = await withWatchdog(bounded.push(hash).then(() => null, (err: unknown) => err))

      expect(outcome).toBeInstanceOf(WriteOutcomeUnconfirmedError)
      const commit = bounded.show(hash)
      expect(commit).toBeDefined()
      expect(commit?.results[0]).toMatchObject({ success: false, status: 'unconfirmed' })
      // No earlier state existed, so the commit carries no snapshot key at all:
      // inventing one would claim an account picture that was never read.
      expect(commit?.stateAfterSource).toBe('unavailable')
      expect(commit && 'stateAfter' in commit).toBe(false)
      expect(bounded.status()).toMatchObject({ commitCount: 1, pendingHash: null })
    })

    it('reports the unconfirmed verdict, not the persistence failure, when onCommit throws', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      try {
        const executeOperation = vi.fn((_op: Operation, _signal?: AbortSignal) => new Promise<never>(() => {}))
        const onCommit = vi.fn(async () => { throw new Error('disk full') })
        const bounded = new TradingGit(makeConfig({ executeOperation, onCommit, writeTimeoutMs: WRITE_BOUND_MS }))
        bounded.add(buyOp())
        const { hash } = bounded.commit('Buy AAPL')

        const outcome = await withWatchdog(bounded.push(hash).then(() => null, (err: unknown) => err))

        expect(outcome).toBeInstanceOf(WriteOutcomeUnconfirmedError)
        expect((outcome as WriteOutcomeUnconfirmedError).hash).toBe(hash)
        // The record did NOT reach disk, and the caller is told so rather than
        // being handed "unconfirmed AND recorded".
        expect((outcome as WriteOutcomeUnconfirmedError).logPersisted).toBe(false)
        // The persistence failure is surfaced inside the verdict and logged
        // loudly — never swallowed, and never a substitute for the verdict.
        expect((outcome as WriteOutcomeUnconfirmedError).message).toContain('disk full')
        expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('disk full'))

        // The commit is in the log with the honest record.
        expect(bounded.show(hash)?.results[0]).toMatchObject({ success: false, status: 'unconfirmed' })
        expect(bounded.status().commitCount).toBe(1)
      } finally {
        errorSpy.mockRestore()
      }
    })

    it('clears the pending commit even when onCommit throws, so the write cannot be resubmitted', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      try {
        let attempts = 0
        const executeOperation = vi.fn((_op: Operation, _signal?: AbortSignal) => {
          attempts += 1
          return new Promise<never>(() => {})
        })
        const onCommit = vi.fn(async () => { throw new Error('disk full') })
        const bounded = new TradingGit(makeConfig({ executeOperation, onCommit, writeTimeoutMs: WRITE_BOUND_MS }))
        bounded.add(buyOp())
        const { hash } = bounded.commit('Buy AAPL')

        await withWatchdog(bounded.push(hash).catch(() => null))

        // Re-pushing the stale hash must not reach the broker a second time: the
        // pending commit is gone, so it is refused instead of resubmitting an
        // operation whose fate is unknown.
        const attemptsBefore = attempts
        await expect(bounded.push(hash)).rejects.toBeInstanceOf(PendingHashConflictError)
        expect(attempts).toBe(attemptsBefore)

        const status = bounded.status()
        expect(status.pendingHash).toBeNull()
        expect(status.pendingMessage).toBeNull()
        expect(status.staged).toHaveLength(0)
      } finally {
        errorSpy.mockRestore()
      }
    })

    it('refuses a retry of the old hash as a conflict after an unconfirmed timeout', async () => {
      let attempts = 0
      const executeOperation = vi.fn((_op: Operation, _signal?: AbortSignal) => {
        attempts += 1
        return new Promise<never>(() => {})
      })
      const bounded = new TradingGit(makeConfig({ executeOperation, writeTimeoutMs: WRITE_BOUND_MS }))
      bounded.add(buyOp())
      const { hash } = bounded.commit('Buy AAPL')

      const outcome = await withWatchdog(bounded.push(hash).then(() => null, (err: unknown) => err))
      expect(outcome).toBeInstanceOf(WriteOutcomeUnconfirmedError)
      // This commit WAS persisted (onCommit is the healthy mock), so the caller may
      // treat the record as durable.
      expect((outcome as WriteOutcomeUnconfirmedError).logPersisted).toBe(true)

      // The code clients read as "refresh, do not retry" — and the broker is not
      // called again, so an order of unknown fate cannot be doubled.
      const attemptsBefore = attempts
      await expect(bounded.push(hash)).rejects.toBeInstanceOf(PendingHashConflictError)
      expect(attempts).toBe(attemptsBefore)
    })

    it('records a transport failure as unconfirmed and stops the commit', async () => {
      // A real CCXT shape: CcxtBroker.placeOrder rethrows the venue client's error
      // unwrapped, and its own per-request timeout (10s) fires long before the
      // write bound — so THIS is the path a hung venue takes, not the timeout one.
      const executeOperation = vi.fn((_op: Operation, _signal?: AbortSignal) =>
        Promise.reject(Object.assign(
          new Error('mock-paper POST /order request timed out (10000 ms)'),
          { name: 'RequestTimeout' },
        )))
      const bounded = new TradingGit(makeConfig({
        executeOperation,
        classifyOperationError: classifyOperationFailure,
        writeTimeoutMs: WRITE_BOUND_MS,
      }))
      bounded.add(buyOp('AAPL'))
      bounded.add(buyOp('GOOG'))
      const { hash } = bounded.commit('Two buys')

      const outcome = await withWatchdog(bounded.push(hash).then(() => null, (err: unknown) => err))

      expect(outcome).toBeInstanceOf(WriteOutcomeUnconfirmedError)
      const commit = bounded.show(hash)
      // The timed-out request may have reached the matching engine: the log must
      // not claim it did not take effect.
      expect(commit?.results[0]).toMatchObject({ success: false, status: 'unconfirmed' })
      expect(commit?.results[0].error).toContain('reconcile against broker state')
      // The second operation was never dispatched and says so.
      expect(commit?.results[1]).toMatchObject({ success: false, status: 'rejected' })
      expect(commit?.results[1].error).toContain('Not executed')
      expect(executeOperation).toHaveBeenCalledTimes(1)
    })

    it('records a venue refusal as rejected with the same wired classifier', async () => {
      const executeOperation = vi.fn((_op: Operation, _signal?: AbortSignal) =>
        Promise.reject(Object.assign(new Error('insufficient funds'), { name: 'InsufficientFunds' })))
      const bounded = new TradingGit(makeConfig({
        executeOperation,
        classifyOperationError: classifyOperationFailure,
        writeTimeoutMs: WRITE_BOUND_MS,
      }))
      bounded.add(buyOp())
      const { hash } = bounded.commit('Buy AAPL')

      const result = await bounded.push(hash)

      expect(result.rejected).toHaveLength(1)
      expect(result.submitted).toHaveLength(0)
      expect(bounded.show(hash)?.results[0]).toMatchObject({ success: false, status: 'rejected' })
    })

    it('bounds the reject path too, so a hung snapshot cannot hold the lock', async () => {
      let dead = false
      const getGitState = vi.fn(() =>
        dead ? new Promise<never>(() => {}) : Promise.resolve(makeGitState()))
      const bounded = new TradingGit(makeConfig({ getGitState, writeTimeoutMs: WRITE_BOUND_MS }))

      bounded.add(buyOp())
      const { hash } = bounded.commit('Buy AAPL')
      dead = true

      // reject() takes the same wallet write lock, so its snapshot read must be
      // bounded like push()'s.
      await withWatchdog(bounded.reject('changed my mind', hash).then(() => null, (err: unknown) => err))

      dead = false
      bounded.add(buyOp('MSFT'))
      const second = bounded.commit('Buy MSFT')
      await expect(bounded.push(second.hash)).resolves.toMatchObject({ operationCount: 1 })

      const rejectedCommit = bounded.show(hash)
      expect(rejectedCommit?.stateAfterSource).toBe('unavailable')
      expect(bounded.status().commitCount).toBe(2)
    })

    it('does not invent a venue rejection for a log row with no verdict', () => {
      // Legacy/partial commit data: more operations recorded than results. The
      // listing must not turn a missing verdict into a definite venue rejection.
      const restored = TradingGit.restore({
        head: 'deadbeef',
        commits: [{
          hash: 'deadbeef',
          parentHash: null,
          message: 'legacy partial commit',
          operations: [buyOp('AAPL'), buyOp('GOOG')],
          results: [{ action: 'placeOrder', success: true, status: 'submitted', orderId: 'order-1' }],
          stateAfter: makeGitState(),
          timestamp: new Date().toISOString(),
        }],
      }, makeConfig())

      const rows = restored.log()[0].operations
      expect(rows[0].status).toBe('submitted')
      expect(rows[1].status).toBe('unconfirmed')
    })

    it('records an unreadable engine response as unconfirmed, never as a rejection', async () => {
      const executeOperation = vi.fn().mockResolvedValue('not a verdict')
      const bounded = new TradingGit(makeConfig({ executeOperation, writeTimeoutMs: WRITE_BOUND_MS }))
      bounded.add(buyOp())
      bounded.add(buyOp('GOOG'))
      const { hash } = bounded.commit('Two buys')

      await expect(bounded.push(hash)).rejects.toBeInstanceOf(WriteOutcomeUnconfirmedError)

      const commit = bounded.show(hash)
      expect(commit?.results[0]).toMatchObject({ success: false, status: 'unconfirmed' })
      expect(commit?.results[0].error).toContain('reconcile against broker state')
      // A non-verdict answer says nothing about the venue, so the write stops
      // rather than dispatching the next operation into an unknown state.
      expect(commit?.results[1].error).toContain('Not executed')
      expect(executeOperation).toHaveBeenCalledTimes(1)
    })

    it('records a timeout reported as a resolved refusal as unconfirmed (CCXT shape)', async () => {
      // CcxtBroker.placeOrder catches every venue error and RESOLVES it, so the
      // dominant path for a hung venue never throws at all.
      const executeOperation = vi.fn().mockResolvedValue({
        success: false,
        error: 'okx POST /order request timed out (10000 ms)',
      })
      const bounded = new TradingGit(makeConfig({
        executeOperation,
        classifyOperationError: classifyOperationFailure,
        writeTimeoutMs: WRITE_BOUND_MS,
      }))
      bounded.add(buyOp('AAPL'))
      bounded.add(buyOp('GOOG'))
      const { hash } = bounded.commit('Two buys')

      await expect(bounded.push(hash)).rejects.toBeInstanceOf(WriteOutcomeUnconfirmedError)

      const commit = bounded.show(hash)
      expect(commit?.results[0]).toMatchObject({ success: false, status: 'unconfirmed' })
      expect(commit?.results[1].error).toContain('Not executed')
      expect(executeOperation).toHaveBeenCalledTimes(1)
    })

    it('still records a reported refusal as rejected', async () => {
      // The same resolved shape carries real refusals; flipping those to
      // "unknown" would be its own lie. Guard messages are the canonical case.
      const executeOperation = vi.fn().mockResolvedValue({
        success: false,
        error: '[guard:max-position-size] would exceed 25% of equity',
      })
      const bounded = new TradingGit(makeConfig({
        executeOperation,
        classifyOperationError: classifyOperationFailure,
        writeTimeoutMs: WRITE_BOUND_MS,
      }))
      bounded.add(buyOp())
      const { hash } = bounded.commit('Buy AAPL')

      const result = await bounded.push(hash)

      expect(result.rejected).toHaveLength(1)
      expect(bounded.show(hash)?.results[0]).toMatchObject({ success: false, status: 'rejected' })
    })

    it('rehydrates an unconfirmed write and refuses the retry without dispatching again', async () => {
      let dispatches = 0
      const executeOperation = vi.fn((_op: Operation, _signal?: AbortSignal) => {
        dispatches += 1
        return Promise.reject(Object.assign(new Error('connect ETIMEDOUT'), { code: 'ETIMEDOUT' }))
      })
      const config = () => makeConfig({
        executeOperation,
        classifyOperationError: classifyOperationFailure,
        writeTimeoutMs: WRITE_BOUND_MS,
      })
      const bounded = new TradingGit(config())
      bounded.add(buyOp())
      const { hash } = bounded.commit('Buy AAPL')

      const outcome = await withWatchdog(bounded.push(hash).then(() => null, (err: unknown) => err))
      expect(outcome).toBeInstanceOf(WriteOutcomeUnconfirmedError)
      expect(dispatches).toBe(1)

      // Rehydrate the PERSISTED log: the pending triple is never persisted, so a
      // restarted process has the unconfirmed commit and no pending commit.
      const rehydrated = TradingGit.restore(bounded.exportState(), config())
      expect(rehydrated.status()).toMatchObject({ pendingHash: null, pendingMessage: null, commitCount: 1 })
      expect(rehydrated.show(hash)?.results[0]).toMatchObject({ success: false, status: 'unconfirmed' })

      // The retry is refused and never reaches the broker: nothing between a
      // client retry and a resubmit except what this checker consults.
      await expect(rehydrated.push(hash)).rejects.toBeInstanceOf(PendingHashConflictError)
      expect(dispatches).toBe(1)
      expect(rehydrated.status().staged).toHaveLength(0)
    })

    it('reports logPersisted:false exactly when the record did not reach disk', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      try {
        const persisted: GitExportState[] = []
        let failing = false
        const onCommit = vi.fn(async (state: GitExportState) => {
          if (failing) throw new Error('disk full')
          persisted.push(JSON.parse(JSON.stringify(state)) as GitExportState)
        })
        let healthy = true
        let dispatches = 0
        const executeOperation = vi.fn((_op: Operation, _signal?: AbortSignal) => {
          dispatches += 1
          return healthy ? Promise.resolve({ success: true, orderId: 'order-1' }) : new Promise<never>(() => {})
        })
        const bounded = new TradingGit(makeConfig({ executeOperation, onCommit, writeTimeoutMs: WRITE_BOUND_MS }))

        // First write records normally, so one commit really is on disk.
        bounded.add(buyOp('AAPL'))
        const firstHash = bounded.commit('Buy AAPL').hash
        await expect(bounded.push(firstHash)).resolves.toMatchObject({ operationCount: 1 })
        expect(persisted).toHaveLength(1)

        healthy = false
        failing = true
        bounded.add(buyOp('GOOG'))
        const { hash } = bounded.commit('Buy GOOG')
        const outcome = await withWatchdog(bounded.push(hash).then(() => null, (err: unknown) => err))

        expect(outcome).toBeInstanceOf(WriteOutcomeUnconfirmedError)
        expect((outcome as WriteOutcomeUnconfirmedError).logPersisted).toBe(false)
        // …and that is the truth: the last thing actually written out does not
        // contain this commit, while the in-memory log does.
        expect(persisted).toHaveLength(1)
        expect(persisted[0].commits.map((c) => c.hash)).not.toContain(hash)
        expect(bounded.show(hash)).not.toBeNull()
      } finally {
        errorSpy.mockRestore()
      }
    })

    it('keeps a carried-forward snapshot marked through a restore and never promotes it', async () => {
      const staleState = makeGitState({ netLiquidation: '777777' })
      const liveState = makeGitState({ netLiquidation: '888888' })
      const persisted: GitExportState = {
        head: 'aaaa1111',
        commits: [
          {
            hash: 'aaaa1111', parentHash: null, message: 'unconfirmed write',
            operations: [buyOp('AAPL')],
            results: [{ action: 'placeOrder', success: false, status: 'unconfirmed', error: 'no answer' }],
            stateAfter: staleState, stateAfterSource: 'last-known',
            timestamp: new Date().toISOString(),
          },
          {
            hash: 'bbbb2222', parentHash: 'aaaa1111', message: 'first write, no snapshot',
            operations: [buyOp('GOOG')],
            results: [{ action: 'placeOrder', success: false, status: 'unconfirmed', error: 'no answer' }],
            stateAfterSource: 'unavailable',
            timestamp: new Date().toISOString(),
          },
        ],
      }
      const getGitState = vi.fn(async () => liveState)
      const bounded = TradingGit.restore(persisted, makeConfig({ getGitState, writeTimeoutMs: WRITE_BOUND_MS }))

      // The marker survives rehydration for both shapes, and an absent snapshot
      // stays absent — rehydration must not invent one.
      const carried = bounded.show('aaaa1111')
      expect(carried?.stateAfterSource).toBe('last-known')
      expect(carried?.stateAfter).toEqual(staleState)
      const noSnapshot = bounded.show('bbbb2222')
      expect(noSnapshot?.stateAfterSource).toBe('unavailable')
      expect(noSnapshot && 'stateAfter' in noSnapshot).toBe(false)

      // Live state still comes from the broker: the next write records a FRESH
      // snapshot with no marker, not the restored carried-forward state.
      bounded.add(buyOp('MSFT'))
      const { hash } = bounded.commit('Buy MSFT')
      await expect(bounded.push(hash)).resolves.toMatchObject({ operationCount: 1 })

      const fresh = bounded.show(hash)
      expect(getGitState).toHaveBeenCalled()
      expect(fresh?.stateAfter).toEqual(liveState)
      expect(fresh?.stateAfterSource).toBeUndefined()
    })

    it.each([
      ['ETIMEDOUT', Object.assign(new Error('connect ETIMEDOUT'), { code: 'ETIMEDOUT' })],
      ['ECONNRESET', Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' })],
    ])('records a settled %s transport rejection as unconfirmed and blocks the retry', async (_label, transportError) => {
      let dispatches = 0
      const executeOperation = vi.fn((_op: Operation, _signal?: AbortSignal) => {
        dispatches += 1
        // A promise that SETTLES with a transport error on the first call — not a
        // hanging stub — then succeeds so the follow-up write can prove the lock
        // is free (a client timeout firing dead is exactly this shape).
        return dispatches === 1
          ? Promise.reject(transportError)
          : Promise.resolve({ success: true, orderId: 'order-2' })
      })
      const bounded = new TradingGit(makeConfig({
        executeOperation,
        classifyOperationError: classifyOperationFailure,
        writeTimeoutMs: WRITE_BOUND_MS,
      }))
      bounded.add(buyOp())
      const { hash } = bounded.commit('Buy AAPL')

      const outcome = await withWatchdog(bounded.push(hash).then(() => null, (err: unknown) => err))

      expect(outcome).toBeInstanceOf(WriteOutcomeUnconfirmedError)
      expect(bounded.show(hash)?.results[0]).toMatchObject({ success: false, status: 'unconfirmed' })

      // The lock is gone, and the retry cannot dispatch again.
      bounded.add(buyOp('MSFT'))
      const second = bounded.commit('Buy MSFT')
      await expect(bounded.push(second.hash)).resolves.toMatchObject({ operationCount: 1 })
      expect(dispatches).toBe(2)

      await expect(bounded.push(hash)).rejects.toBeInstanceOf(PendingHashConflictError)
      expect(dispatches).toBe(2)
    })
  })
})
