/**
 * Performance metrics — computed once at the end of a run.
 *
 * Kept intentionally minimal. Sharpe, Sortino, Calmar etc. can be
 * added later — the MVP reports total return, max drawdown, win
 * rate, and profit factor, which is enough to tell "obviously bad"
 * from "possibly interesting" at a glance.
 */

import type { BacktestMetrics, ClosedTrade, EquityPoint } from './types.js'

export function computeMetrics(
  trades: ClosedTrade[],
  equityCurve: EquityPoint[],
  initialCash: number,
): BacktestMetrics {
  const finalEquity = equityCurve.length > 0
    ? equityCurve[equityCurve.length - 1].equity
    : initialCash

  const totalReturn = finalEquity - initialCash
  const totalReturnPct = (totalReturn / initialCash) * 100

  // Max drawdown — walk equity curve, track running peak.
  let peak = initialCash
  let maxDd = 0
  let maxDdPct = 0
  for (const point of equityCurve) {
    if (point.equity > peak) peak = point.equity
    const dd = peak - point.equity
    const ddPct = peak > 0 ? (dd / peak) * 100 : 0
    if (dd > maxDd) maxDd = dd
    if (ddPct > maxDdPct) maxDdPct = ddPct
  }

  const winners = trades.filter((t) => t.pnl > 0)
  const losers = trades.filter((t) => t.pnl < 0)
  const numTrades = trades.length
  const numWinners = winners.length
  const numLosers = losers.length
  const winRatePct = numTrades > 0 ? (numWinners / numTrades) * 100 : 0

  const sumWins = winners.reduce((s, t) => s + t.pnl, 0)
  const sumLosses = Math.abs(losers.reduce((s, t) => s + t.pnl, 0))
  const avgWin = numWinners > 0 ? sumWins / numWinners : 0
  const avgLoss = numLosers > 0 ? sumLosses / numLosers : 0
  const profitFactor = sumLosses > 0 ? sumWins / sumLosses : (sumWins > 0 ? Infinity : 0)

  return {
    totalReturn,
    totalReturnPct,
    maxDrawdown: maxDd,
    maxDrawdownPct: maxDdPct,
    numTrades,
    numWinners,
    numLosers,
    winRatePct,
    avgWin,
    avgLoss,
    profitFactor,
    finalEquity,
  }
}
