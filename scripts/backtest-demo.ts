/**
 * Backtest demo — runs a simple MA-crossover strategy on synthetic
 * minute bars end-to-end through the engine, then writes a readable
 * report to reports/backtest-demo.md.
 *
 * This is NOT a claim that MA crossover works on anything real. The
 * point is to exercise every part of the engine (cursor, execution
 * model, position tracking, metrics) on a full run and produce a
 * concrete set of numbers so a reviewer can see the pipeline works.
 *
 * Data is synthetic on purpose — reproducible, no API dependency.
 * For the council-in-the-loop case, see scripts/council-demo.ts.
 */

import { writeFile, mkdir } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { runBacktest } from '../src/domain/backtest/index.js'
import type { Bar, StrategyFn, BacktestResult } from '../src/domain/backtest/index.js'

// ==================== Synthetic bar generator ====================

/**
 * Generate minute bars from a price process:
 *   price(t) = 100 + 10*sin(2πt / 120) + 0.05*t + 0.4*noise(t)
 * i.e. a sine-wave cycle (period 120 bars) on top of a mild upward
 * drift, with bounded noise. Deterministic — uses a mulberry32 PRNG
 * seeded from the input, so the demo output is reproducible.
 */
function syntheticBars(n: number, seed = 42): Bar[] {
  const rand = mulberry32(seed)
  const bars: Bar[] = []
  let prevClose = 100
  for (let i = 0; i < n; i++) {
    const base = 100 + 10 * Math.sin((2 * Math.PI * i) / 120) + 0.05 * i
    const noise = (rand() - 0.5) * 0.8
    const close = base + noise
    const open = prevClose
    const hi = Math.max(open, close) + rand() * 0.3
    const lo = Math.min(open, close) - rand() * 0.3
    bars.push({
      ts: 1_700_000_000_000 + i * 60_000,
      open,
      high: hi,
      low: lo,
      close,
      volume: 500 + Math.floor(rand() * 1000),
    })
    prevClose = close
  }
  return bars
}

function mulberry32(seed: number): () => number {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = seed
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296
  }
}

// ==================== Strategy: simple MA crossover ====================

function sma(values: number[]): number {
  if (values.length === 0) return NaN
  let s = 0
  for (const v of values) s += v
  return s / values.length
}

/**
 * Classic 10/30 SMA crossover:
 *   - Go long when fast MA crosses above slow MA.
 *   - Exit when fast MA crosses back below slow MA.
 *   - No shorting — kept simple to make the result easy to reason about.
 */
function createMaCrossoverStrategy(fastLen = 10, slowLen = 30): StrategyFn {
  let prevFastAbove = false
  let primed = false

  return async (cursor, state) => {
    if (cursor.index < slowLen) return { type: 'hold' } // not enough history

    const fastCloses = cursor.lastN(fastLen).map((b) => b.close)
    const slowCloses = cursor.lastN(slowLen).map((b) => b.close)
    const fast = sma(fastCloses)
    const slow = sma(slowCloses)
    const fastAbove = fast > slow

    if (!primed) {
      prevFastAbove = fastAbove
      primed = true
      return { type: 'hold' }
    }

    const crossedUp = fastAbove && !prevFastAbove
    const crossedDown = !fastAbove && prevFastAbove
    prevFastAbove = fastAbove

    if (crossedUp && !state.position) {
      return { type: 'enter', side: 'long', size: 50, reason: `fast(${fastLen})>slow(${slowLen})` }
    }
    if (crossedDown && state.position?.side === 'long') {
      return { type: 'exit', reason: `fast(${fastLen})<slow(${slowLen})` }
    }
    return { type: 'hold' }
  }
}

// ==================== Runner ====================

async function main() {
  const bars = syntheticBars(600) // 10 hours of minute bars
  console.log(`Generated ${bars.length} synthetic bars`)
  console.log(`First close: ${bars[0].close.toFixed(2)}, last close: ${bars[bars.length - 1].close.toFixed(2)}`)
  console.log('')

  // ---------- Run 1: zero friction ----------
  console.log('Run 1 — frictionless (slippage=0, commission=0)')
  const r1 = await runBacktest({
    bars,
    strategy: createMaCrossoverStrategy(10, 30),
    execution: { slippageBps: 0, commissionBps: 0, initialCash: 100_000 },
  })
  printResult(r1)

  // ---------- Run 2: realistic costs ----------
  console.log('')
  console.log('Run 2 — realistic costs (slippage=5bps, commission=10bps)')
  const r2 = await runBacktest({
    bars,
    strategy: createMaCrossoverStrategy(10, 30),
    execution: { slippageBps: 5, commissionBps: 10, initialCash: 100_000 },
  })
  printResult(r2)

  // ---------- Report ----------
  await writeReport(bars, r1, r2)
  console.log('')
  console.log('Report written to reports/backtest-demo.md')
}

