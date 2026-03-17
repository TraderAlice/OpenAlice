/**
 * Backtester — File I/O
 *
 * Persists backtest results as JSONL trade logs and JSON summaries
 * under data/backtests/. Provides listing and reading functions.
 */

import { writeFile, readFile, readdir, mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { BacktestResult } from './types.js'

const BACKTESTS_DIR = resolve('data/backtests')

async function ensureDir(): Promise<void> {
  await mkdir(BACKTESTS_DIR, { recursive: true })
}

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
}

export interface WriteResult {
  summaryPath: string
  resultsPath: string
}

export async function writeBacktestResults(result: BacktestResult): Promise<WriteResult> {
  await ensureDir()

  const ts = timestamp()
  const name = result.strategy.name.replace(/[^a-zA-Z0-9_-]/g, '_')
  const summaryPath = resolve(BACKTESTS_DIR, `${name}_${ts}_summary.json`)
  const resultsPath = resolve(BACKTESTS_DIR, `${name}_${ts}_results.jsonl`)

  const summary = {
    strategy: result.strategy,
    options: result.options,
    metrics: result.metrics,
    candle_count: result.candle_count,
    start_timestamp: result.start_timestamp,
    end_timestamp: result.end_timestamp,
    trade_count: result.trades.length,
    equity_curve_length: result.equity_curve.length,
  }

  await writeFile(summaryPath, JSON.stringify(summary, null, 2) + '\n')

  const lines = result.trades.map(t => JSON.stringify(t))
  await writeFile(resultsPath, lines.join('\n') + (lines.length > 0 ? '\n' : ''))

  return { summaryPath, resultsPath }
}

export interface BacktestListEntry {
  name: string
  filename: string
  timestamp: string
}

export async function listBacktests(): Promise<BacktestListEntry[]> {
  await ensureDir()

  const files = await readdir(BACKTESTS_DIR)
  const summaries = files
    .filter(f => f.endsWith('_summary.json'))
    .sort()
    .reverse()

  return summaries.map(f => {
    const match = f.match(/^(.+?)_(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2})_summary\.json$/)
    return {
      name: match?.[1] ?? f,
      filename: f,
      timestamp: match?.[2]?.replace(/-/g, (m, offset) => offset > 9 ? ':' : '-') ?? '',
    }
  })
}

export async function readBacktestSummary(filename: string): Promise<Record<string, unknown>> {
  const filePath = resolve(BACKTESTS_DIR, filename)
  const raw = await readFile(filePath, 'utf-8')
  return JSON.parse(raw)
}
