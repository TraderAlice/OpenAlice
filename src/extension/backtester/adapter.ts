/**
 * Backtester — MCP tool adapter
 *
 * Exposes backtesting capabilities as tools Alice can call,
 * including sweep, walk-forward validation, and volume realism.
 */

import { tool } from 'ai'
import { z } from 'zod'
import type { EquityClientLike, CryptoClientLike, CurrencyClientLike } from '../../domain/market-data/client/types.js'
import { fetchOhlcv, type DataClients, type DataSource, type CcxtAccountLike } from './data.js'
import { runBacktest } from './engine.js'
import { writeBacktestResults, listBacktests as listBacktestFiles, readBacktestSummary as readSummary } from './io.js'
import { runParameterSweep, writeSweepResults } from './sweep.js'
import { runWalkForward } from './validation.js'
import { summarizeVolumeWarnings } from './realism.js'
import type { StrategyDef, BacktestOptions } from './types.js'

const DSL_HELP = `DSL expressions for entry/exit logic:
  - Price: close, open, high, low, volume
  - Indicators: RSI_14, EMA_20, SMA_50, BBANDS_upper/lower/middle, MACD_value/signal/histogram, ATR_14
  - Custom periods: RSI_21, EMA_50, SMA_200, ATR_10
  - Special: stop_loss_hit, take_profit_hit, position_open
  - Operators: <, >, <=, >=, ==, !=, &&, ||, !`

function buildStrategy(input: {
  name: string; symbol: string; timeframe: string;
  assetClass?: 'equity' | 'crypto' | 'currency';
  parameters: Record<string, number>;
  entry_logic: string; exit_logic: string;
  direction?: 'long' | 'short' | 'both';
}): StrategyDef {
  return {
    name: input.name,
    symbol: input.symbol,
    timeframe: input.timeframe,
    assetClass: input.assetClass,
    parameters: input.parameters,
    entry_logic: input.entry_logic,
    exit_logic: input.exit_logic,
    direction: input.direction,
  }
}

function buildOptions(input: {
  capital: number; slippage_bps?: number; commission_pct?: number;
  leverage?: number; start_date: string; end_date: string;
}): BacktestOptions {
  return {
    capital: input.capital,
    slippage_bps: input.slippage_bps,
    commission_pct: input.commission_pct,
    leverage: input.leverage,
    start_date: input.start_date,
    end_date: input.end_date,
  }
}

const strategyFields = {
  name: z.string().describe('Strategy name'),
  symbol: z.string().describe('Trading pair or ticker (e.g., BTC/USD, AAPL)'),
  timeframe: z.string().describe('Candle interval (1m, 5m, 15m, 1h, 1d)'),
  assetClass: z.enum(['equity', 'crypto', 'currency']).optional().describe('Asset class (auto-detected if omitted)'),
  parameters: z.record(z.string(), z.number()).describe('Strategy parameters (must include position_size)'),
  entry_logic: z.string().describe('DSL expression for entry condition'),
  exit_logic: z.string().describe('DSL expression for exit condition'),
  direction: z.enum(['long', 'short', 'both']).optional().describe('Trade direction (default: long)'),
}

const optionFields = {
  capital: z.number().positive().describe('Starting capital'),
  slippage_bps: z.number().optional().describe('Slippage in basis points (default: 5)'),
  commission_pct: z.number().optional().describe('Commission as fraction (default: 0.001)'),
  leverage: z.number().optional().describe('Leverage multiplier (default: 1)'),
  start_date: z.string().describe('Start date (YYYY-MM-DD)'),
  end_date: z.string().describe('End date (YYYY-MM-DD)'),
  dataSource: z.enum(['openbb', 'ccxt']).optional().describe('Data source (default: openbb, use ccxt for exchange-native crypto data)'),
}

