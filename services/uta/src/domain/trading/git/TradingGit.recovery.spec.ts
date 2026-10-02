import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Decimal from 'decimal.js'
import { Contract, Order } from '@traderalice/ibkr'
import { TradingGit } from './TradingGit.js'
import type { TradingGitConfig } from './interfaces.js'
import type { GitState, GitPendingState } from './types.js'
import { createGitPersister, createPendingPersister, loadGitState, loadPendingState } from '../git-persistence.js'

const home = vi.hoisted(() => ({ root: '' }))
vi.mock('@/core/paths.js', async () => {
  const { join } = await import('node:path')
  return { dataPath: (...parts: string[]) => join(home.root, ...parts) }
})
const state: GitState = { netLiquidation: '1000', totalCashValue: '900', unrealizedPnL: '0', realizedPnL: '0', positions: [], pendingOrders: [] }
beforeEach(async () => { home.root = await mkdtemp(join(tmpdir(), 'wallet-recovery-')) })
afterEach(async () => { await rm(home.root, { recursive: true, force: true }) })
function config(overrides: Partial<TradingGitConfig> = {}): TradingGitConfig {
  return {
    executeOperation: vi.fn().mockResolvedValue({ success: true, orderId: 'accepted', orderState: { status: 'Submitted' } }),
    getGitState: vi.fn().mockResolvedValue(state),
    onCommit: createGitPersister('paper'),
    onPendingChange: createPendingPersister('paper'),
    ...overrides,
  }
}
function stage(git: TradingGit) {
  const contract = Object.assign(new Contract(), { symbol: 'AAPL', localSymbol: 'AAPL', aliceId: 'paper|AAPL', secType: 'STK', exchange: 'MOCK', currency: 'USD' })
  const order = Object.assign(new Order(), { action: 'BUY', orderType: 'LMT', totalQuantity: new Decimal('0.123456789'), lmtPrice: new Decimal('100.1') })
  git.add({ action: 'placeOrder', contract, order })
}
async function restart(overrides: Partial<TradingGitConfig> = {}) {
  const savedState = await loadGitState('paper')
  const cfg = config({ ...overrides, savedPending: await loadPendingState('paper') })
  return savedState ? TradingGit.restore(savedState, cfg) : new TradingGit(cfg)
}

