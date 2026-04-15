import { describe, it, expect, vi, beforeEach } from 'vitest'
import Decimal from 'decimal.js'
import { Contract, Order, OrderState } from '@traderalice/ibkr'
import { TradingGit } from './TradingGit.js'
import type { TradingGitConfig } from './interfaces.js'
import type { Operation, GitState } from './types.js'
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
      const result = await git.push()

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
      await git.push()

      expect(config.executeOperation).toHaveBeenCalledTimes(2)
    })

    it('calls getGitState after execution', async () => {
      git.add(buyOp())
      git.commit('msg')
      await git.push()

      expect(config.getGitState).toHaveBeenCalled()
    })

    it('clears staging area after push', async () => {
      git.add(buyOp())
      git.commit('msg')
      await git.push()

      const status = git.status()
      expect(status.staged).toHaveLength(0)
      expect(status.pendingMessage).toBeNull()
    })

    it('throws when staging area is empty', async () => {
      await expect(git.push()).rejects.toThrow('Nothing to push')
    })

    it('throws when not committed', async () => {
      git.add(buyOp())
      await expect(git.push()).rejects.toThrow('please commit first')
    })

    it('calls onCommit callback with exported state', async () => {
      const onCommit = vi.fn()
      const gitWithCb = new TradingGit({ ...config, onCommit })

      gitWithCb.add(buyOp())
      gitWithCb.commit('msg')
      await gitWithCb.push()

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
      const result = await gitFail.push()

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
      const result = await gitFail.push()

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
      const result = await gitPending.push()

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
      const result = await gitFilled.push()

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
      const result = await gitCancel.push()

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
      const result = await gitAsync.push()

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
      const result = await gitInactive.push()

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
      const result = await gitFail.push()

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
      await git.push()

      git.add(buyOp('GOOG'))
      git.commit('Second')
      await git.push()

      const entries = git.log()
      expect(entries).toHaveLength(2)
      expect(entries[0].message).toBe('Second')
      expect(entries[1].message).toBe('First')
    })

    it('filters by symbol', async () => {
      git.add(buyOp('AAPL'))
      git.commit('Buy AAPL')
      await git.push()

      git.add(buyOp('GOOG'))
      git.commit('Buy GOOG')
      await git.push()

      const entries = git.log({ symbol: 'AAPL' })
      expect(entries).toHaveLength(1)
      expect(entries[0].message).toBe('Buy AAPL')
    })

    it('respects limit', async () => {
      for (let i = 0; i < 5; i++) {
        git.add(buyOp('AAPL'))
        git.commit(`Commit ${i}`)
        await git.push()
      }

      const entries = git.log({ limit: 2 })
      expect(entries).toHaveLength(2)
    })

    it('includes operation summaries', async () => {
      git.add(buyOp('AAPL'))
      git.commit('Buy')
      await git.push()

      const entries = git.log()
      expect(entries[0].operations).toHaveLength(1)
      expect(entries[0].operations[0].symbol).toBe('AAPL')
      expect(entries[0].operations[0].action).toBe('placeOrder')
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
      await git.push()

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
      await git.push()

      const s = git.status()
      expect(s.head).toHaveLength(8)
      expect(s.commitCount).toBe(1)
    })
  })

  // ==================== exportState / restore ====================

  describe('exportState / restore', () => {
    it('round-trips state', async () => {
      git.add(buyOp('AAPL'))
      git.commit('Buy AAPL')
      await git.push()

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
  })

  // ==================== setCurrentRound ====================

  describe('setCurrentRound', () => {
    it('tags commits with the current round', async () => {
      git.setCurrentRound(42)
      git.add(buyOp())
      git.commit('msg')
      await git.push()

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
            filledPrice: 155,
            filledQty: 10,
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
      await gitP.push()

      const pending = gitP.getPendingOrderIds()
      expect(pending).toHaveLength(1)
      expect(pending[0]).toEqual({ orderId: 'lmt-1', symbol: 'AAPL' })
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
      await gitP.push()

      // Sync to filled
      await gitP.sync(
        [{
          orderId: 'lmt-1',
          symbol: 'AAPL',
          previousStatus: 'submitted',
          currentStatus: 'filled',
          filledPrice: 155,
          filledQty: 10,
        }],
        makeGitState(),
      )

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
      await gitP.push()

      // Filled at push time → should NOT appear as pending
      expect(gitP.getPendingOrderIds()).toHaveLength(0)
    })
  })

  // ==================== simulatePriceChange ====================

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
            marketValue: '1000', unrealizedPnL: '0', realizedPnL: '0',
          },
          {
            contract: makeContract({ symbol: 'GOOG' }),
            currency: 'USD', side: 'long', quantity: new Decimal(5), avgCost: '200', marketPrice: '200',
            marketValue: '1000', unrealizedPnL: '0', realizedPnL: '0',
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
            marketValue: '1000', unrealizedPnL: '0', realizedPnL: '0',
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
})
