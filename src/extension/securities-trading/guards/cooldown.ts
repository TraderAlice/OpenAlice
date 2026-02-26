import type { SecOperationGuard, SecGuardContext } from './types.js';

const DEFAULT_MIN_INTERVAL_MS = 60_000;

export class SecCooldownGuard implements SecOperationGuard {
  readonly name = 'cooldown';
  private minIntervalMs: number;
  private lastTradeTime = new Map<string, number>();

  constructor(options: Record<string, unknown>) {
    this.minIntervalMs = Number(options.minIntervalMs ?? DEFAULT_MIN_INTERVAL_MS);
  }

  check(ctx: SecGuardContext): string | null {
    if (ctx.operation.action !== 'placeOrder') return null;

    const symbol = ctx.operation.params.symbol as string;
    const now = Date.now();
    const lastTime = this.lastTradeTime.get(symbol);

    if (lastTime != null) {
      const elapsed = now - lastTime;
      if (elapsed < this.minIntervalMs) {
        const remaining = Math.ceil((this.minIntervalMs - elapsed) / 1000);
        return `Cooldown active for ${symbol}: ${remaining}s remaining`;
      }
    }

    this.lastTradeTime.set(symbol, now);
    return null;
  }
}
