/**
 * Backtest domain — minute-level replay engine.
 *
 * Usage:
 *   const result = await runBacktest({
 *     bars,
 *     strategy: someStrategyFn,
 *     execution: { slippageBps: 5, commissionBps: 10, initialCash: 100_000 },
 *   })
 *   console.log(result.metrics)
 *
 * Strategies never see the full bar array — they only see a BarCursor
 * that enforces strict temporal access. See types.ts for the full
 * design rationale.
 */

export { runBacktest } from './runner.js'
export type { BacktestOpts } from './runner.js'
export { BarCursorImpl } from './cursor.js'
export { quoteBuy, quoteSell } from './execution.js'
export type { FillQuote } from './execution.js'
export { computeMetrics } from './metrics.js'
export { createCouncilStrategy } from './council-strategy.js'
export type { CouncilStrategyOpts } from './council-strategy.js'
export type {
  Bar,
  BarCursor,
  StrategyAction,
  StrategyFn,
  StrategyState,
  OpenPosition,
  ClosedTrade,
  ExecutionParams,
  EquityPoint,
  BacktestMetrics,
  BacktestResult,
} from './types.js'
