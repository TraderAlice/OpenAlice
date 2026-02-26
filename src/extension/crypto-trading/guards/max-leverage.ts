import type { OperationGuard, GuardContext } from './types.js';

const DEFAULT_MAX_LEVERAGE = 10;

export class MaxLeverageGuard implements OperationGuard {
  readonly name = 'max-leverage';
  private maxLeverage: number;
  private symbolOverrides: Record<string, number>;

  constructor(options: Record<string, unknown>) {
    this.maxLeverage = Number(options.maxLeverage ?? DEFAULT_MAX_LEVERAGE);
    this.symbolOverrides = (options.symbolOverrides as Record<string, number>) ?? {};
  }

  check(ctx: GuardContext): string | null {
    const { operation } = ctx;

    let leverage: number | undefined;
    let symbol: string | undefined;

    if (operation.action === 'placeOrder') {
      leverage = operation.params.leverage as number | undefined;
      symbol = operation.params.symbol as string;
    } else if (operation.action === 'adjustLeverage') {
      leverage = operation.params.newLeverage as number;
      symbol = operation.params.symbol as string;
    }

    if (leverage == null || symbol == null) return null;

    const limit = this.symbolOverrides[symbol] ?? this.maxLeverage;

    if (leverage > limit) {
      return `Leverage ${leverage}x exceeds limit ${limit}x for ${symbol}`;
    }

    return null;
  }
}
