/**
 * Backtester — Type definitions
 */

export interface Candle {
  timestamp: number
  open: number
  high: number
  low: number
  close: number
  volume: number
}

export interface CandleWithIndicators extends Candle {
  indicators: Record<string, number>
}

export interface StrategyDef {
  name: string
  symbol: string
  timeframe: string
  assetClass?: 'equity' | 'crypto' | 'currency'
  parameters: Record<string, number>
  entry_logic: string
  exit_logic: string
  direction?: 'long' | 'short' | 'both'
}

export interface BacktestOptions {
  capital: number
  slippage_bps?: number
  commission_pct?: number
  leverage?: number
  start_date?: string
  end_date?: string
}

export interface TradeEntry {
  entry_time: number
  exit_time: number
  entry_price: number
  exit_price: number
  size: number
  pnl: number
  pnl_pct: number
  win: boolean
  direction: 'long' | 'short'
}

export interface EquityCurvePoint {
  timestamp: number
  value: number
}

export interface BacktestMetrics {
  total_return: number
  sharpe_ratio: number
  max_drawdown: number
  win_rate: number
  profit_factor: number
  total_trades: number
  volume_warnings?: number
  volume_warning_pct?: number
}

export interface BacktestResult {
  strategy: StrategyDef
  options: BacktestOptions
  trades: TradeEntry[]
  metrics: BacktestMetrics
  equity_curve: EquityCurvePoint[]
  candle_count: number
  start_timestamp: number
  end_timestamp: number
}

export interface IndicatorSpec {
  type: 'RSI' | 'EMA' | 'SMA' | 'BBANDS' | 'MACD' | 'ATR'
  period?: number
  component?: string
}

// Phase 2 types

export interface ParameterRanges {
  [paramName: string]: number[]
}

export interface SweepResultEntry {
  parameters: Record<string, number>
  metrics: BacktestMetrics
}

export interface SweepResult {
  strategy_name: string
  ranked: SweepResultEntry[]
  best: SweepResultEntry
  total_combinations: number
  runtime_ms: number
}

export interface WalkForwardWindow {
  window_index: number
  train_start: number
  train_end: number
  test_start: number
  test_end: number
  best_params: Record<string, number>
  in_sample: BacktestMetrics
  out_of_sample: BacktestMetrics
}

export interface WalkForwardResult {
  strategy_name: string
  windows: WalkForwardWindow[]
  aggregate: {
    avg_oos_sharpe: number
    avg_oos_return: number
    avg_oos_drawdown: number
    overfitting_score: number
    overfitting_flag: boolean
  }
  total_windows: number
  runtime_ms: number
}

export interface VolumeWarning {
  trade_index: number
  trade_value: number
  candle_volume: number
  pct_of_volume: number
}

export interface TradeEntryWithWarning extends TradeEntry {
  volume_warning: boolean
  volume_warning_detail?: VolumeWarning
}
