/**
 * Minute-level backtest engine — core types.
 *
 * Design principles:
 *
 * 1. Cursor-based access. The strategy function never receives the full
 *    bar array; it receives a `BarCursor` that can only read bars with
 *    index ≤ current. This makes look-ahead bias a **type-level**
 *    impossibility, not a convention that depends on author discipline.
 *
 * 2. Realistic execution. The `ExecutionModel` requires explicit
 *    slippage (bps) and commission (bps). There is no default 0 —
 *    "frictionless" backtests are the leading cause of flattering
 *    curves that melt in production.
 *
 * 3. Next-bar fill. When a strategy emits an order at the close of bar
 *    N, the fill happens at the **open** of bar N+1. This matches how
 *    live execution actually works and avoids the classic
 *    "fill-at-close with hindsight" mistake.
 *
 * 4. Deterministic. Given the same bars and execution parameters, the
 *    same strategy function produces the same result every time. No
 *    global state, no hidden randomness.
 */

// ==================== Bar ====================

/** A single OHLCV bar. Timestamps are epoch ms, UTC. */
export interface Bar {
  ts: number
  open: number
  high: number
  low: number
  close: number
  volume: number
}

// ==================== Cursor ====================

/**
 * A read-only view into the historical bar series up to the current
 * index. The runner advances the cursor one bar at a time; the
 * strategy function can only reach backwards, never forwards.
 */
export interface BarCursor {
  /** Current bar index (the bar whose close we have just observed). */
  readonly index: number
  /** The current (most recent) bar. */
  readonly current: Bar
  /**
   * Get the bar at an offset in the past, e.g. lookback(1) is the
   * previous bar. Returns undefined if the offset goes before index 0.
   */
  lookback(offset: number): Bar | undefined
  /** Return the last `n` bars (oldest first). */
  lastN(n: number): Bar[]
}

// ==================== Strategy Action ====================

export type StrategyAction =
  | { type: 'hold' }
  | { type: 'enter'; side: 'long' | 'short'; size: number; reason?: string }
  | { type: 'exit'; reason?: string }

/**
 * A strategy function takes the current cursor and returns what action
 * to take at the next bar's open. Strategies are async so they can
 * call LLMs, fetch extra data, etc.
 */
export type StrategyFn = (
  cursor: BarCursor,
  state: StrategyState,
) => Promise<StrategyAction>

/** Live state the runner exposes to the strategy. */
export interface StrategyState {
  cash: number
  position: OpenPosition | null
  equity: number
  /** Number of bars seen so far — 0-indexed. */
  barsSeen: number
}

// ==================== Positions & Trades ====================

export interface OpenPosition {
  side: 'long' | 'short'
  size: number
  entryPrice: number
  entryTs: number
  entryBarIndex: number
}

export interface ClosedTrade {
  side: 'long' | 'short'
  size: number
  entryTs: number
  entryPrice: number
  exitTs: number
  exitPrice: number
  pnl: number
  returnPct: number
  entryCommission: number
  exitCommission: number
  barsHeld: number
  entryReason?: string
  exitReason?: string
}

// ==================== Execution ====================

/**
 * Execution model parameters.
 *
 * These are REQUIRED (no defaults). Forcing the caller to supply
 * slippage + commission prevents the "I forgot to model costs"
 * antipattern that ships looking-great backtests into losing live
 * strategies.
 */
export interface ExecutionParams {
  /** One-way slippage in basis points (1 bp = 0.01%). */
  slippageBps: number
  /** One-way commission in basis points. */
  commissionBps: number
  /** Starting cash in the base currency. */
  initialCash: number
}

// ==================== Result ====================

export interface EquityPoint {
  ts: number
  barIndex: number
  equity: number
  cash: number
  unrealizedPnl: number
  realizedPnl: number
}

export interface BacktestMetrics {
  totalReturn: number
  totalReturnPct: number
  maxDrawdown: number
  maxDrawdownPct: number
  numTrades: number
  numWinners: number
  numLosers: number
  winRatePct: number
  avgWin: number
  avgLoss: number
  profitFactor: number
  finalEquity: number
}

export interface BacktestResult {
  trades: ClosedTrade[]
  equityCurve: EquityPoint[]
  metrics: BacktestMetrics
  /** Total number of bars replayed. */
  barsReplayed: number
  /** Wall-clock duration of the run in ms. */
  elapsedMs: number
}
