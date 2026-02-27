import type { SecOperationGuard, SecGuardContext } from './types.js';

export class SecSymbolWhitelistGuard implements SecOperationGuard {
  readonly name = 'symbol-whitelist';
  private allowed: Set<string>;

  constructor(options: Record<string, unknown>) {
    const symbols = options.symbols as string[] | undefined;
    if (!symbols || symbols.length === 0) {
      throw new Error('symbol-whitelist guard requires a non-empty "symbols" array in options');
    }
    this.allowed = new Set(symbols);
  }

  check(ctx: SecGuardContext): string | null {
    const symbol = ctx.operation.params.symbol as string | undefined;
    if (!symbol) return null;

    if (!this.allowed.has(symbol)) {
      return `Symbol ${symbol} is not in the allowed list`;
    }
    return null;
  }
}
