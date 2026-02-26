import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createGuardPipeline } from './guard-pipeline.js';
import type { ICryptoTradingEngine } from '../interfaces.js';
import type { OperationGuard } from './types.js';
import type { Operation } from '../wallet/types.js';

function createMockEngine(): ICryptoTradingEngine {
  return {
    placeOrder: vi.fn(),
    getPositions: vi.fn().mockResolvedValue([]),
    getOrders: vi.fn(),
    getAccount: vi.fn().mockResolvedValue({
      balance: 10000, totalMargin: 0, unrealizedPnL: 0,
      equity: 10000, realizedPnL: 0, totalPnL: 0,
    }),
    cancelOrder: vi.fn(),
    adjustLeverage: vi.fn(),
    getTicker: vi.fn(),
    getFundingRate: vi.fn(),
    getOrderBook: vi.fn(),
  };
}

const placeOrderOp: Operation = {
  action: 'placeOrder',
  params: { symbol: 'BTC/USD', side: 'buy', type: 'market', usd_size: 1000 },
};

describe('createGuardPipeline', () => {
  let engine: ICryptoTradingEngine;
  let dispatcher: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    engine = createMockEngine();
    dispatcher = vi.fn().mockResolvedValue({ success: true, orderId: 'ord-001' });
  });

  it('returns dispatcher directly when guards array is empty', () => {
    const pipeline = createGuardPipeline(dispatcher, engine, []);
    expect(pipeline).toBe(dispatcher);
  });

  it('passes operation through when all guards return null', async () => {
    const guard: OperationGuard = { name: 'allow-all', check: () => null };
    const pipeline = createGuardPipeline(dispatcher, engine, [guard]);

    const result = await pipeline(placeOrderOp);

    expect(dispatcher).toHaveBeenCalledWith(placeOrderOp);
    expect(result).toEqual({ success: true, orderId: 'ord-001' });
  });

  it('rejects with guard error when a guard returns a string', async () => {
    const guard: OperationGuard = { name: 'blocker', check: () => 'too risky' };
    const pipeline = createGuardPipeline(dispatcher, engine, [guard]);

    const result = await pipeline(placeOrderOp);

    expect(dispatcher).not.toHaveBeenCalled();
    expect(result).toEqual({ success: false, error: '[guard:blocker] too risky' });
  });

  it('short-circuits on first rejection', async () => {
    const guard1: OperationGuard = { name: 'first', check: () => 'nope' };
    const guard2Check = vi.fn().mockReturnValue(null);
    const guard2: OperationGuard = { name: 'second', check: guard2Check };
    const pipeline = createGuardPipeline(dispatcher, engine, [guard1, guard2]);

    await pipeline(placeOrderOp);

    expect(guard2Check).not.toHaveBeenCalled();
    expect(dispatcher).not.toHaveBeenCalled();
  });

  it('builds context with positions and account from engine', async () => {
    const positions = [{ symbol: 'BTC/USD', side: 'long' as const, size: 0.5, entryPrice: 90000, leverage: 5, margin: 9000, liquidationPrice: 72000, markPrice: 95000, unrealizedPnL: 2500, positionValue: 47500 }];
    const account = { balance: 10000, totalMargin: 0, unrealizedPnL: 0, equity: 10000, realizedPnL: 0, totalPnL: 0 };
    (engine.getPositions as ReturnType<typeof vi.fn>).mockResolvedValue(positions);
    (engine.getAccount as ReturnType<typeof vi.fn>).mockResolvedValue(account);

    let capturedCtx: unknown;
    const guard: OperationGuard = {
      name: 'spy',
      check: (ctx) => { capturedCtx = ctx; return null; },
    };
    const pipeline = createGuardPipeline(dispatcher, engine, [guard]);

    await pipeline(placeOrderOp);

    expect(capturedCtx).toEqual({
      operation: placeOrderOp,
      positions,
      account,
    });
  });

  it('supports async guards', async () => {
    const guard: OperationGuard = {
      name: 'async-blocker',
      check: async () => 'async rejection',
    };
    const pipeline = createGuardPipeline(dispatcher, engine, [guard]);

    const result = await pipeline(placeOrderOp);

    expect(result).toEqual({ success: false, error: '[guard:async-blocker] async rejection' });
  });
});
