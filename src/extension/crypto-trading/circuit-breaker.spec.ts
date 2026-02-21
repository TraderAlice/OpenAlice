import { describe, it, expect, beforeEach } from 'vitest';
import { DailyLossCircuitBreaker } from './circuit-breaker.js';

describe('DailyLossCircuitBreaker', () => {
  let clock: number;
  let cb: DailyLossCircuitBreaker;

  beforeEach(() => {
    clock = Date.now();
    cb = new DailyLossCircuitBreaker({ maxDailyLossPct: 0.05, cooldownMs: 24 * 3600 * 1000 }, () => clock);
  });

  it('allows trading when no losses', () => {
    expect(cb.check(1000).allowed).toBe(true);
  });

  it('allows trading with small realized losses', () => {
    cb.recordPnL(-30); // 3% of 1000
    expect(cb.check(1000).allowed).toBe(true);
  });

  it('trips when realized loss exceeds 5%', () => {
    cb.recordPnL(-51); // 5.1% of 1000
    const result = cb.check(1000);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('5.1%');
    expect(cb.isTripped).toBe(true);
  });

  it('trips when unrealized snapshot + realized combined exceed 5%', () => {
    cb.recordPnL(-20); // 2%
    cb.updateUnrealizedPnL(-31); // 3.1% unrealized, total 5.1%
    const result = cb.check(1000);
    expect(result.allowed).toBe(false);
  });

  it('unrealized snapshot replaces not accumulates', () => {
    cb.updateUnrealizedPnL(-30); // 3%
    cb.updateUnrealizedPnL(-30); // still 3%, NOT 6%
    cb.updateUnrealizedPnL(-30); // still 3%
    expect(cb.check(1000).allowed).toBe(true); // 3% < 5%
  });

  it('stays tripped during cooldown', () => {
    cb.recordPnL(-60);
    cb.check(1000); // trips
    clock += 12 * 3600 * 1000; // 12h later
    expect(cb.check(1000).allowed).toBe(false);
  });

  it('resets after cooldown expires', () => {
    cb.recordPnL(-60);
    cb.check(1000);
    clock += 25 * 3600 * 1000; // 25h later, losses also pruned
    cb.updateUnrealizedPnL(0); // positions closed
    expect(cb.check(1000).allowed).toBe(true);
  });

  it('accumulates multiple realized losses', () => {
    cb.recordPnL(-20);
    cb.recordPnL(-15);
    cb.recordPnL(-16); // total -51 = 5.1%
    expect(cb.check(1000).allowed).toBe(false);
  });

  it('prunes realized entries older than 24h', () => {
    cb.recordPnL(-40);
    clock += 25 * 3600 * 1000; // 25h later
    cb.recordPnL(-10); // only -10 in window = 1%
    expect(cb.check(1000).allowed).toBe(true);
  });

  it('tracks rollingPnL correctly (realized + unrealized)', () => {
    cb.recordPnL(-20);
    cb.recordPnL(10);
    cb.updateUnrealizedPnL(-5);
    expect(cb.rollingPnL).toBe(-15); // -20 + 10 + (-5)
  });

  it('blocks trading when equity is zero (fail-closed)', () => {
    const result = cb.check(0);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('fail-closed');
  });

  it('blocks trading when equity is negative (fail-closed)', () => {
    const result = cb.check(-100);
    expect(result.allowed).toBe(false);
  });
});
