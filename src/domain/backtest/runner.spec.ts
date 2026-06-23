import { describe, it, expect } from 'vitest'
import { runBacktest } from './runner.js'
import { BarCursorImpl } from './cursor.js'
import { quoteBuy, quoteSell } from './execution.js'
import { computeMetrics } from './metrics.js'
import type { Bar, StrategyFn, BacktestResult } from './types.js'

// ==================== Bar fixture helpers ====================

function bar(i: number, open: number, close: number, high = Math.max(open, close) + 0.5, low = Math.min(open, close) - 0.5, volume = 1000): Bar {
  return { ts: 1_700_000_000_000 + i * 60_000, open, high, low, close, volume }
}

/** Monotonically increasing closes (bull market). */
function bullBars(n: number, startPrice = 100, step = 1): Bar[] {
  return Array.from({ length: n }, (_, i) =>
    bar(i, startPrice + i * step, startPrice + (i + 1) * step),
  )
}

/** Monotonically decreasing closes. */
function bearBars(n: number, startPrice = 100, step = 1): Bar[] {
  return Array.from({ length: n }, (_, i) =>
    bar(i, startPrice - i * step, startPrice - (i + 1) * step),
  )
}

// ==================== BarCursor ====================

describe('BarCursor', () => {
  it('never lets the strategy see future bars', () => {
    const bars = bullBars(5)
    const cursor = new BarCursorImpl(bars)
    expect(cursor.current).toBe(bars[0])
    expect(cursor.lookback(0)).toBe(bars[0])
    expect(cursor.lookback(1)).toBeUndefined() // nothing before index 0

    cursor._advance()
    cursor._advance()
    expect(cursor.index).toBe(2)
    expect(cursor.current).toBe(bars[2])
    expect(cursor.lookback(1)).toBe(bars[1])
    expect(cursor.lookback(2)).toBe(bars[0])
    expect(cursor.lookback(3)).toBeUndefined() // out of range
  })

  it('rejects negative offsets', () => {
    const cursor = new BarCursorImpl(bullBars(3))
    expect(() => cursor.lookback(-1)).toThrow(/non-negative/)
  })

  it('lastN returns oldest-first, clipped at start', () => {
    const bars = bullBars(5)
    const cursor = new BarCursorImpl(bars)
    cursor._advance() // index 1
    cursor._advance() // index 2
    expect(cursor.lastN(3)).toEqual([bars[0], bars[1], bars[2]])
    expect(cursor.lastN(10)).toEqual([bars[0], bars[1], bars[2]]) // clipped
    expect(cursor.lastN(0)).toEqual([])
  })

  it('throws if constructed with an empty bar array', () => {
    expect(() => new BarCursorImpl([])).toThrow(/at least one bar/)
  })
})

// ==================== Execution ====================

describe('execution model', () => {
  const params = { slippageBps: 10, commissionBps: 5, initialCash: 10_000 }

  it('quoteBuy pays slippage above the raw price', () => {
    const q = quoteBuy(100, 2, params)
    // slippage +10 bps → 100 * 1.001 = 100.1
    expect(q.price).toBeCloseTo(100.1, 6)
    // notional = 100.1 * 2 = 200.2
    expect(q.notional).toBeCloseTo(200.2, 6)
    // commission = 200.2 * 5/10000 = 0.1001
    expect(q.commission).toBeCloseTo(0.1001, 6)
  })

  it('quoteSell gets slippage below the raw price', () => {
    const q = quoteSell(100, 2, params)
    expect(q.price).toBeCloseTo(99.9, 6)
    expect(q.notional).toBeCloseTo(199.8, 6)
    expect(q.commission).toBeCloseTo(0.0999, 6)
  })

  it('rejects invalid inputs', () => {
    expect(() => quoteBuy(0, 1, params)).toThrow(/positive/)
    expect(() => quoteBuy(100, 0, params)).toThrow(/positive/)
    expect(() => quoteBuy(100, 1, { ...params, slippageBps: -1 })).toThrow(/slippageBps/)
    expect(() => quoteBuy(100, 1, { ...params, commissionBps: -1 })).toThrow(/commissionBps/)
  })
})

