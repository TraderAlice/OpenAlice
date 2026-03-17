/**
 * Backtester — Parameter Grid Search
 *
 * Generates cartesian product of parameter ranges, runs the core engine
 * for each combination, and ranks results by Sharpe ratio.
 */

import { writeFile, mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import type {
  Candle, StrategyDef, BacktestOptions,
  ParameterRanges, SweepResult, SweepResultEntry,
} from './types.js'
import { runBacktest } from './engine.js'

const BACKTESTS_DIR = resolve('data/backtests')
const MAX_CONCURRENCY = 8

function cartesianProduct(ranges: ParameterRanges): Record<string, number>[] {
  const keys = Object.keys(ranges)
  if (keys.length === 0) return []

  const combos: Record<string, number>[] = [{}]
  for (const key of keys) {
    const values = ranges[key]
    const expanded: Record<string, number>[] = []
    for (const combo of combos) {
      for (const val of values) {
        expanded.push({ ...combo, [key]: val })
      }
    }
    combos.length = 0
    combos.push(...expanded)
  }
  return combos
}

async function runWithConcurrency<T>(
  tasks: (() => Promise<T>)[],
  limit: number,
): Promise<T[]> {
  const results: T[] = new Array(tasks.length)
  let idx = 0

  async function worker() {
    while (idx < tasks.length) {
      const i = idx++
      results[i] = await tasks[i]()
    }
  }

  const workers = Array.from({ length: Math.min(limit, tasks.length) }, () => worker())
  await Promise.all(workers)
  return results
}

export function runParameterSweep(
  baseStrategy: StrategyDef,
  parameterRanges: ParameterRanges,
  options: BacktestOptions,
  candles: Candle[],
): SweepResult {
  const start = Date.now()

  // Validate ranges
  const keys = Object.keys(parameterRanges)
  if (keys.length === 0) {
    throw new Error('parameter_ranges must not be empty')
  }
  for (const key of keys) {
    if (!parameterRanges[key] || parameterRanges[key].length === 0) {
      throw new Error(`parameter_ranges["${key}"] must not be empty`)
    }
  }

  const combos = cartesianProduct(parameterRanges)
  const entries: SweepResultEntry[] = []

  for (const params of combos) {
    const strategy: StrategyDef = {
      ...baseStrategy,
      parameters: { ...baseStrategy.parameters, ...params },
    }
    const result = runBacktest(strategy, options, candles)
    entries.push({ parameters: { ...baseStrategy.parameters, ...params }, metrics: result.metrics })
  }

  // Rank by Sharpe descending
  entries.sort((a, b) => b.metrics.sharpe_ratio - a.metrics.sharpe_ratio)

  return {
    strategy_name: baseStrategy.name,
    ranked: entries,
    best: entries[0],
    total_combinations: entries.length,
    runtime_ms: Date.now() - start,
  }
}

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
}

export async function writeSweepResults(result: SweepResult): Promise<string> {
  await mkdir(BACKTESTS_DIR, { recursive: true })
  const name = result.strategy_name.replace(/[^a-zA-Z0-9_-]/g, '_')
  const filePath = resolve(BACKTESTS_DIR, `${name}_sweep_${timestamp()}.json`)
  await writeFile(filePath, JSON.stringify(result, null, 2) + '\n')
  return filePath
}
