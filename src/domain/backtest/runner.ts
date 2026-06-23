/**
 * BacktestRunner — cursor-driven replay loop.
 *
 * The loop: for each bar i (from 0 to N-1):
 *   1. Mark-to-market: update equity based on the close of bar i
 *      (so any open position sees its current P&L).
 *   2. Ask the strategy what to do, giving it the cursor at index i.
 *      The strategy can only see bars ≤ i (BarCursor enforces this).
 *   3. If the strategy emitted an order, queue it for fill at the
 *      NEXT bar's open (i+1). This is the realistic no-cheat path.
 *   4. Advance cursor, fill any queued order at the open of i+1.
 *   5. Append an equity-curve point for bookkeeping.
 *
 * The runner handles only single-symbol, single-position backtests.
 * A new position cannot be opened while one is already open — the
 * strategy must explicitly `exit` first. This matches how UTA guard
 * pipelines treat position limits and avoids the classic "pyramid
 * into a loser" bug.
 */

import type {
  Bar,
  BacktestResult,
  ClosedTrade,
  EquityPoint,
  ExecutionParams,
  OpenPosition,
  StrategyAction,
  StrategyFn,
} from './types.js'
import { BarCursorImpl } from './cursor.js'
import { quoteBuy, quoteSell } from './execution.js'
import { computeMetrics } from './metrics.js'

export interface BacktestOpts {
  bars: readonly Bar[]
  strategy: StrategyFn
  execution: ExecutionParams
}

export async function runBacktest(opts: BacktestOpts): Promise<BacktestResult> {
  const { bars, strategy, execution } = opts
  if (bars.length < 2) {
    throw new Error(`runBacktest: need at least 2 bars (got ${bars.length})`)
  }

  const start = Date.now()
  const cursor = new BarCursorImpl(bars)

  let cash = execution.initialCash
  let position: OpenPosition | null = null
  let realizedPnl = 0
  const trades: ClosedTrade[] = []
  const equityCurve: EquityPoint[] = []

  // Pending action emitted at bar i, to be filled at open of i+1.
  let pending: StrategyAction | null = null

  // Walk bars 0 .. N-2. The last bar cannot carry a pending order
  // because there is no next bar to fill it against; any order
  // emitted on the last bar is silently dropped.
  const lastIndex = bars.length - 1

  for (let i = 0; i <= lastIndex; i++) {
    const bar = bars[i]

    // ---------- 1. Fill pending order from previous bar (at this bar's open) ----------
    if (pending) {
      applyPending(pending, bar, {
        state: () => ({
          getPosition: () => position,
          setPosition: (p) => { position = p },
          getCash: () => cash,
          setCash: (c) => { cash = c },
          pushTrade: (t) => {
            trades.push(t)
            realizedPnl += t.pnl
          },
        }),
        execution,
        barIndex: i,
      })
      pending = null
    }

    // ---------- 2. Mark-to-market at close, record equity ----------
    const unrealized = position ? markToMarket(position, bar.close) : 0
    const equity = markEquity(cash, position, bar.close)
    equityCurve.push({
      ts: bar.ts,
      barIndex: i,
      equity,
      cash,
      unrealizedPnl: unrealized,
      realizedPnl,
    })

    // ---------- 3. Ask strategy (only if more bars remain) ----------
    if (i < lastIndex) {
      const action = await strategy(cursor, {
        cash,
        position,
        equity,
        barsSeen: i + 1,
      })
      pending = action.type === 'hold' ? null : action
    }

    // ---------- 4. Advance cursor for next iteration ----------
    if (i < lastIndex) cursor._advance()
  }

  return {
    trades,
    equityCurve,
    metrics: computeMetrics(trades, equityCurve, execution.initialCash),
    barsReplayed: bars.length,
    elapsedMs: Date.now() - start,
  }
}

// ==================== Helpers ====================

/** Mark-to-market unrealized P&L for an open position. */
function markToMarket(position: OpenPosition, price: number): number {
  const delta = price - position.entryPrice
  return position.side === 'long' ? delta * position.size : -delta * position.size
}

/**
 * Compute total equity (cash + position value at mark).
 * Long positions add `close*size` to equity; short positions subtract
 * it (since you owe that many units at market price).
 */
function markEquity(cash: number, position: OpenPosition | null, price: number): number {
  if (!position) return cash
  const sign = position.side === 'long' ? 1 : -1
  return cash + sign * price * position.size
}

interface FillCtx {
  state: () => {
    getPosition: () => OpenPosition | null
    setPosition: (p: OpenPosition | null) => void
    getCash: () => number
    setCash: (c: number) => void
    pushTrade: (t: ClosedTrade) => void
  }
  execution: ExecutionParams
  barIndex: number
}

function applyPending(action: StrategyAction, bar: Bar, ctx: FillCtx): void {
  const s = ctx.state()
  const pos = s.getPosition()

  if (action.type === 'enter') {
    if (pos) return // already in a position — ignore redundant entry
    if (action.size <= 0) return
    if (action.side === 'long') {
      const quote = quoteBuy(bar.open, action.size, ctx.execution)
      const cost = quote.notional + quote.commission
      if (cost > s.getCash()) return // reject — not enough cash
      s.setCash(s.getCash() - cost)
      s.setPosition({
        side: 'long',
        size: action.size,
        entryPrice: quote.price,
        entryTs: bar.ts,
        entryBarIndex: ctx.barIndex,
      })
    } else {
      const quote = quoteSell(bar.open, action.size, ctx.execution)
      // For short entries we credit the notional and still pay
      // commission. This ignores margin requirements — fine for MVP.
      s.setCash(s.getCash() + quote.notional - quote.commission)
      s.setPosition({
        side: 'short',
        size: action.size,
        entryPrice: quote.price,
        entryTs: bar.ts,
        entryBarIndex: ctx.barIndex,
      })
    }
    return
  }

  if (action.type === 'exit') {
    if (!pos) return
    if (pos.side === 'long') {
      const quote = quoteSell(bar.open, pos.size, ctx.execution)
      const entryNotional = pos.entryPrice * pos.size
      const pnl = quote.notional - entryNotional - quote.commission
      s.setCash(s.getCash() + quote.notional - quote.commission)
      s.pushTrade({
        side: 'long',
        size: pos.size,
        entryTs: pos.entryTs,
        entryPrice: pos.entryPrice,
        exitTs: bar.ts,
        exitPrice: quote.price,
        pnl,
        returnPct: entryNotional > 0 ? (pnl / entryNotional) * 100 : 0,
        entryCommission: 0, // already charged at entry in cash
        exitCommission: quote.commission,
        barsHeld: ctx.barIndex - pos.entryBarIndex,
        exitReason: action.reason,
      })
    } else {
      const quote = quoteBuy(bar.open, pos.size, ctx.execution)
      const entryNotional = pos.entryPrice * pos.size
      const pnl = entryNotional - quote.notional - quote.commission
      s.setCash(s.getCash() - quote.notional - quote.commission)
      s.pushTrade({
        side: 'short',
        size: pos.size,
        entryTs: pos.entryTs,
        entryPrice: pos.entryPrice,
        exitTs: bar.ts,
        exitPrice: quote.price,
        pnl,
        returnPct: entryNotional > 0 ? (pnl / entryNotional) * 100 : 0,
        entryCommission: 0,
        exitCommission: quote.commission,
        barsHeld: ctx.barIndex - pos.entryBarIndex,
        exitReason: action.reason,
      })
    }
    s.setPosition(null)
  }
}
