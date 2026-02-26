import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SecWallet } from './SecWallet.js';
import type { SecWalletConfig } from './interfaces.js';
import type { Operation, WalletState } from './types.js';

// ==================== Mock Factory ====================

function createMockConfig(overrides: Partial<SecWalletConfig> = {}): SecWalletConfig {
  return {
    executeOperation: vi.fn().mockResolvedValue({
      success: true,
      order: { id: 'sec-001', status: 'filled', filledPrice: 150.25, filledQty: 10 },
    }),
    getWalletState: vi.fn().mockResolvedValue({
      cash: 50000, equity: 50000, portfolioValue: 0,
      unrealizedPnL: 0, realizedPnL: 0, holdings: [], pendingOrders: [],
    } satisfies WalletState),
    onCommit: vi.fn(),
    ...overrides,
  };
}

function makeOp(overrides: Partial<Operation> = {}): Operation {
  return {
    action: 'placeOrder',
    params: { symbol: 'AAPL', side: 'buy', type: 'market', qty: 10 },
    ...overrides,
  };
}

// ==================== Tests ====================

describe('SecWallet', () => {
  let config: SecWalletConfig;
  let wallet: SecWallet;

  beforeEach(() => {
    config = createMockConfig();
    wallet = new SecWallet(config);
  });

  // ==================== add ====================

  describe('add', () => {
    it('stages an operation and returns AddResult', () => {
      const op = makeOp();
      const result = wallet.add(op);

      expect(result).toEqual({ staged: true, index: 0, operation: op });
    });

    it('increments index for each subsequent add', () => {
      expect(wallet.add(makeOp()).index).toBe(0);
      expect(wallet.add(makeOp()).index).toBe(1);
    });
  });

  // ==================== commit ====================

  describe('commit', () => {
    it('prepares a commit with hash and message', () => {
      wallet.add(makeOp());
      const result = wallet.commit('Buy AAPL');

      expect(result.prepared).toBe(true);
      expect(result.hash).toHaveLength(8);
      expect(result.message).toBe('Buy AAPL');
      expect(result.operationCount).toBe(1);
    });

    it('throws when staging area is empty', () => {
      expect(() => wallet.commit('empty')).toThrow('Nothing to commit: staging area is empty');
    });
  });

  // ==================== push ====================

  describe('push', () => {
    it('executes staged operations', async () => {
      const op = makeOp();
      wallet.add(op);
      wallet.commit('test');
      await wallet.push();

      expect(config.executeOperation).toHaveBeenCalledWith(op);
    });

    it('records commit and updates head', async () => {
      wallet.add(makeOp());
      const { hash } = wallet.commit('test');
      await wallet.push();

      expect(wallet.status().head).toBe(hash);
      expect(wallet.status().commitCount).toBe(1);
    });

    it('clears staging after push', async () => {
      wallet.add(makeOp());
      wallet.commit('test');
      await wallet.push();

      const s = wallet.status();
      expect(s.staged).toEqual([]);
      expect(s.pendingMessage).toBeNull();
    });

    it('categorizes results into filled, pending, rejected', async () => {
      const execResults = [
        { success: true, order: { id: 's1', status: 'filled', filledPrice: 150, filledQty: 10 } },
        { success: true, order: { id: 's2', status: 'pending' } },
        { success: false, error: 'Rejected by broker' },
      ];
      let idx = 0;
      config = createMockConfig({
        executeOperation: vi.fn().mockImplementation(() => Promise.resolve(execResults[idx++])),
      });
      wallet = new SecWallet(config);

      wallet.add(makeOp());
      wallet.add(makeOp({ params: { symbol: 'AAPL', side: 'buy', type: 'limit', qty: 10, price: 140 } }));
      wallet.add(makeOp({ params: { symbol: 'MSFT', side: 'buy', type: 'market', qty: 99999 } }));
      wallet.commit('batch');
      const result = await wallet.push();

      expect(result.filled).toHaveLength(1);
      expect(result.pending).toHaveLength(1);
      expect(result.rejected).toHaveLength(1);
    });

    it('handles executeOperation errors gracefully', async () => {
      config = createMockConfig({
        executeOperation: vi.fn().mockRejectedValue(new Error('Connection lost')),
      });
      wallet = new SecWallet(config);

      wallet.add(makeOp());
      wallet.commit('failing');
      const result = await wallet.push();

      expect(result.rejected).toHaveLength(1);
      expect(result.rejected[0].error).toBe('Connection lost');
    });

    it('throws on empty staging', async () => {
      await expect(wallet.push()).rejects.toThrow('Nothing to push: staging area is empty');
    });

    it('throws when commit not called', async () => {
      wallet.add(makeOp());
      await expect(wallet.push()).rejects.toThrow('Nothing to push: please commit first');
    });
  });

  // ==================== full cycle ====================

  describe('add -> commit -> push cycle', () => {
    it('full happy path', async () => {
      wallet.add(makeOp());
      wallet.commit('Buy 10 AAPL');
      const result = await wallet.push();

      expect(result.operationCount).toBe(1);
      expect(result.filled).toHaveLength(1);
      expect(result.filled[0].orderId).toBe('sec-001');
      expect(result.filled[0].filledPrice).toBe(150.25);
    });

    it('sequential pushes create chained commits', async () => {
      wallet.add(makeOp());
      wallet.commit('first');
      const r1 = await wallet.push();

      wallet.add(makeOp({ params: { symbol: 'MSFT', side: 'buy', type: 'market', qty: 5 } }));
      wallet.commit('second');
      const r2 = await wallet.push();

      const c2 = wallet.show(r2.hash);
      expect(c2?.parentHash).toBe(r1.hash);
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

      expect(wallet.log({ limit: 2 })).toHaveLength(2);
    });

    it('filters by symbol', async () => {
      wallet.add(makeOp({ params: { symbol: 'AAPL', side: 'buy', type: 'market', qty: 10 } }));
      wallet.commit('aapl');
      await wallet.push();

      wallet.add(makeOp({ params: { symbol: 'MSFT', side: 'buy', type: 'market', qty: 5 } }));
      wallet.commit('msft');
      await wallet.push();

      const entries = wallet.log({ symbol: 'MSFT' });
      expect(entries).toHaveLength(1);
      expect(entries[0].message).toBe('msft');
    });

    it('formats securities-specific operation summaries', async () => {
      wallet.add(makeOp());
      wallet.commit('buy aapl');
      await wallet.push();

      const entries = wallet.log();
      expect(entries[0].operations[0].change).toContain('buy');
      expect(entries[0].operations[0].change).toContain('10 shares');
    });
  });

  // ==================== show / status ====================

  describe('show', () => {
    it('returns commit by hash', async () => {
      wallet.add(makeOp());
      const { hash } = wallet.commit('test');
      await wallet.push();

      expect(wallet.show(hash)?.message).toBe('test');
    });

    it('returns null for unknown hash', () => {
      expect(wallet.show('deadbeef')).toBeNull();
    });
  });

  describe('status', () => {
    it('shows initial empty state', () => {
      const s = wallet.status();
      expect(s.staged).toEqual([]);
      expect(s.head).toBeNull();
      expect(s.commitCount).toBe(0);
    });
  });

  // ==================== sync ====================

  describe('sync', () => {
    it('creates sync commit with order updates', async () => {
      const state: WalletState = {
        cash: 50000, equity: 51500, portfolioValue: 1500,
        unrealizedPnL: 0, realizedPnL: 0, holdings: [], pendingOrders: [],
      };

      const result = await wallet.sync(
        [{ orderId: 'sec-001', symbol: 'AAPL', previousStatus: 'pending', currentStatus: 'filled', filledPrice: 150, filledQty: 10 }],
        state,
      );

      expect(result.updatedCount).toBe(1);
      expect(wallet.status().head).toBe(result.hash);
      expect(config.onCommit).toHaveBeenCalled();
    });

    it('returns early when updates is empty', async () => {
      const state: WalletState = {
        cash: 50000, equity: 50000, portfolioValue: 0,
        unrealizedPnL: 0, realizedPnL: 0, holdings: [], pendingOrders: [],
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
          order: { id: 'sec-pending', status: 'pending' },
        }),
      });
      wallet = new SecWallet(config);

      wallet.add(makeOp());
      wallet.commit('limit buy');
      await wallet.push();

      expect(wallet.getPendingOrderIds()).toEqual([
        { orderId: 'sec-pending', symbol: 'AAPL' },
      ]);
    });

    it('excludes orders updated to filled by sync', async () => {
      config = createMockConfig({
        executeOperation: vi.fn().mockResolvedValue({
          success: true,
          order: { id: 'sec-200', status: 'pending' },
        }),
      });
      wallet = new SecWallet(config);

      wallet.add(makeOp());
      wallet.commit('limit');
      await wallet.push();

      const state: WalletState = {
        cash: 50000, equity: 50000, portfolioValue: 0,
        unrealizedPnL: 0, realizedPnL: 0, holdings: [], pendingOrders: [],
      };
      await wallet.sync(
        [{ orderId: 'sec-200', symbol: 'AAPL', previousStatus: 'pending', currentStatus: 'filled', filledPrice: 150, filledQty: 10 }],
        state,
      );

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
      const restored = SecWallet.restore(exported, config);

      expect(restored.status().head).toBe(wallet.status().head);
      expect(restored.status().commitCount).toBe(1);
    });
  });

  // ==================== simulatePriceChange ====================

  describe('simulatePriceChange', () => {
    it('returns no-change result when no holdings', async () => {
      const result = await wallet.simulatePriceChange([
        { symbol: 'AAPL', change: '+10%' },
      ]);

      expect(result.success).toBe(true);
      expect(result.summary.totalPnLChange).toBe(0);
      expect(result.summary.worstCase).toBe('No holdings to simulate.');
    });

    it('calculates PnL for long holding with relative change', async () => {
      config = createMockConfig({
        getWalletState: vi.fn().mockResolvedValue({
          cash: 48500, equity: 50000, portfolioValue: 1500,
          unrealizedPnL: 1000, realizedPnL: 0,
          holdings: [{
            symbol: 'AAPL', side: 'long', qty: 100,
            avgEntryPrice: 140, currentPrice: 150, marketValue: 15000,
            unrealizedPnL: 1000, unrealizedPnLPercent: 7.14, costBasis: 14000,
          }],
          pendingOrders: [],
        } satisfies WalletState),
      });
      wallet = new SecWallet(config);

      const result = await wallet.simulatePriceChange([
        { symbol: 'AAPL', change: '-10%' },
      ]);

      expect(result.success).toBe(true);
      // New price: 150 * 0.9 = 135
      // New PnL: (135 - 140) * 100 = -500
      // PnL change: -500 - 1000 = -1500
      expect(result.simulatedState.holdings[0].simulatedPrice).toBeCloseTo(135);
      expect(result.simulatedState.holdings[0].unrealizedPnL).toBeCloseTo(-500);
      expect(result.summary.totalPnLChange).toBeCloseTo(-1500);
    });

    it('returns error for invalid change format', async () => {
      config = createMockConfig({
        getWalletState: vi.fn().mockResolvedValue({
          cash: 48500, equity: 50000, portfolioValue: 1500,
          unrealizedPnL: 0, realizedPnL: 0,
          holdings: [{
            symbol: 'AAPL', side: 'long', qty: 100,
            avgEntryPrice: 140, currentPrice: 150, marketValue: 15000,
            unrealizedPnL: 1000, unrealizedPnLPercent: 7.14, costBasis: 14000,
          }],
          pendingOrders: [],
        } satisfies WalletState),
      });
      wallet = new SecWallet(config);

      const result = await wallet.simulatePriceChange([
        { symbol: 'AAPL', change: 'bad' },
      ]);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid change format');
    });
  });
});