export function createBacktestTools(
  equityClient: EquityClientLike,
  cryptoClient: CryptoClientLike,
  currencyClient: CurrencyClientLike,
  getCcxtAccount?: () => CcxtAccountLike | undefined,
) {
  const clients: DataClients = {
    equity: equityClient,
    crypto: cryptoClient,
    currency: currencyClient,
    get ccxtAccount() { return getCcxtAccount?.() },
  }

  return {
    runBacktest: tool({
      description: `Run a backtest on a trading strategy against historical data.\n\n${DSL_HELP}\n\nParameters must include position_size (fraction, e.g. 0.1 for 10%), optionally stop_loss_pct and take_profit_pct.\nReturns metrics (Sharpe, drawdown, win rate, profit factor) with volume warnings and saves trade log to disk.`,
      inputSchema: z.object({ ...strategyFields, ...optionFields }),
      execute: async (input) => {
        const strategy = buildStrategy(input)
        const options = buildOptions(input)

        const dataResult = await fetchOhlcv(
          strategy.symbol, strategy.timeframe,
          input.start_date, input.end_date,
          strategy.assetClass, clients, input.dataSource,
        )
        if (!dataResult.success || !dataResult.candles) {
          return { success: false, error: dataResult.error }
        }

        const result = runBacktest(strategy, options, dataResult.candles)
        const volumeSummary = summarizeVolumeWarnings(result.trades, dataResult.candles)

        result.metrics.volume_warnings = volumeSummary.volume_warnings
        result.metrics.volume_warning_pct = volumeSummary.volume_warning_pct

        const { summaryPath, resultsPath } = await writeBacktestResults(result)

        return {
          success: true,
          metrics: result.metrics,
          trade_count: result.trades.length,
          candle_count: result.candle_count,
          start_timestamp: result.start_timestamp,
          end_timestamp: result.end_timestamp,
          first_trades: result.trades.slice(0, 5),
          last_trades: result.trades.slice(-5),
          equity_start: result.equity_curve[0]?.value,
          equity_end: result.equity_curve[result.equity_curve.length - 1]?.value,
          volume_warnings: volumeSummary.volume_warnings,
          volume_warning_pct: volumeSummary.volume_warning_pct,
          data_source: dataResult.source,
          files: { summary: summaryPath, results: resultsPath },
        }
      },
    }),

    runParameterSweep: tool({
      description: `Run a parameter grid search over a strategy. Generates cartesian product of all parameter ranges, runs a backtest for each combination, and ranks results by Sharpe ratio.\n\nExample parameter_ranges: { "rsi_oversold": [20, 25, 30, 35], "rsi_overbought": [65, 70, 75, 80] } → tests 16 combinations.\n\n${DSL_HELP}`,
      inputSchema: z.object({
        ...strategyFields,
        parameter_ranges: z.record(z.string(), z.array(z.number())).describe('Map of parameter names to arrays of values to test'),
        ...optionFields,
      }),
      execute: async (input) => {
        const strategy = buildStrategy(input)
        const options = buildOptions(input)

        const dataResult = await fetchOhlcv(
          strategy.symbol, strategy.timeframe,
          input.start_date, input.end_date,
          strategy.assetClass, clients, input.dataSource,
        )
        if (!dataResult.success || !dataResult.candles) {
          return { success: false, error: dataResult.error }
        }

        try {
          const result = runParameterSweep(strategy, input.parameter_ranges, options, dataResult.candles)
          const filePath = await writeSweepResults(result)

          return {
            success: true,
            total_combinations: result.total_combinations,
            runtime_ms: result.runtime_ms,
            best: result.best,
            top_5: result.ranked.slice(0, 5),
            worst: result.ranked[result.ranked.length - 1],
            file: filePath,
          }
        } catch (err) {
          return { success: false, error: err instanceof Error ? err.message : String(err) }
        }
      },
    }),

    runWalkForward: tool({
      description: `Run walk-forward validation to detect overfitting. Splits data into train/test windows, optimizes parameters on training data, validates on test data, and reports out-of-sample performance.\n\nReturns per-window metrics and an overfitting score (OOS/IS Sharpe ratio). Score < 0.5 = likely overfit.\n\n${DSL_HELP}`,
      inputSchema: z.object({
        ...strategyFields,
        parameter_ranges: z.record(z.string(), z.array(z.number())).describe('Parameter ranges for sweep optimization'),
        windows: z.number().int().min(2).optional().describe('Number of walk-forward windows (default: 5)'),
        train_pct: z.number().min(0.3).max(0.9).optional().describe('Training fraction per window (default: 0.7)'),
        ...optionFields,
      }),
      execute: async (input) => {
        const strategy = buildStrategy(input)
        const options = buildOptions(input)

        const dataResult = await fetchOhlcv(
          strategy.symbol, strategy.timeframe,
          input.start_date, input.end_date,
          strategy.assetClass, clients, input.dataSource,
        )
        if (!dataResult.success || !dataResult.candles) {
          return { success: false, error: dataResult.error }
        }

        try {
          const result = runWalkForward(
            strategy,
            input.parameter_ranges,
            options,
            dataResult.candles,
            { windows: input.windows, train_pct: input.train_pct },
          )

          return {
            success: true,
            total_windows: result.total_windows,
            runtime_ms: result.runtime_ms,
            aggregate: result.aggregate,
            windows: result.windows.map(w => ({
              window_index: w.window_index,
              best_params: w.best_params,
              in_sample_sharpe: w.in_sample.sharpe_ratio,
              out_of_sample_sharpe: w.out_of_sample.sharpe_ratio,
              in_sample_return: w.in_sample.total_return,
              out_of_sample_return: w.out_of_sample.total_return,
            })),
          }
        } catch (err) {
          return { success: false, error: err instanceof Error ? err.message : String(err) }
        }
      },
    }),

    fetchHistoricalOhlcv: tool({
      description: `Fetch historical OHLCV candle data for any asset. Supports equity (stocks), crypto, and currency (forex). Asset class is auto-detected. Use dataSource "ccxt" for exchange-native crypto data.`,
      inputSchema: z.object({
        symbol: z.string().describe('Symbol (e.g., AAPL, BTC/USD, EUR/USD)'),
        interval: z.string().describe('Candle interval (1m, 5m, 15m, 1h, 1d)'),
        startDate: z.string().describe('Start date (YYYY-MM-DD)'),
        endDate: z.string().describe('End date (YYYY-MM-DD)'),
        assetClass: z.enum(['equity', 'crypto', 'currency']).optional().describe('Asset class (auto-detected if omitted)'),
        dataSource: z.enum(['openbb', 'ccxt']).optional().describe('Data source (default: openbb)'),
      }),
      execute: async ({ symbol, interval, startDate, endDate, assetClass, dataSource }) => {
        const result = await fetchOhlcv(symbol, interval, startDate, endDate, assetClass, clients, dataSource)

        if (!result.success || !result.candles) {
          return { success: false, error: result.error }
        }

        return {
          success: true,
          symbol,
          interval,
          data_source: result.source,
          candle_count: result.candles.length,
          first_candle: result.candles[0],
          last_candle: result.candles[result.candles.length - 1],
          candles: result.candles.length <= 100
            ? result.candles
            : `${result.candles.length} candles (showing first/last only for brevity)`,
        }
      },
    }),

    listBacktests: tool({
      description: 'List all saved backtest results (individual runs and sweep results).',
      inputSchema: z.object({}),
      execute: async () => {
        const entries = await listBacktestFiles()
        if (entries.length === 0) return { success: true, message: 'No backtest results found.', entries: [] }
        return { success: true, count: entries.length, entries }
      },
    }),

    readBacktestSummary: tool({
      description: 'Read a specific backtest summary by filename. Use listBacktests first to find available files.',
      inputSchema: z.object({
        filename: z.string().describe('Summary filename from listBacktests'),
      }),
      execute: async ({ filename }) => {
        try {
          const summary = await readSummary(filename)
          return { success: true, ...summary }
        } catch (err) {
          return { success: false, error: `Failed to read summary: ${err instanceof Error ? err.message : String(err)}` }
        }
      },
    }),
  }
}
