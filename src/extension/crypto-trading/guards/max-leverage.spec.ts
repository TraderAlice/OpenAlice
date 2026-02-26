import { describe, it, expect } from 'vitest';
import { MaxLeverageGuard } from './max-leverage.js';
import type { GuardContext } from './types.js';

function makeCtx(action: string, params: Record<string, unknown>): GuardContext {
  return {
    operation: { action: action as 'placeOrder', params },
    positions: [],
    account: { balance: 10000, totalMargin: 0, unrealizedPnL: 0, equity: 10000, realizedPnL: 0, totalPnL: 0 },
  };
}

describe('MaxLeverageGuard', () => {
  it('allows placeOrder within global limit', () => {
    const guard = new MaxLeverageGuard({ maxLeverage: 10 });
    const ctx = makeCtx('placeOrder', { symbol: 'BTC/USD', side: 'buy', type: 'market', leverage: 10 });

    expect(guard.check(ctx)).toBeNull();
  });

  it('rejects placeOrder exceeding global limit', () => {
    const guard = new MaxLeverageGuard({ maxLeverage: 10 });
    const ctx = makeCtx('placeOrder', { symbol: 'BTC/USD', side: 'buy', type: 'market', leverage: 15 });

    expect(guard.check(ctx)).toContain('15x');
    expect(guard.check(ctx)).toContain('10x');
  });

  it('applies symbol override over global limit', () => {
    const guard = new MaxLeverageGuard({
      maxLeverage: 10,
      symbolOverrides: { 'DOGE/USD': 3 },
    });

    const dogeCtx = makeCtx('placeOrder', { symbol: 'DOGE/USD', side: 'buy', type: 'market', leverage: 5 });
    expect(guard.check(dogeCtx)).toContain('3x');

    const btcCtx = makeCtx('placeOrder', { symbol: 'BTC/USD', side: 'buy', type: 'market', leverage: 5 });
    expect(btcCtx.operation.params.leverage).toBe(5);
    expect(guard.check(btcCtx)).toBeNull();
  });

  it('intercepts adjustLeverage action', () => {
    const guard = new MaxLeverageGuard({ maxLeverage: 10 });
    const ctx = makeCtx('adjustLeverage', { symbol: 'BTC/USD', newLeverage: 20 });

    expect(guard.check(ctx)).toContain('20x');
  });

  it('ignores placeOrder without leverage param', () => {
    const guard = new MaxLeverageGuard({ maxLeverage: 5 });
    const ctx = makeCtx('placeOrder', { symbol: 'BTC/USD', side: 'buy', type: 'market' });

    expect(guard.check(ctx)).toBeNull();
  });

  it('ignores non-leverage actions', () => {
    const guard = new MaxLeverageGuard({ maxLeverage: 1 });
    const ctx = makeCtx('cancelOrder', { orderId: 'abc' });

    expect(guard.check(ctx)).toBeNull();
  });

  it('uses default 10x when no config provided', () => {
    const guard = new MaxLeverageGuard({});
    const ctx = makeCtx('placeOrder', { symbol: 'BTC/USD', side: 'buy', type: 'market', leverage: 11 });

    expect(guard.check(ctx)).not.toBeNull();
  });
});
