/**
 * Daily Loss Circuit Breaker
 *
 * Tracks PnL via two mechanisms:
 * 1. Realized PnL events (from closed positions) — accumulated
 * 2. Unrealized PnL snapshots (from position fetches) — latest value only, not accumulated
 *
 * When combined daily loss exceeds threshold, blocks all new orders for 24h.
 *
 * P0 risk control — non-bypassable.
 */

export interface CircuitBreakerConfig {
  /** Max daily loss as fraction of equity (default: 0.05 = 5%). */
  maxDailyLossPct: number;
  /** Cooldown period in ms after circuit trips (default: 24h). */
  cooldownMs: number;
}

const DEFAULT_CONFIG: CircuitBreakerConfig = {
  maxDailyLossPct: 0.05,
  cooldownMs: 24 * 60 * 60 * 1000,
};

interface PnLEntry {
  timestamp: number;
  pnl: number;
}

export class DailyLossCircuitBreaker {
  private config: CircuitBreakerConfig;
  /** Realized PnL events (accumulated). */
  private realizedLog: PnLEntry[] = [];
  /** Latest unrealized PnL snapshot (not accumulated). */
  private latestUnrealizedPnL = 0;
  private trippedAt: number | null = null;
  private now: () => number;

  constructor(config?: Partial<CircuitBreakerConfig>, now?: () => number) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.now = now ?? Date.now;
  }

  /** Record a realized PnL event (e.g., closed position profit/loss). Accumulated. */
  recordPnL(pnl: number): void {
    this.realizedLog.push({ timestamp: this.now(), pnl });
    this.pruneOldEntries();
  }

  /** Update the latest unrealized PnL snapshot. Replaces previous value (not accumulated). */
  updateUnrealizedPnL(unrealizedPnL: number): void {
    this.latestUnrealizedPnL = unrealizedPnL;
  }

  /** Check if trading is allowed. Returns { allowed, reason }. */
  check(currentEquity: number): { allowed: boolean; reason?: string } {
    // Check cooldown
    if (this.trippedAt !== null) {
      const elapsed = this.now() - this.trippedAt;
      if (elapsed < this.config.cooldownMs) {
        const remainingH = ((this.config.cooldownMs - elapsed) / 3600000).toFixed(1);
        return {
          allowed: false,
          reason: `Circuit breaker tripped. Trading resumes in ${remainingH}h.`,
        };
      }
      // Cooldown expired, reset
      this.trippedAt = null;
    }

    // Fail-closed: if equity is zero/missing, block trading (cannot assess risk)
    if (currentEquity <= 0) {
      return {
        allowed: false,
        reason: `Equity is ${currentEquity}. Cannot assess risk — trading blocked (fail-closed).`,
      };
    }

    // Calculate: realized (accumulated) + unrealized (latest snapshot)
    this.pruneOldEntries();
    const realizedPnL = this.realizedLog.reduce((sum, e) => sum + e.pnl, 0);
    const totalPnL = realizedPnL + this.latestUnrealizedPnL;

    if (totalPnL < 0) {
      const lossPct = Math.abs(totalPnL) / currentEquity;
      if (lossPct >= this.config.maxDailyLossPct) {
        this.trippedAt = this.now();
        return {
          allowed: false,
          reason: `Daily loss ${(lossPct * 100).toFixed(1)}% exceeds ${(this.config.maxDailyLossPct * 100).toFixed(0)}% limit. Circuit breaker tripped for 24h.`,
        };
      }
    }

    return { allowed: true };
  }

  /** Get current combined PnL (realized + unrealized). */
  get rollingPnL(): number {
    this.pruneOldEntries();
    return this.realizedLog.reduce((sum, e) => sum + e.pnl, 0) + this.latestUnrealizedPnL;
  }

  get isTripped(): boolean {
    if (this.trippedAt === null) return false;
    return (this.now() - this.trippedAt) < this.config.cooldownMs;
  }

  private pruneOldEntries(): void {
    const cutoff = this.now() - 24 * 60 * 60 * 1000;
    this.realizedLog = this.realizedLog.filter((e) => e.timestamp >= cutoff);
  }
}