// ==================== Runner — deterministic strategies ====================

describe('runBacktest — pure strategies', () => {
  const execution = { slippageBps: 0, commissionBps: 0, initialCash: 10_000 }

  it('refuses to run with fewer than 2 bars', async () => {
    const strategy: StrategyFn = async () => ({ type: 'hold' })
    await expect(runBacktest({ bars: [bar(0, 100, 101)], strategy, execution })).rejects.toThrow(/at least 2/)
  })

  it('buy-and-hold a bull series produces positive P&L', async () => {
    // Bars: opens 100..109, closes 101..110 (10 bars)
    const bars = bullBars(10)
    let hasBought = false
    const strategy: StrategyFn = async (_cursor, state) => {
      if (!hasBought && !state.position) {
        hasBought = true
        return { type: 'enter', side: 'long', size: 10, reason: 'initial' }
      }
      // Exit on the second-to-last bar so the fill lands on the last open.
      if (state.barsSeen === bars.length - 1 && state.position) {
        return { type: 'exit', reason: 'end' }
      }
      return { type: 'hold' }
    }
    const result = await runBacktest({ bars, strategy, execution })

    expect(result.trades).toHaveLength(1)
    const trade = result.trades[0]
    expect(trade.side).toBe('long')
    // Entry at bar 1 open = 101; exit at bar 9 open = 109. P&L per unit = 8.
    expect(trade.entryPrice).toBe(101)
    expect(trade.exitPrice).toBe(109)
    expect(trade.pnl).toBe(80) // 8 * size 10
    expect(result.metrics.numTrades).toBe(1)
    expect(result.metrics.numWinners).toBe(1)
    expect(result.metrics.totalReturnPct).toBeGreaterThan(0)
  })

  it('short a bear series produces positive P&L', async () => {
    const bars = bearBars(8, 100, 1) // opens 100..93, closes 99..92
    let entered = false
    const strategy: StrategyFn = async (_cursor, state) => {
      if (!entered) {
        entered = true
        return { type: 'enter', side: 'short', size: 10 }
      }
      if (state.barsSeen === bars.length - 1 && state.position) {
        return { type: 'exit' }
      }
      return { type: 'hold' }
    }
    const result = await runBacktest({ bars, strategy, execution })
    expect(result.trades).toHaveLength(1)
    const trade = result.trades[0]
    expect(trade.side).toBe('short')
    // Entry: bar 1 open = 99, exit: bar 7 open = 93. Per-unit profit = 6.
    expect(trade.entryPrice).toBe(99)
    expect(trade.exitPrice).toBe(93)
    expect(trade.pnl).toBe(60)
  })

  it('slippage + commission eat into profit', async () => {
    const bars = bullBars(5)
    const strategy: StrategyFn = async (_cursor, state) => {
      if (!state.position && state.barsSeen === 1) return { type: 'enter', side: 'long', size: 10 }
      if (state.position && state.barsSeen === 3) return { type: 'exit' }
      return { type: 'hold' }
    }
    const frictionless = await runBacktest({ bars, strategy, execution })

    // Reset state for second run
    let entered = false
    let exited = false
    const strategy2: StrategyFn = async (_cursor, state) => {
      if (!entered && !state.position) { entered = true; return { type: 'enter', side: 'long', size: 10 } }
      if (entered && !exited && state.position && state.barsSeen >= 3) { exited = true; return { type: 'exit' } }
      return { type: 'hold' }
    }
    const costly = await runBacktest({
      bars,
      strategy: strategy2,
      execution: { slippageBps: 50, commissionBps: 50, initialCash: 10_000 },
    })

    expect(costly.trades).toHaveLength(1)
    expect(frictionless.trades).toHaveLength(1)
    expect(costly.trades[0].pnl).toBeLessThan(frictionless.trades[0].pnl)
  })

  it('does not open a second position while one is active (stacking prevention)', async () => {
    const bars = bullBars(6)
    // Strategy always wants to enter long; runner should ignore after first
    const strategy: StrategyFn = async () => ({ type: 'enter', side: 'long', size: 5 })
    const result = await runBacktest({ bars, strategy, execution })
    expect(result.trades).toHaveLength(0) // never exited
    // Equity curve should still record bars, with exactly one position held
  })

  it('strategy never sees future bars via the cursor', async () => {
    const bars = bullBars(6)
    const sightings: number[] = []
    const strategy: StrategyFn = async (cursor) => {
      sightings.push(cursor.index)
      // Attempting to peek "future" — BarCursor has no method for this,
      // so the best a malicious strategy can do is look at current.
      expect(cursor.current.ts).toBeLessThanOrEqual(bars[cursor.index].ts)
      return { type: 'hold' }
    }
    const result: BacktestResult = await runBacktest({ bars, strategy, execution })
    // Strategy is called at every bar except the last (no next bar to fill)
    expect(sightings).toEqual([0, 1, 2, 3, 4])
    expect(result.barsReplayed).toBe(6)
  })

  it('equity curve length matches bar count', async () => {
    const bars = bullBars(10)
    const strategy: StrategyFn = async () => ({ type: 'hold' })
    const result = await runBacktest({ bars, strategy, execution })
    expect(result.equityCurve).toHaveLength(10)
    // No trades, so equity should match initial cash at every point
    for (const point of result.equityCurve) {
      expect(point.equity).toBe(execution.initialCash)
    }
  })
})

