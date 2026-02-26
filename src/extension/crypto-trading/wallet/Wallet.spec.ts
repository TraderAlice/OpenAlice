import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Wallet } from './Wallet.js';
import type { WalletConfig } from './interfaces.js';
import type { Operation, WalletState } from './types.js';

// ==================== Mock Factory ====================

function createMockConfig(overrides: Partial<WalletConfig> = {}): WalletConfig {
  return {
    executeOperation: vi.fn().mockResolvedValue({
      success: true,
      order: { id: 'ord-001', status: 'filled', filledPrice: 95000, filledQuantity: 0.1 },
    }),
    getWalletState: vi.fn().mockResolvedValue({
      balance: 10000, equity: 10000, unrealizedPnL: 0,
      realizedPnL: 0, positions: [], pendingOrders: [],
    } satisfies WalletState),
    onCommit: vi.fn(),
    ...overrides,
  };
}

function makeOp(overrides: Partial<Operation> = {}): Operation {
  return {
    action: 'placeOrder',
    params: { symbol: 'BTC/USD', side: 'buy', type: 'market', size: 0.1 },
    ...overrides,
  };
}

// ==================== Tests ====================

describe('Wallet', () => {
  let config: WalletConfig;
  let wallet: Wallet;

  beforeEach(() => {
    config = createMockConfig();
    wallet = new Wallet(config);
  });

  // ==================== add ====================

  describe('add', () => {
    it('stages an operation and returns AddResult', () => {
      const op = makeOp();
      const result = wallet.add(op);

      expect(result).toEqual({ staged: true, index: 0, operation: op });
    });

    it('increments index for each subsequent add', () => {
      const r1 = wallet.add(makeOp());
      const r2 = wallet.add(makeOp({ params: { symbol: 'ETH/USD', side: 'sell', type: 'market', size: 1 } }));

      expect(r1.index).toBe(0);
      expect(r2.index).toBe(1);
    });
  });

  // ==================== commit ====================

  describe('commit', () => {
    it('prepares a commit with hash and message', () => {
      wallet.add(makeOp());
      const result = wallet.commit('Buy BTC');

      expect(result.prepared).toBe(true);
      expect(result.hash).toHaveLength(8);
      expect(result.message).toBe('Buy BTC');
      expect(result.operationCount).toBe(1);
    });

    it('throws when staging area is empty', () => {
      expect(() => wallet.commit('empty')).toThrow('Nothing to commit: staging area is empty');
    });
  });

  // ==================== push ====================

  describe('push', () => {
    it('executes staged operations via config.executeOperation', async () => {
      const op = makeOp();
      wallet.add(op);
      wallet.commit('test');
      await wallet.push();

      expect(config.executeOperation).toHaveBeenCalledWith(op);
    });

    it('calls getWalletState after execution', async () => {
      wallet.add(makeOp());
      wallet.commit('test');
      await wallet.push();

      expect(config.getWalletState).toHaveBeenCalled();
    });

    it('records commit and updates head', async () => {
      wallet.add(makeOp());
      const { hash } = wallet.commit('test');
      await wallet.push();

      const status = wallet.status();
      expect(status.head).toBe(hash);
      expect(status.commitCount).toBe(1);
    });

    it('clears staging area after push', async () => {
      wallet.add(makeOp());
      wallet.commit('test');
      await wallet.push();

      const status = wallet.status();
      expect(status.staged).toEqual([]);
      expect(status.pendingMessage).toBeNull();
    });

    it('categorizes results into filled, pending, rejected', async () => {
      const execResults = [
        { success: true, order: { id: 'o1', status: 'filled', filledPrice: 95000, filledQuantity: 0.1 } },
        { success: true, order: { id: 'o2', status: 'pending' } },
        { success: false, error: 'Insufficient funds' },
      ];
      let callIdx = 0;
      config = createMockConfig({
        executeOperation: vi.fn().mockImplementation(() => Promise.resolve(execResults[callIdx++])),
      });
      wallet = new Wallet(config);

      wallet.add(makeOp());
      wallet.add(makeOp({ params: { symbol: 'BTC/USD', side: 'buy', type: 'limit', price: 90000, size: 0.1 } }));
      wallet.add(makeOp({ params: { symbol: 'ETH/USD', side: 'buy', type: 'market', size: 100 } }));
      wallet.commit('batch');
      const result = await wallet.push();

      expect(result.filled).toHaveLength(1);
      expect(result.pending).toHaveLength(1);
      expect(result.rejected).toHaveLength(1);
    });

    it('calls onCommit with exported state', async () => {
      wallet.add(makeOp());
      wallet.commit('test');
      await wallet.push();

      expect(config.onCommit).toHaveBeenCalledWith(
        expect.objectContaining({
          commits: expect.any(Array),
          head: expect.any(String),
        }),
      );
    });

    it('throws when staging area is empty', async () => {
      await expect(wallet.push()).rejects.toThrow('Nothing to push: staging area is empty');
    });

    it('throws when commit was not called first', async () => {
      wallet.add(makeOp());
      await expect(wallet.push()).rejects.toThrow('Nothing to push: please commit first');
    });

    it('handles executeOperation throwing an error', async () => {
      config = createMockConfig({
        executeOperation: vi.fn().mockRejectedValue(new Error('Network timeout')),
      });
      wallet = new Wallet(config);

      wallet.add(makeOp());
      wallet.commit('failing');
      const result = await wallet.push();

      expect(result.rejected).toHaveLength(1);
      expect(result.rejected[0].error).toBe('Network timeout');
      expect(result.rejected[0].status).toBe('rejected');
    });
  });

  // ==================== full cycle ====================

  describe('add -> commit -> push cycle', () => {
    it('full happy path', async () => {
      wallet.add(makeOp());
      wallet.commit('Buy 0.1 BTC');
      const result = await wallet.push();

      expect(result.operationCount).toBe(1);
      expect(result.filled).toHaveLength(1);
      expect(result.filled[0].orderId).toBe('ord-001');
      expect(result.filled[0].filledPrice).toBe(95000);
    });

    it('multiple operations in single push', async () => {
      wallet.add(makeOp());
      wallet.add(makeOp({ action: 'adjustLeverage', params: { symbol: 'BTC/USD', newLeverage: 10 } }));
      wallet.commit('batch operations');
      const result = await wallet.push();

      expect(result.operationCount).toBe(2);
      expect(config.executeOperation).toHaveBeenCalledTimes(2);
    });

    it('sequential pushes create chained commits', async () => {
      wallet.add(makeOp());
      wallet.commit('first');
      const r1 = await wallet.push();

      wallet.add(makeOp({ params: { symbol: 'ETH/USD', side: 'buy', type: 'market', size: 1 } }));
      wallet.commit('second');
      const r2 = await wallet.push();

      const c2 = wallet.show(r2.hash);
      expect(c2?.parentHash).toBe(r1.hash);
      expect(wallet.status().commitCount).toBe(2);
    });
  });

  // ==================== log ====================

  describe('log', () => {
    it('returns commits in reverse chronological order', async () => {
      wallet.add(makeOp());
      wallet.commit('first');
      await wallet.push();

      wallet.add(makeOp());
      wallet.commit('second');
      await wallet.push();

      const entries = wallet.log();
      expect(entries).toHaveLength(2);
      expect(entries[0].message).toBe('second');
      expect(entries[1].message).toBe('first');
    });

    it('respects limit parameter', async () => {
      for (let i = 0; i < 5; i++) {
        wallet.add(makeOp());
        wallet.commit(`commit ${i}`);
        await wallet.push();
      }

      expect(wallet.log({ limit: 3 })).toHaveLength(3);
    });

    it('filters by symbol', async () => {
      wallet.add(makeOp({ params: { symbol: 'BTC/USD', side: 'buy', type: 'market', size: 0.1 } }));
      wallet.commit('btc buy');
      await wallet.push();

      wallet.add(makeOp({ params: { symbol: 'ETH/USD', side: 'buy', type: 'market', size: 1 } }));
      wallet.commit('eth buy');
      await wallet.push();

      const entries = wallet.log({ symbol: 'ETH/USD' });
      expect(entries).toHaveLength(1);
      expect(entries[0].message).toBe('eth buy');
    });

    it('returns empty array when no commits', () => {
      expect(wallet.log()).toEqual([]);
    });
  });

  // ==================== show ====================

  describe('show', () => {
    it('returns commit by hash', async () => {
      wallet.add(makeOp());
      const { hash } = wallet.commit('test');
      await wallet.push();

      const commit = wallet.show(hash);
      expect(commit).not.toBeNull();
      expect(commit!.message).toBe('test');
    });

    it('returns null for unknown hash', () => {
      expect(wallet.show('deadbeef')).toBeNull();
    });
  });

  // ==================== status ====================

  describe('status', () => {
    it('shows initial empty state', () => {
      const s = wallet.status();
      expect(s.staged).toEqual([]);
      expect(s.pendingMessage).toBeNull();
      expect(s.head).toBeNull();
      expect(s.commitCount).toBe(0);
    });

    it('shows staged operations', () => {
      const op = makeOp();
      wallet.add(op);

      const s = wallet.status();
      expect(s.staged).toHaveLength(1);
      expect(s.staged[0]).toEqual(op);
    });

    it('shows pendingMessage after commit', () => {
      wallet.add(makeOp());
      wallet.commit('my message');

      expect(wallet.status().pendingMessage).toBe('my message');
    });
  });

  // ==================== sync ====================

  describe('sync', () => {
    it('creates a sync commit with order updates', async () => {
      const state: WalletState = {
        balance: 10000, equity: 10000, unrealizedPnL: 0,
        realizedPnL: 0, positions: [], pendingOrders: [],
      };

      const result = await wallet.sync(
        [{ orderId: 'ord-001', symbol: 'BTC/USD', previousStatus: 'pending', currentStatus: 'filled', filledPrice: 95000, filledSize: 0.1 }],
        state,
      );

      expect(result.updatedCount).toBe(1);
      expect(result.hash).toHaveLength(8);
      expect(wallet.status().head).toBe(result.hash);
      expect(config.onCommit).toHaveBeenCalled();
    });

    it('returns early when updates is empty', async () => {
      const state: WalletState = {
        balance: 10000, equity: 10000, unrealizedPnL: 0,
        realizedPnL: 0, positions: [], pendingOrders: [],
      };

      const result = await wallet.sync([], state);

      expect(result.updatedCount).toBe(0);
      expect(wallet.status().commitCount).toBe(0);
    });
  });

  // ==================== getPendingOrderIds ====================

  describe('getPendingOrderIds', () => {
    it('returns orders still in pending status', async () => {
      config = createMockConfig({
        executeOperation: vi.fn().mockResolvedValue({
          success: true,
          order: { id: 'ord-pending', status: 'pending' },
        }),
      });
      wallet = new Wallet(config);

      wallet.add(makeOp());
      wallet.commit('limit buy');
      await wallet.push();

      const pending = wallet.getPendingOrderIds();
      expect(pending).toEqual([{ orderId: 'ord-pending', symbol: 'BTC/USD' }]);
    });

    it('excludes orders updated to filled by sync', async () => {
      config = createMockConfig({
        executeOperation: vi.fn().mockResolvedValue({
          success: true,
          order: { id: 'ord-100', status: 'pending' },
        }),
      });
      wallet = new Wallet(config);

      wallet.add(makeOp());
      wallet.commit('limit buy');
      await wallet.push();

      // Sync fills the order
      const state: WalletState = {
        balance: 10000, equity: 10000, unrealizedPnL: 0,
        realizedPnL: 0, positions: [], pendingOrders: [],
      };
      await wallet.sync(
        [{ orderId: 'ord-100', symbol: 'BTC/USD', previousStatus: 'pending', currentStatus: 'filled', filledPrice: 95000, filledSize: 0.1 }],
        state,
      );

      expect(wallet.getPendingOrderIds()).toEqual([]);
    });

    it('returns empty array when no pending orders', async () => {
      wallet.add(makeOp());
      wallet.commit('market buy');
      await wallet.push();

      // Default mock returns filled status
      expect(wallet.getPendingOrderIds()).toEqual([]);
    });
  });

  // ==================== exportState / restore ====================

  describe('exportState / restore', () => {
    it('round-trips through export and restore', async () => {
      wallet.add(makeOp());
      wallet.commit('original');
      await wallet.push();

      const exported = wallet.exportState();
      const restored = Wallet.restore(exported, config);

      expect(restored.status().head).toBe(wallet.status().head);
      expect(restored.status().commitCount).toBe(1);
      expect(restored.log()).toHaveLength(1);
    });
  });

  // ==================== setCurrentRound ====================

  describe('setCurrentRound', () => {
    it('records round number in commits', async () => {
      wallet.setCurrentRound(3);
      wallet.add(makeOp());
      wallet.commit('round 3 buy');
      const result = await wallet.push();

      const commit = wallet.show(result.hash);
      expect(commit?.round).toBe(3);
    });
  });

  // ==================== simulatePriceChange ====================

  describe('simulatePriceChange', () => {
    it('returns no-change result when no positions', async () => {
      const result = await wallet.simulatePriceChange([
        { symbol: 'BTC/USD', change: '+10%' },
      ]);

      expect(result.success).toBe(true);
      expect(result.summary.totalPnLChange).toBe(0);
      expect(result.summary.worstCase).toBe('No positions to simulate.');
    });

    it('calculates PnL for long position with relative change', async () => {
      config = createMockConfig({
        getWalletState: vi.fn().mockResolvedValue({
          balance: 10000, equity: 10500, unrealizedPnL: 500,
          realizedPnL: 0,
          positions: [{
            symbol: 'BTC/USD', side: 'long', size: 0.1, entryPrice: 90000,
            leverage: 1, margin: 9000, liquidationPrice: 0,
            markPrice: 95000, unrealizedPnL: 500, positionValue: 9500,
          }],
          pendingOrders: [],
        } satisfies WalletState),
      });
      wallet = new Wallet(config);

      const result = await wallet.simulatePriceChange([
        { symbol: 'BTC/USD', change: '+10%' },
      ]);

      expect(result.success).toBe(true);
      // New price: 95000 * 1.1 = 104500
      // New PnL: (104500 - 90000) * 0.1 = 1450
      expect(result.simulatedState.positions[0].simulatedPrice).toBeCloseTo(104500);
      expect(result.simulatedState.positions[0].unrealizedPnL).toBeCloseTo(1450);
      expect(result.summary.totalPnLChange).toBeCloseTo(950); // 1450 - 500
    });

    it('calculates PnL for absolute price change', async () => {
      config = createMockConfig({
        getWalletState: vi.fn().mockResolvedValue({
          balance: 10000, equity: 10500, unrealizedPnL: 500,
          realizedPnL: 0,
          positions: [{
            symbol: 'BTC/USD', side: 'long', size: 0.1, entryPrice: 90000,
            leverage: 1, margin: 9000, liquidationPrice: 0,
            markPrice: 95000, unrealizedPnL: 500, positionValue: 9500,
          }],
          pendingOrders: [],
        } satisfies WalletState),
      });
      wallet = new Wallet(config);

      const result = await wallet.simulatePriceChange([
        { symbol: 'BTC/USD', change: '@100000' },
      ]);

      expect(result.success).toBe(true);
      expect(result.simulatedState.positions[0].simulatedPrice).toBe(100000);
      // New PnL: (100000 - 90000) * 0.1 = 1000
      expect(result.simulatedState.positions[0].unrealizedPnL).toBeCloseTo(1000);
    });

    it('returns error for invalid change format', async () => {
      config = createMockConfig({
        getWalletState: vi.fn().mockResolvedValue({
          balance: 10000, equity: 10000, unrealizedPnL: 0, realizedPnL: 0,
          positions: [{
            symbol: 'BTC/USD', side: 'long', size: 0.1, entryPrice: 90000,
            leverage: 1, margin: 9000, liquidationPrice: 0,
            markPrice: 95000, unrealizedPnL: 500, positionValue: 9500,
          }],
          pendingOrders: [],
        } satisfies WalletState),
      });
      wallet = new Wallet(config);

      const result = await wallet.simulatePriceChange([
        { symbol: 'BTC/USD', change: 'invalid' },
      ]);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid change format');
    });
  });
});
