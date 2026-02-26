import type { SecOperationGuard, SecGuardContext } from './types.js';

const DEFAULT_MAX_PERCENT = 25;

export class SecMaxPositionSizeGuard implements SecOperationGuard {
  readonly name = 'max-position-size';
  private maxPercent: number;

  constructor(options: Record<string, unknown>) {
    this.maxPercent = Number(options.maxPercentOfEquity ?? DEFAULT_MAX_PERCENT);
  }

  check(ctx: SecGuardContext): string | null {
    if (ctx.operation.action !== 'placeOrder') return null;

    const { holdings, account, operation } = ctx;
    const symbol = operation.params.symbol as string;

    const existing = holdings.find(h => h.symbol === symbol);
    const currentValue = existing?.marketValue ?? 0;

    // Estimate added value from order params
    const notional = operation.params.notional as number | undefined;
    const qty = operation.params.qty as number | undefined;

    let addedValue = 0;
    if (notional) {
      addedValue = notional;
    } else if (qty && existing) {
      addedValue = qty * existing.currentPrice;
    }
    // If we can't estimate (new symbol + qty-based without holding), allow — broker will validate

    if (addedValue === 0) return null;

    const projectedValue = currentValue + addedValue;
    const percent = account.equity > 0 ? (projectedValue / account.equity) * 100 : 0;

    if (percent > this.maxPercent) {
      return `Position for ${symbol} would be ${percent.toFixed(1)}% of equity (limit: ${this.maxPercent}%)`;
    }

    return null;
  }
}
