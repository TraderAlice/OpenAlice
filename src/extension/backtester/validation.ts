/**
 * Backtester — Walk-Forward Validation
 *
 * Splits data into rolling train/test windows. For each window,
 * runs parameter sweep on training data, picks best params by Sharpe,
 * validates on test data, and reports overfitting metrics.
 */

import type {
  Candle, StrategyDef, BacktestOptions,
  ParameterRanges, WalkForwardResult, WalkForwardWindow,
} from './types.js'
import { runParameterSweep } from './sweep.js'
import { runBacktest } from './engine.js'

export interface WalkForwardOptions {
  windows: number
  train_pct: number
}

const DEFAULT_WINDOWS = 5
const DEFAULT_TRAIN_PCT = 0.7

function splitWindows(
  candles: Candle[],
  numWindows: number,
  trainPct: number,
): Array<{ train: Candle[]; test: Candle[]; trainStart: number; trainEnd: number; testStart: number; testEnd: number }> {
  const total = candles.length
  const windowSize = Math.floor(total / numWindows)
  if (windowSize < 20) {
    throw new Error(`Not enough candles (${total}) for ${numWindows} windows (need at least 20 per window)`)
  }

  const results: Array<{ train: Candle[]; test: Candle[]; trainStart: number; trainEnd: number; testStart: number; testEnd: number }> = []

  for (let w = 0; w < numWindows; w++) {
    const start = w * windowSize
    const end = w === numWindows - 1 ? total : start + windowSize
    const windowCandles = candles.slice(start, end)
    const splitIdx = Math.floor(windowCandles.length * trainPct)

    const train = windowCandles.slice(0, splitIdx)
    const test = windowCandles.slice(splitIdx)

    results.push({
      train,
      test,
      trainStart: train[0]?.timestamp ?? 0,
      trainEnd: train[train.length - 1]?.timestamp ?? 0,
      testStart: test[0]?.timestamp ?? 0,
      testEnd: test[test.length - 1]?.timestamp ?? 0,
    })
  }

  return results
}

export function runWalkForward(
  baseStrategy: StrategyDef,
  parameterRanges: ParameterRanges,
  options: BacktestOptions,
  candles: Candle[],
  wfOptions?: Partial<WalkForwardOptions>,
): WalkForwardResult {
  const start = Date.now()
  const numWindows = wfOptions?.windows ?? DEFAULT_WINDOWS
  const trainPct = wfOptions?.train_pct ?? DEFAULT_TRAIN_PCT

  const windowSplits = splitWindows(candles, numWindows, trainPct)
  const windows: WalkForwardWindow[] = []

  for (let w = 0; w < windowSplits.length; w++) {
    const { train, test, trainStart, trainEnd, testStart, testEnd } = windowSplits[w]

    // Optimize on training data
    const sweepResult = runParameterSweep(baseStrategy, parameterRanges, options, train)
    const bestParams = sweepResult.best.parameters
    const inSample = sweepResult.best.metrics

    // Validate on test data with best params
    const testStrategy: StrategyDef = {
      ...baseStrategy,
      parameters: bestParams,
    }
    const testResult = runBacktest(testStrategy, options, test)

    windows.push({
      window_index: w,
      train_start: trainStart,
      train_end: trainEnd,
      test_start: testStart,
      test_end: testEnd,
      best_params: bestParams,
      in_sample: inSample,
      out_of_sample: testResult.metrics,
    })
  }

  // Aggregate metrics
  const avgOosSharpe = windows.reduce((s, w) => s + w.out_of_sample.sharpe_ratio, 0) / windows.length
  const avgOosReturn = windows.reduce((s, w) => s + w.out_of_sample.total_return, 0) / windows.length
  const avgOosDrawdown = windows.reduce((s, w) => s + w.out_of_sample.max_drawdown, 0) / windows.length
  const avgIsSharpe = windows.reduce((s, w) => s + w.in_sample.sharpe_ratio, 0) / windows.length

  // Overfitting score: OOS/IS Sharpe. < 0.5 = likely overfit
  const overfittingScore = avgIsSharpe === 0 ? 0 : avgOosSharpe / avgIsSharpe

  return {
    strategy_name: baseStrategy.name,
    windows,
    aggregate: {
      avg_oos_sharpe: avgOosSharpe,
      avg_oos_return: avgOosReturn,
      avg_oos_drawdown: avgOosDrawdown,
      overfitting_score: overfittingScore,
      overfitting_flag: overfittingScore < 0.5,
    },
    total_windows: windows.length,
    runtime_ms: Date.now() - start,
  }
}
