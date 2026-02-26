import type { OperationGuard, GuardContext } from './types.js';

const DEFAULT_MAX_PERCENT = 25;

export class MaxPositionSizeGuard implements OperationGuard {
  readonly name = 'max-position-size';
  private maxPercent: number;

  constructor(options: Record<string, unknown>) {
    this.maxPercent = Number(options.maxPercentOfEquity ?? DEFAULT_MAX_PERCENT);
  }

  check(ctx: GuardContext): string | null {
    if (ctx.operation.action !== 'placeOrder') return null;

    const { positions, account, operation } = ctx;
    const symbol = operation.params.symbol as string;

    const existing = positions.find(p => p.symbol === symbol);
    const currentValue = existing?.positionValue ?? 0;

    // Estimate added value
    const usdSize = operation.params.usd_size as number | undefined;
    const size = operation.params.size as number | undefined;

    let addedValue = 0;
    if (usdSize) {
      addedValue = usdSize;
    } else if (size && existing) {
      addedValue = size * existing.markPrice;
    }
    // If we can't estimate (new symbol + coin-based), allow — engine will handle

    if (addedValue === 0) return null;

    const projectedValue = currentValue + addedValue;
    const percent = account.equity > 0 ? (projectedValue / account.equity) * 100 : 0;

    if (percent > this.maxPercent) {
      return `Position for ${symbol} would be ${percent.toFixed(1)}% of equity (limit: ${this.maxPercent}%)`;
    }

    return null;
  }
}
