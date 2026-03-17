/**
 * Backtester — Core engine
 *
 * Iterates candles chronologically, evaluates entry/exit DSL,
 * simulates trade execution with slippage and commissions,
 * and produces performance metrics.
 */

import type {
  Candle, StrategyDef, BacktestOptions,
  BacktestResult, TradeEntry, BacktestMetrics, EquityCurvePoint,
} from './types.js'
import { evaluateExpression } from './dsl.js'
import { computeIndicatorSeries, type IndicatorSeries } from './indicators.js'

interface OpenPosition {
  entry_time: number
  entry_price: number
  size: number
  direction: 'long' | 'short'
  entry_commission: number
}

const DEFAULT_SLIPPAGE_BPS = 5
const DEFAULT_COMMISSION_PCT = 0.001
const DEFAULT_LEVERAGE = 1

function resolvedOptions(opts: BacktestOptions) {
  return {
    capital: opts.capital,
    slippage_bps: opts.slippage_bps ?? DEFAULT_SLIPPAGE_BPS,
    commission_pct: opts.commission_pct ?? DEFAULT_COMMISSION_PCT,
    leverage: opts.leverage ?? DEFAULT_LEVERAGE,
  }
}

function applySlippage(price: number, bps: number, isBuy: boolean): number {
  const factor = bps / 10000
  return isBuy ? price * (1 + factor) : price * (1 - factor)
}

function buildContext(
  candle: Candle,
  indicatorSeries: IndicatorSeries,
  idx: number,
  position: OpenPosition | null,
  strategy: StrategyDef,
): Record<string, number | boolean> {
  const ctx: Record<string, number | boolean> = {
    open: candle.open,
    high: candle.high,
    low: candle.low,
    close: candle.close,
    volume: candle.volume,
    position_open: position !== null,
    stop_loss_hit: false,
    take_profit_hit: false,
  }

  // Inject strategy parameters so DSL can reference them (e.g., rsi_oversold)
  for (const [name, value] of Object.entries(strategy.parameters)) {
    ctx[name] = value
  }

  // Populate indicator values at this candle index
  for (const [name, values] of Object.entries(indicatorSeries)) {
    ctx[name] = values[idx]
  }

  // Compute stop_loss_hit / take_profit_hit
  if (position) {
    const unrealizedPct = position.direction === 'long'
      ? (candle.close - position.entry_price) / position.entry_price
      : (position.entry_price - candle.close) / position.entry_price

    if (strategy.parameters.stop_loss_pct !== undefined) {
      ctx.stop_loss_hit = unrealizedPct <= -Math.abs(strategy.parameters.stop_loss_pct)
    }
    if (strategy.parameters.take_profit_pct !== undefined) {
      ctx.take_profit_hit = unrealizedPct >= Math.abs(strategy.parameters.take_profit_pct)
    }
  }

  return ctx
}

function hasWarmUp(indicatorSeries: IndicatorSeries, idx: number): boolean {
  for (const values of Object.values(indicatorSeries)) {
    if (isNaN(values[idx])) return false
  }
  return true
}

function computeMetrics(
  trades: TradeEntry[],
  equityCurve: EquityCurvePoint[],
  capital: number,
  timeframeHours: number,
): BacktestMetrics {
  const totalTrades = trades.length

  if (totalTrades === 0) {
    return { total_return: 0, sharpe_ratio: 0, max_drawdown: 0, win_rate: 0, profit_factor: 0, total_trades: 0 }
  }

  const finalEquity = equityCurve[equityCurve.length - 1]?.value ?? capital
  const totalReturn = (finalEquity - capital) / capital

  const wins = trades.filter(t => t.win)
  const winRate = wins.length / totalTrades

  const grossProfit = trades.filter(t => t.pnl > 0).reduce((s, t) => s + t.pnl, 0)
  const grossLoss = Math.abs(trades.filter(t => t.pnl < 0).reduce((s, t) => s + t.pnl, 0))
  const profitFactor = grossLoss === 0 ? (grossProfit > 0 ? Infinity : 0) : grossProfit / grossLoss

  // Max drawdown from equity curve
  let peak = capital
  let maxDrawdown = 0
  for (const pt of equityCurve) {
    if (pt.value > peak) peak = pt.value
    const dd = (peak - pt.value) / peak
    if (dd > maxDrawdown) maxDrawdown = dd
  }

  // Annualized Sharpe ratio from per-trade returns
  const returns = trades.map(t => t.pnl_pct)
  const meanReturn = returns.reduce((s, r) => s + r, 0) / returns.length
  const variance = returns.reduce((s, r) => s + (r - meanReturn) ** 2, 0) / returns.length
  const stdReturn = Math.sqrt(variance)

  // Annualization factor: estimate trades per year based on timeframe
  const hoursPerYear = 365.25 * 24
  const periodsPerYear = hoursPerYear / Math.max(timeframeHours, 1)
  const annualizationFactor = Math.sqrt(periodsPerYear / Math.max(totalTrades, 1) * totalTrades)

  const sharpeRatio = stdReturn === 0 ? 0 : (meanReturn / stdReturn) * annualizationFactor

  return { total_return: totalReturn, sharpe_ratio: sharpeRatio, max_drawdown: maxDrawdown, win_rate: winRate, profit_factor: profitFactor, total_trades: totalTrades }
}