function printResult(r: BacktestResult) {
  const m = r.metrics
  console.log(`  bars replayed:    ${r.barsReplayed}`)
  console.log(`  elapsed:          ${r.elapsedMs}ms`)
  console.log(`  trades:           ${m.numTrades}  (${m.numWinners}W / ${m.numLosers}L, ${m.winRatePct.toFixed(1)}% win rate)`)
  console.log(`  total return:     ${m.totalReturn.toFixed(2)}  (${m.totalReturnPct.toFixed(2)}%)`)
  console.log(`  max drawdown:     ${m.maxDrawdown.toFixed(2)}  (${m.maxDrawdownPct.toFixed(2)}%)`)
  console.log(`  avg win / loss:   ${m.avgWin.toFixed(2)} / ${m.avgLoss.toFixed(2)}`)
  console.log(`  profit factor:    ${m.profitFactor === Infinity ? '∞' : m.profitFactor.toFixed(2)}`)
  console.log(`  final equity:     ${m.finalEquity.toFixed(2)}`)
}

// ==================== Report writer ====================

async function writeReport(bars: Bar[], r1: BacktestResult, r2: BacktestResult) {
  const lines: string[] = []
  lines.push('# Backtest Demo — MA crossover on synthetic minute bars')
  lines.push('')
  lines.push(`Generated by \`scripts/backtest-demo.ts\` on ${new Date().toISOString()}`)
  lines.push('')
  lines.push('## Setup')
  lines.push('')
  lines.push(`- Bars: **${bars.length}** synthetic minute bars`)
  lines.push(`- Price process: \`100 + 10*sin(2πt/120) + 0.05*t + noise\` (deterministic PRNG, seed=42)`)
  lines.push(`- Strategy: 10/30 SMA crossover, long-only, fixed size 50, flat at end`)
  lines.push(`- Initial cash: 100,000`)
  lines.push('')
  lines.push('**Purpose of this demo.** Exercise every part of the backtest engine')
  lines.push('(BarCursor → strategy → execution model → equity tracking → metrics)')
  lines.push('on a complete run. This is **not** a claim that MA crossover has edge.')
  lines.push('The value is reproducing a full set of numbers that moves in the expected')
  lines.push('direction when slippage/commission are introduced.')
  lines.push('')
  lines.push('## Results')
  lines.push('')
  lines.push('| Metric | Frictionless | With costs (5/10 bps) | Δ |')
  lines.push('|---|---:|---:|---:|')
  lines.push(row('Trades', r1.metrics.numTrades, r2.metrics.numTrades))
  lines.push(row('Win rate %', r1.metrics.winRatePct, r2.metrics.winRatePct, 2))
  lines.push(row('Total return', r1.metrics.totalReturn, r2.metrics.totalReturn, 2))
  lines.push(row('Total return %', r1.metrics.totalReturnPct, r2.metrics.totalReturnPct, 3))
  lines.push(row('Max drawdown', r1.metrics.maxDrawdown, r2.metrics.maxDrawdown, 2))
  lines.push(row('Max DD %', r1.metrics.maxDrawdownPct, r2.metrics.maxDrawdownPct, 3))
  lines.push(row('Profit factor', r1.metrics.profitFactor, r2.metrics.profitFactor, 2))
  lines.push(row('Final equity', r1.metrics.finalEquity, r2.metrics.finalEquity, 2))
  lines.push('')
  lines.push('**Observation:** adding 5 bps slippage + 10 bps commission per leg drops')
  lines.push('the P&L by a meaningful amount — exactly what you want from an honest')
  lines.push('backtest engine. The strategy is the same, the only change is the cost')
  lines.push('parameters, so the delta is purely friction.')
  lines.push('')

  lines.push('## Sample trades (run 2)')
  lines.push('')
  lines.push('| # | side | entry ts | entry px | exit px | P&L | bars held |')
  lines.push('|---|---|---|---:|---:|---:|---:|')
  for (const [idx, t] of r2.trades.entries()) {
    if (idx >= 10) break
    const entryT = new Date(t.entryTs).toISOString().replace('T', ' ').slice(0, 19)
    lines.push(`| ${idx + 1} | ${t.side} | ${entryT} | ${t.entryPrice.toFixed(2)} | ${t.exitPrice.toFixed(2)} | ${t.pnl.toFixed(2)} | ${t.barsHeld} |`)
  }
  if (r2.trades.length > 10) lines.push(`| … | | _${r2.trades.length - 10} more_ | | | | |`)
  lines.push('')

  lines.push('## Equity curve sample (run 2)')
  lines.push('')
  lines.push('| bar | ts | cash | unrealized | realized | equity |')
  lines.push('|---:|---|---:|---:|---:|---:|')
  const step = Math.max(1, Math.floor(r2.equityCurve.length / 12))
  for (let i = 0; i < r2.equityCurve.length; i += step) {
    const p = r2.equityCurve[i]
    const ts = new Date(p.ts).toISOString().slice(11, 19)
    lines.push(`| ${p.barIndex} | ${ts} | ${p.cash.toFixed(2)} | ${p.unrealizedPnl.toFixed(2)} | ${p.realizedPnl.toFixed(2)} | ${p.equity.toFixed(2)} |`)
  }

  const reportPath = resolve('reports/backtest-demo.md')
  await mkdir(dirname(reportPath), { recursive: true })
  await writeFile(reportPath, lines.join('\n') + '\n')
}

function row(label: string, a: number, b: number, digits = 0): string {
  const delta = b - a
  const fmt = (v: number) => Number.isFinite(v) ? v.toFixed(digits) : '∞'
  return `| ${label} | ${fmt(a)} | ${fmt(b)} | ${delta >= 0 ? '+' : ''}${fmt(delta)} |`
}

main().catch((err) => {
  console.error('backtest demo failed:', err)
  process.exit(1)
})
