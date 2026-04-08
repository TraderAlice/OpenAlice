/**
 * Fugle Market Data AI Tools
 *
 * Intraday candles (1/3/5/10/15/30/60 min), historical candles (D/W/M),
 * real-time quotes, and tick-by-tick trades via Fugle API.
 */

import { tool } from 'ai'
import { z } from 'zod'
import type { TwstockMcpClient } from '@/domain/twstock/client'

export function createFugleTools(client: TwstockMcpClient) {
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    try {
      return await client.callTool(name, args)
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) }
    }
  }

  return {
    fugleGetIntradayCandles: tool({
      description: `Get intraday K-line candlestick data for a TWSE/TPEx stock via Fugle.

Returns OHLCV candles for today's trading session at the specified interval.
Timeframes: 1, 3, 5, 10, 15, 30, 60 (minutes).
Use this for intraday chart analysis — much more granular than daily data.

IMPORTANT: When presenting K-line data, wrap the JSON in a \`\`\`kline code block.`,
      inputSchema: z.object({
        symbol: z.string().describe('Stock code, e.g. "2330"'),
        timeframe: z.string().optional().describe('Candle interval in minutes: 1, 3, 5, 10, 15, 30, 60 (default: 5)'),
      }),
      execute: async ({ symbol, timeframe }) => {
        const args: Record<string, unknown> = { symbol }
        if (timeframe) args.timeframe = timeframe
        return call('get_intraday_candles', args)
      },
    }),

    fugleGetIntradayQuote: tool({
      description: 'Get real-time intraday quote for a stock via Fugle. Returns current price, change, best 5 bid/ask, volume, and last trade info.',
      inputSchema: z.object({
        symbol: z.string().describe('Stock code, e.g. "2330"'),
      }),
      execute: async ({ symbol }) => call('get_intraday_quote', { symbol }),
    }),

    fugleGetIntradayTrades: tool({
      description: 'Get intraday tick-by-tick trade data for a stock via Fugle.',
      inputSchema: z.object({
        symbol: z.string().describe('Stock code, e.g. "2330"'),
        limit: z.number().int().optional().describe('Max trades to return (default: 50)'),
      }),
      execute: async ({ symbol, limit }) => {
        const args: Record<string, unknown> = { symbol }
        if (limit) args.limit = limit
        return call('get_intraday_trades', args)
      },
    }),

    fugleGetHistoricalCandles: tool({
      description: `Get historical K-line candlestick data for a stock via Fugle.

Supports: 1/3/5/10/15/30/60 min, D (daily), W (weekly), M (monthly).
Use for multi-timeframe technical analysis.

IMPORTANT: When presenting K-line data, wrap the JSON in a \`\`\`kline code block.`,
      inputSchema: z.object({
        symbol: z.string().describe('Stock code, e.g. "2330"'),
        timeframe: z.string().optional().describe('Period: 1/3/5/10/15/30/60/D/W/M (default: D)'),
        from_date: z.string().optional().describe('Start date (YYYY-MM-DD)'),
        to_date: z.string().optional().describe('End date (YYYY-MM-DD)'),
      }),
      execute: async ({ symbol, timeframe, from_date, to_date }) => {
        const args: Record<string, unknown> = { symbol }
        if (timeframe) args.timeframe = timeframe
        if (from_date) args.from_date = from_date
        if (to_date) args.to_date = to_date
        return call('get_historical_candles', args)
      },
    }),

    fugleGetHistoricalStats: tool({
      description: 'Get historical statistics for a stock (52-week high/low, averages, etc.) via Fugle.',
      inputSchema: z.object({
        symbol: z.string().describe('Stock code, e.g. "2330"'),
      }),
      execute: async ({ symbol }) => call('get_historical_stats', { symbol }),
    }),

    // ==================== Ticker & Volumes ====================

    fugleGetIntradayTicker: tool({
      description: 'Get basic stock information (name, reference price, limit up/down, security type, day-trade eligibility) via Fugle.',
      inputSchema: z.object({
        symbol: z.string().describe('Stock code, e.g. "2330"'),
      }),
      execute: async ({ symbol }) => call('get_intraday_ticker', { symbol }),
    }),

    fugleGetIntradayVolumes: tool({
      description: 'Get intraday price-volume distribution table showing cumulative volume at each price level.',
      inputSchema: z.object({
        symbol: z.string().describe('Stock code, e.g. "2330"'),
      }),
      execute: async ({ symbol }) => call('get_intraday_volumes', { symbol }),
    }),

    // Snapshot tools (movers, actives) require Fugle Developer plan — not registered for basic users.
  }
}