describe('wallet pending file and execution checkpoints', () => {
  it('restores an unchanged approval hash and exact order terms, then pushes once', async () => {
    const git = new TradingGit(config())
    stage(git)
    const { hash } = git.commit('awaiting human approval')
    const executeOperation = vi.fn().mockResolvedValue({ success: true, orderId: 'accepted' })
    const restored = await restart({ executeOperation })
    expect(restored.status().pendingHash).toBe(hash)
    expect(restored.status().pendingMessage).toBe('awaiting human approval')
    await restored.push(hash)
    expect(executeOperation).toHaveBeenCalledOnce()
    expect(executeOperation.mock.calls[0][0].order.totalQuantity.equals('0.123456789')).toBe(true)
    expect((await restart()).status().pendingHash).toBeNull()
  })

  it('retains accepted order IDs before a later rejection and failed snapshot (#1680)', async () => {
    const cfg = config({
      executeOperation: vi.fn()
        .mockResolvedValueOnce({ success: true, orderId: 'stop', orderState: { status: 'Submitted' }, legs: [{ orderId: 'child', role: 'stopLoss' }] })
        .mockRejectedValueOnce(new Error('write-path liveness check failed')),
      getGitState: vi.fn().mockRejectedValue(new Error('account offline')),
    })
    const git = new TradingGit(cfg)
    stage(git); stage(git)
    const { hash } = git.commit('protective pair')
    await expect(git.push(hash)).rejects.toThrow('offline')
    const executeOperation = vi.fn()
    const restored = await restart({ executeOperation })
    expect(restored.status().execution?.results.map(r => r.orderId)).toEqual(['stop', undefined])
    expect(restored.getKnownOrderIds()).toEqual(new Set(['stop', 'child']))
    expect(restored.getPendingOrderIds().map(r => r.orderId)).toEqual(['stop', 'child'])
    const result = await restored.push(hash)
    expect(executeOperation).not.toHaveBeenCalled()
    expect(result.submitted[0].orderId).toBe('stop')
    expect((await restart()).show(hash)?.results).toHaveLength(2)
  })

  it('blocks replay or rejection after a crash during the second broker call', async () => {
    let entered!: () => void
    const started = new Promise<void>(resolve => { entered = resolve })
    const executeOperation = vi.fn().mockResolvedValueOnce({ success: true, orderId: 'first', orderState: { status: 'Submitted' } })
      .mockImplementationOnce(() => { entered(); return new Promise(() => {}) })
    const git = new TradingGit(config({ executeOperation }))
    stage(git); stage(git)
    const { hash } = git.commit('two writes')
    void git.push(hash)
    await started
    const replay = vi.fn()
    const restored = await restart({ executeOperation: replay })
    expect(restored.status().execution?.activeIndex).toBe(1)
    expect(restored.getPendingOrderIds()[0].orderId).toBe('first')
    await expect(restored.push(hash)).rejects.toThrow('no recorded outcome')
    await expect(restored.reject('try again', hash)).rejects.toThrow('cannot erase')
    expect(() => restored.commit('new hash')).toThrow('Execution has started')
    expect(replay).not.toHaveBeenCalled()
  })

  it('does not dispatch unless the pre-call marker is saved', async () => {
    const save = createPendingPersister('paper')
    const executeOperation = vi.fn()
    const git = new TradingGit(config({ executeOperation, onPendingChange: pending => {
      if (pending?.execution) throw new Error('disk full')
      save(pending)
    } }))
    stage(git)
    const { hash } = git.commit('prepared')
    await expect(git.push(hash)).rejects.toThrow('disk full')
    expect(executeOperation).not.toHaveBeenCalled()
  })

  it('stops before the next write when saving an outcome fails', async () => {
    const save = createPendingPersister('paper')
    const executeOperation = vi.fn().mockResolvedValue({ success: true, orderId: 'accepted' })
    const git = new TradingGit(config({ executeOperation, onPendingChange: pending => {
      if (pending?.execution?.results.length) throw new Error('disk full')
      save(pending)
    } }))
    stage(git); stage(git)
    const { hash } = git.commit('two writes')
    await expect(git.push(hash)).rejects.toThrow('disk full')
    expect(executeOperation).toHaveBeenCalledOnce()
    expect((await restart()).status().execution?.activeIndex).toBe(0)
  })

  it('does not resume undispatched operations after an interruption between calls', async () => {
    const save = createPendingPersister('paper')
    const git = new TradingGit(config({ onPendingChange: pending => {
      save(pending)
      if (pending?.execution?.results.length === 1) throw new Error('interrupted after durable result')
    } }))
    stage(git); stage(git)
    const { hash } = git.commit('two writes')
    await expect(git.push(hash)).rejects.toThrow('interrupted')
    const executeOperation = vi.fn()
    const restored = await restart({ executeOperation })
    const result = await restored.push(hash)
    expect(executeOperation).not.toHaveBeenCalled()
    expect(result.submitted).toHaveLength(1)
    expect(result.rejected[0].error).toContain('Not executed')
  })

  it('retries final ledger persistence without executing or duplicating the commit', async () => {
    const persist = createGitPersister('paper')
    const onCommit = vi.fn().mockRejectedValueOnce(new Error('disk full')).mockImplementation(persist)
    const cfg = config({ onCommit })
    const git = new TradingGit(cfg)
    stage(git)
    const { hash } = git.commit('one write')
    await expect(git.push(hash)).rejects.toThrow('disk full')
    await git.push(hash)
    expect(cfg.executeOperation).toHaveBeenCalledOnce()
    expect((await loadGitState('paper'))?.commits).toHaveLength(1)
    expect(await loadPendingState('paper')).toBeUndefined()
  })

  it('uses the committed hash to discard a stale pending file after cleanup failure', async () => {
    const save = createPendingPersister('paper')
    const git = new TradingGit(config({ onPendingChange: pending => {
      if (pending === null) throw new Error('cleanup failed')
      save(pending)
    } }))
    stage(git)
    const { hash } = git.commit('one write')
    await expect(git.push(hash)).rejects.toThrow('cleanup failed')
    const restored = await restart()
    expect(restored.show(hash)).not.toBeNull()
    expect(restored.status().pendingHash).toBeNull()
    expect(await loadPendingState('paper')).toBeUndefined()
  })

  it('records recovered outcomes before a later terminal sync so orders do not reopen', async () => {
    const git = new TradingGit(config({ getGitState: vi.fn().mockRejectedValue(new Error('offline')) }))
    stage(git)
    const { hash } = git.commit('one write')
    await expect(git.push(hash)).rejects.toThrow()
    const restored = await restart()
    await restored.sync([{ orderId: 'accepted', symbol: 'AAPL', previousStatus: 'submitted', currentStatus: 'filled', filledQty: '0.123456789', filledPrice: '100.1' }], state)
    expect(restored.status().pendingHash).toBeNull()
    expect(restored.getPendingOrderIds()).toEqual([])
    expect((await restart()).getPendingOrderIds()).toEqual([])
  })

  it('never executes a rejected approval when its final ledger save failed', async () => {
    const cfg = config({ onCommit: vi.fn().mockRejectedValueOnce(new Error('disk full')).mockImplementation(createGitPersister('paper')) })
    const git = new TradingGit(cfg)
    stage(git)
    const { hash } = git.commit('reject me')
    await expect(git.reject('no', hash)).rejects.toThrow('disk full')
    const result = await git.push(hash)
    expect(result.submitted).toEqual([])
    expect(result.rejected[0].status).toBe('user-rejected')
    expect(cfg.executeOperation).not.toHaveBeenCalled()
  })

  it('does not restore a rejected approval', async () => {
    const git = new TradingGit(config())
    stage(git)
    const { hash } = git.commit('reject me')
    await git.reject('no', hash)
    expect((await restart()).status().pendingHash).toBeNull()
  })

  it('refuses corrupt ledger or checkpoint data instead of starting a fresh wallet', async () => {
    const git = new TradingGit(config())
    stage(git); git.commit('pending')
    const path = join(home.root, 'trading', 'paper', 'pending.json')
    const pending = JSON.parse(await readFile(path, 'utf8')) as GitPendingState
    pending.execution = { parentHash: null, results: [], activeIndex: 99 }
    await writeFile(path, JSON.stringify(pending))
    await expect(restart()).rejects.toThrow('Invalid saved wallet execution')
    await writeFile(join(home.root, 'trading', 'paper', 'commit.json'), '{broken')
    await expect(restart()).rejects.toThrow()
  })
})
