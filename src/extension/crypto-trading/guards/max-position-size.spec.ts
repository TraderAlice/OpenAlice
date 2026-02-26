import { describe, it, expect } from 'vitest';
import { MaxPositionSizeGuard } from './max-position-size.js';
import type { GuardContext } from './types.js';
import type { CryptoPosition, CryptoAccountInfo } from '../interfaces.js';

function makeCtx(overrides: {
  action?: string;
  params?: Record<string, unknown>;
  positions?: CryptoPosition[];
  account?: Partial<CryptoAccountInfo>;
} = {}): GuardContext {
  return {
    operation: {
      action: (overrides.action ?? 'placeOrder') as 'placeOrder',
      params: overrides.params ?? { symbol: 'BTC/USD', side: 'buy', type: 'market', usd_size: 1000 },
    },
    positions: overrides.positions ?? [],
    account: {
      balance: 10000, totalMargin: 0, unrealizedPnL: 0,
      equity: 10000, realizedPnL: 0, totalPnL: 0,
      ...overrides.account,
    },
  };
}

describe('MaxPositionSizeGuard', () => {
  it('allows placeOrder within limit', () => {
    const guard = new MaxPositionSizeGuard({ maxPercentOfEquity: 25 });
    const ctx = makeCtx({ params: { symbol: 'BTC/USD', side: 'buy', type: 'market', usd_size: 2000 } });

    expect(guard.check(ctx)).toBeNull();
  });

  it('rejects placeOrder exceeding limit', () => {
    const guard = new MaxPositionSizeGuard({ maxPercentOfEquity: 25 });
    const ctx = makeCtx({ params: { symbol: 'BTC/USD', side: 'buy', type: 'market', usd_size: 3000 } });

    expect(guard.check(ctx)).toContain('30.0%');
    expect(guard.check(ctx)).toContain('limit: 25%');
  });

  it('accounts for existing position value', () => {
    const guard = new MaxPositionSizeGuard({ maxPercentOfEquity: 25 });
    const positions: CryptoPosition[] = [{
      symbol: 'BTC/USD', side: 'long', size: 0.01, entryPrice: 95000,
      leverage: 1, margin: 950, liquidationPrice: 0,
      markPrice: 95000, unrealizedPnL: 0, positionValue: 2000,
    }];
    // existing 2000 + new 1000 = 3000 = 30% of 10000 equity → reject
    const ctx = makeCtx({
      params: { symbol: 'BTC/USD', side: 'buy', type: 'market', usd_size: 1000 },
      positions,
    });

    expect(guard.check(ctx)).not.toBeNull();
  });

  it('ignores non-placeOrder actions', () => {
    const guard = new MaxPositionSizeGuard({ maxPercentOfEquity: 10 });
    const ctx = makeCtx({ action: 'cancelOrder', params: { orderId: 'abc' } });

    expect(guard.check(ctx)).toBeNull();
  });

  it('allows when added value cannot be estimated (coin size, no existing position)', () => {
    const guard = new MaxPositionSizeGuard({ maxPercentOfEquity: 5 });
    const ctx = makeCtx({ params: { symbol: 'BTC/USD', side: 'buy', type: 'market', size: 10 } });

    expect(guard.check(ctx)).toBeNull();
  });

  it('uses default 25% when no config provided', () => {
    const guard = new MaxPositionSizeGuard({});
    // 2600 / 10000 = 26% > 25%
    const ctx = makeCtx({ params: { symbol: 'BTC/USD', side: 'buy', type: 'market', usd_size: 2600 } });

    expect(guard.check(ctx)).not.toBeNull();
  });
});