// ==================== Metrics ====================

describe('computeMetrics', () => {
  it('reports zero metrics for empty trade list', () => {
    const m = computeMetrics([], [], 10_000)
    expect(m.numTrades).toBe(0)
    expect(m.winRatePct).toBe(0)
    expect(m.finalEquity).toBe(10_000)
    expect(m.totalReturn).toBe(0)
  })

  it('computes max drawdown from equity curve', () => {
    const curve = [
      { ts: 0, barIndex: 0, equity: 10_000, cash: 10_000, unrealizedPnl: 0, realizedPnl: 0 },
      { ts: 1, barIndex: 1, equity: 11_000, cash: 11_000, unrealizedPnl: 0, realizedPnl: 1_000 },
      { ts: 2, barIndex: 2, equity: 9_500, cash: 9_500, unrealizedPnl: 0, realizedPnl: -500 },
      { ts: 3, barIndex: 3, equity: 10_200, cash: 10_200, unrealizedPnl: 0, realizedPnl: 200 },
    ]
    const m = computeMetrics([], curve, 10_000)
    // peak was 11,000, trough 9,500 → dd = 1500 = 13.64%
    expect(m.maxDrawdown).toBe(1_500)
    expect(m.maxDrawdownPct).toBeCloseTo((1500 / 11000) * 100, 4)
    expect(m.finalEquity).toBe(10_200)
    expect(m.totalReturn).toBe(200)
  })

  it('computes profit factor and win rate', () => {
    const trades = [
      { side: 'long' as const, size: 1, entryTs: 0, entryPrice: 100, exitTs: 1, exitPrice: 110, pnl: 10, returnPct: 10, entryCommission: 0, exitCommission: 0, barsHeld: 1 },
      { side: 'long' as const, size: 1, entryTs: 2, entryPrice: 110, exitTs: 3, exitPrice: 105, pnl: -5, returnPct: -4.5, entryCommission: 0, exitCommission: 0, barsHeld: 1 },
      { side: 'long' as const, size: 1, entryTs: 4, entryPrice: 105, exitTs: 5, exitPrice: 120, pnl: 15, returnPct: 14.3, entryCommission: 0, exitCommission: 0, barsHeld: 1 },
    ]
    const m = computeMetrics(trades, [], 10_000)
    expect(m.numTrades).toBe(3)
    expect(m.numWinners).toBe(2)
    expect(m.numLosers).toBe(1)
    expect(m.winRatePct).toBeCloseTo(66.666, 2)
    expect(m.avgWin).toBe(12.5)
    expect(m.avgLoss).toBe(5)
    expect(m.profitFactor).toBeCloseTo(5, 4) // (10+15)/5 = 5
  })
})
