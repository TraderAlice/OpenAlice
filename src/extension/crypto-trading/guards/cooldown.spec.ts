import { describe, it, expect, vi, afterEach } from 'vitest';
import { CooldownGuard } from './cooldown.js';
import type { GuardContext } from './types.js';

function makeCtx(symbol = 'BTC/USD'): GuardContext {
  return {
    operation: { action: 'placeOrder', params: { symbol, side: 'buy', type: 'market', usd_size: 1000 } },
    positions: [],
    account: { balance: 10000, totalMargin: 0, unrealizedPnL: 0, equity: 10000, realizedPnL: 0, totalPnL: 0 },
  };
}

describe('CooldownGuard', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('allows first trade for a symbol', () => {
    const guard = new CooldownGuard({ minIntervalMs: 60000 });

    expect(guard.check(makeCtx())).toBeNull();
  });

  it('rejects second trade within cooldown period', () => {
    const guard = new CooldownGuard({ minIntervalMs: 60000 });

    guard.check(makeCtx()); // first trade — allowed, records timestamp
    const result = guard.check(makeCtx()); // second trade — within cooldown

    expect(result).toContain('Cooldown active');
    expect(result).toContain('BTC/USD');
  });

  it('allows trade after cooldown expires', () => {
    const guard = new CooldownGuard({ minIntervalMs: 1000 });
    const now = Date.now();

    vi.spyOn(Date, 'now').mockReturnValue(now);
    guard.check(makeCtx()); // first trade

    vi.spyOn(Date, 'now').mockReturnValue(now + 1001); // cooldown expired
    expect(guard.check(makeCtx())).toBeNull();
  });

  it('tracks symbols independently', () => {
    const guard = new CooldownGuard({ minIntervalMs: 60000 });

    guard.check(makeCtx('BTC/USD')); // BTC trade
    expect(guard.check(makeCtx('ETH/USD'))).toBeNull(); // ETH still OK
  });

  it('ignores non-placeOrder actions', () => {
    const guard = new CooldownGuard({ minIntervalMs: 60000 });
    const ctx: GuardContext = {
      operation: { action: 'cancelOrder', params: { orderId: 'abc' } },
      positions: [],
      account: { balance: 10000, totalMargin: 0, unrealizedPnL: 0, equity: 10000, realizedPnL: 0, totalPnL: 0 },
    };

    expect(guard.check(ctx)).toBeNull();
  });

  it('uses default 60s when no config provided', () => {
    const guard = new CooldownGuard({});
    const now = Date.now();

    vi.spyOn(Date, 'now').mockReturnValue(now);
    guard.check(makeCtx());

    vi.spyOn(Date, 'now').mockReturnValue(now + 59000); // 59s < 60s
    expect(guard.check(makeCtx())).not.toBeNull();

    vi.spyOn(Date, 'now').mockReturnValue(now + 60001); // 60s+ — OK
    expect(guard.check(makeCtx())).toBeNull();
  });
});
