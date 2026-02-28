import { describe, it, expect } from 'vitest';
import { SymbolWhitelistGuard } from './symbol-whitelist.js';
import type { GuardContext } from './types.js';

function makeCtx(symbol = 'BTC/USD', action = 'placeOrder'): GuardContext {
  return {
    operation: { action: action as 'placeOrder', params: { symbol, side: 'buy', type: 'market', usd_size: 1000 } },
    positions: [],
    account: { balance: 10000, totalMargin: 0, unrealizedPnL: 0, equity: 10000, realizedPnL: 0, totalPnL: 0 },
  };
}

describe('SymbolWhitelistGuard', () => {
  it('allows whitelisted symbol', () => {
    const guard = new SymbolWhitelistGuard({ symbols: ['BTC/USD', 'ETH/USD'] });
    expect(guard.check(makeCtx('BTC/USD'))).toBeNull();
  });

  it('rejects non-whitelisted symbol', () => {
    const guard = new SymbolWhitelistGuard({ symbols: ['BTC/USD', 'ETH/USD'] });
    const result = guard.check(makeCtx('DOGE/USD'));
    expect(result).toContain('DOGE/USD');
    expect(result).toContain('not in the allowed list');
  });

  it('allows operations without a symbol param', () => {
    const guard = new SymbolWhitelistGuard({ symbols: ['BTC/USD'] });
    const ctx: GuardContext = {
      operation: { action: 'cancelOrder', params: { orderId: 'abc' } },
      positions: [],
      account: { balance: 10000, totalMargin: 0, unrealizedPnL: 0, equity: 10000, realizedPnL: 0, totalPnL: 0 },
    };
    expect(guard.check(ctx)).toBeNull();
  });

  it('throws when constructed without symbols', () => {
    expect(() => new SymbolWhitelistGuard({})).toThrow('non-empty "symbols" array');
  });

  it('throws when constructed with empty symbols', () => {
    expect(() => new SymbolWhitelistGuard({ symbols: [] })).toThrow('non-empty "symbols" array');
  });

  it('checks closePosition operations too', () => {
    const guard = new SymbolWhitelistGuard({ symbols: ['BTC/USD'] });
    expect(guard.check(makeCtx('ETH/USD', 'closePosition'))).not.toBeNull();
  });

  it('checks adjustLeverage operations too', () => {
    const guard = new SymbolWhitelistGuard({ symbols: ['BTC/USD'] });
    expect(guard.check(makeCtx('ETH/USD', 'adjustLeverage'))).not.toBeNull();
  });
});