function timeframeToHours(tf: string): number {
  const match = tf.match(/^(\d+)([mhd])$/)
  if (!match) return 24
  const n = parseInt(match[1])
  switch (match[2]) {
    case 'm': return n / 60
    case 'h': return n
    case 'd': return n * 24
    default: return 24
  }
}

export function runBacktest(
  strategy: StrategyDef,
  options: BacktestOptions,
  candles: Candle[],
): BacktestResult {
  const opts = resolvedOptions(options)
  const direction = strategy.direction ?? 'long'
  const positionSizeFrac = strategy.parameters.position_size ?? 1

  // Compute indicator series for all expressions
  const indicatorSeries = computeIndicatorSeries(candles, [strategy.entry_logic, strategy.exit_logic])

  const trades: TradeEntry[] = []
  const equityCurve: EquityCurvePoint[] = []

  let equity = opts.capital
  let position: OpenPosition | null = null

  for (let i = 0; i < candles.length; i++) {
    const candle = candles[i]

    // Skip if indicators not ready
    if (!hasWarmUp(indicatorSeries, i)) {
      equityCurve.push({ timestamp: candle.timestamp, value: equity })
      continue
    }

    const ctx = buildContext(candle, indicatorSeries, i, position, strategy)

    if (!position) {
      // Check entry
      let shouldEnter = false
      try { shouldEnter = evaluateExpression(strategy.entry_logic, ctx) } catch { /* skip */ }

      if (shouldEnter) {
        const dir: 'long' | 'short' = direction === 'both' ? 'long' : direction
        const isBuy = dir === 'long'
        const fillPrice = applySlippage(candle.close, opts.slippage_bps, isBuy)
        const tradeValue = equity * positionSizeFrac * opts.leverage
        const size = tradeValue / fillPrice
        const commission = Math.abs(tradeValue) * opts.commission_pct

        position = {
          entry_time: candle.timestamp,
          entry_price: fillPrice,
          size,
          direction: dir,
          entry_commission: commission,
        }
      }
    } else {
      // Check exit
      let shouldExit = false
      try { shouldExit = evaluateExpression(strategy.exit_logic, ctx) } catch { /* skip */ }

      if (shouldExit) {
        const isBuy = position.direction === 'short'
        const fillPrice = applySlippage(candle.close, opts.slippage_bps, isBuy)
        const exitValue = position.size * fillPrice
        const exitCommission = Math.abs(exitValue) * opts.commission_pct

        const grossPnl = position.direction === 'long'
          ? (fillPrice - position.entry_price) * position.size
          : (position.entry_price - fillPrice) * position.size
        const netPnl = grossPnl - position.entry_commission - exitCommission
        const pnlPct = netPnl / (position.entry_price * position.size)

        trades.push({
          entry_time: position.entry_time,
          exit_time: candle.timestamp,
          entry_price: position.entry_price,
          exit_price: fillPrice,
          size: position.size,
          pnl: netPnl,
          pnl_pct: pnlPct,
          win: netPnl > 0,
          direction: position.direction,
        })

        equity += netPnl
        position = null
      }
    }

    // Track unrealized equity
    if (position) {
      const unrealized = position.direction === 'long'
        ? (candle.close - position.entry_price) * position.size
        : (position.entry_price - candle.close) * position.size
      equityCurve.push({ timestamp: candle.timestamp, value: equity + unrealized })
    } else {
      equityCurve.push({ timestamp: candle.timestamp, value: equity })
    }
  }

  const tfHours = timeframeToHours(strategy.timeframe)
  const metrics = computeMetrics(trades, equityCurve, opts.capital, tfHours)

  return {
    strategy,
    options,
    trades,
    metrics,
    equity_curve: equityCurve,
    candle_count: candles.length,
    start_timestamp: candles[0]?.timestamp ?? 0,
    end_timestamp: candles[candles.length - 1]?.timestamp ?? 0,
  }
}
