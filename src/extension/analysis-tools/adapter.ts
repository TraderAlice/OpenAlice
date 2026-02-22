import { tool } from 'ai';
import { z } from 'zod';
import type { IAnalysisContext } from './interfaces';
import { calculateIndicator } from './tools/calculate-indicator.tool';
import { globNews, grepNews, readNews } from './tools/news.tool';

/**
 * Create analysis AI tools (data-dependent, observation only)
 *
 * These tools require an IAnalysisContext (e.g. Sandbox) for data access.
 * They do NOT include trading operations - those are injected separately.
 *
 * Includes:
 * - Market data: getLatestOHLCV, getAllowedSymbols
 * - News: globNews, grepNews, readNews
 * - Time: getCurrentTime
 * - Calculation: calculateIndicator
 */
export function createAnalysisTools(ctx: IAnalysisContext) {
  return {
    // ==================== Market data ====================

    getLatestOHLCV: tool({
      description:
        'Get the latest OHLCV (Open, High, Low, Close, Volume) candlestick data for multiple trading pairs at current time. Returns K-line data with the specified interval (e.g., 1h, 4h, 1d). Use this to batch-fetch market data for all symbols you need in one call.',
      inputSchema: z.object({
        symbols: z
          .array(z.string())
          .describe(
            'Array of trading pair symbols, e.g. ["BTC/USD", "ETH/USD"]',
          ),
      }),
      execute: async ({ symbols }) => {
        return await ctx.getLatestOHLCV(symbols);
      },
    }),

    globNews: tool({
      description: `
Search news by title pattern (like "ls" or "glob" for files).

Returns a list of matching news with index, title, content length, and metadata preview.
Use this to quickly scan headlines and find relevant news before reading full content.

Time range control:
- lookback: How far back to search, e.g. "1h", "12h", "1d", "7d" (recommended over startTime)
- Default: searches all available news up to current time

Example use cases:
- globNews({ pattern: "BTC|Bitcoin" }) - Find all Bitcoin-related news
- globNews({ pattern: "ETF", lookback: "1d" }) - Find ETF news from the last 24 hours
- globNews({ pattern: ".*", metadataFilter: { source: "official" }, limit: 10 }) - Latest 10 official news
      `.trim(),
      inputSchema: z.object({
        pattern: z
          .string()
          .describe('Regular expression to match against news titles'),
        lookback: z
          .string()
          .optional()
          .describe(
            'How far back to search: "1h", "2h", "12h", "1d", "7d", etc. Recommended over startTime.',
          ),
        metadataFilter: z
          .record(z.string(), z.string())
          .optional()
          .describe('Filter by metadata key-value pairs'),
        limit: z
          .number()
          .int()
          .positive()
          .optional()
          .describe('Maximum number of results to return'),
      }),
      execute: async ({ pattern, lookback, metadataFilter, limit }) => {
        // Default hard limit of 500 items to prevent processing too much data
        const NEWS_LIMIT = 500;
        return await globNews(
          { getNews: () => ctx.getNewsV2({ lookback, limit: NEWS_LIMIT }) },
          { pattern, metadataFilter, limit },
        );
      },
    }),

    grepNews: tool({
      description: `
Search news content by pattern (like "grep" for files).

Returns matching news with context around the matched text.
Use this to find specific information mentioned in news content.

Time range control:
- lookback: How far back to search, e.g. "1h", "12h", "1d", "7d" (recommended over startTime)
- Default: searches all available news up to current time

Example use cases:
- grepNews({ pattern: "interest rate", lookback: "2d" }) - Find interest rate mentions in last 2 days
- grepNews({ pattern: "\\$[0-9]+[KMB]?", contextChars: 100 }) - Find price mentions with more context
- grepNews({ pattern: "hack|exploit|vulnerability", lookback: "1d" }) - Find security news from last 24h
      `.trim(),
      inputSchema: z.object({
        pattern: z
          .string()
          .describe(
            'Regular expression to search in news title and content',
          ),
        lookback: z
          .string()
          .optional()
          .describe(
            'How far back to search: "1h", "2h", "12h", "1d", "7d", etc. Recommended over startTime.',
          ),
        contextChars: z
          .number()
          .int()
          .positive()
          .optional()
          .describe(
            'Number of characters to show before and after match (default: 50)',
          ),
        metadataFilter: z
          .record(z.string(), z.string())
          .optional()
          .describe('Filter by metadata key-value pairs'),
        limit: z
          .number()
          .int()
          .positive()
          .optional()
          .describe('Maximum number of results to return'),
      }),
      execute: async ({
        pattern,
        lookback,
        contextChars,
        metadataFilter,
        limit,
      }) => {
        // Default hard limit of 500 items to prevent processing too much data
        const NEWS_LIMIT = 500;
        return await grepNews(
          { getNews: () => ctx.getNewsV2({ lookback, limit: NEWS_LIMIT }) },
          { pattern, contextChars, metadataFilter, limit },
        );
      },
    }),

    readNews: tool({
      description: `
Read full news content by index (like "cat" for files).

Use this after globNews or grepNews to read the complete content of a specific news item.
The index is returned by globNews/grepNews results.

Note: The index is relative to the news list from your last globNews/grepNews call.
Make sure to use the same lookback parameter to get consistent indices.
      `.trim(),
      inputSchema: z.object({
        index: z
          .number()
          .int()
          .nonnegative()
          .describe('News index from globNews/grepNews results'),
        lookback: z
          .string()
          .optional()
          .describe(
            'Should match the lookback used in globNews/grepNews to get consistent indices',
          ),
      }),
      execute: async ({ index, lookback }) => {
        // Use the same limit to maintain index consistency
        const NEWS_LIMIT = 500;
        const result = await readNews(
          { getNews: () => ctx.getNewsV2({ lookback, limit: NEWS_LIMIT }) },
          { index },
        );
        if (!result) {
          return { error: `News index ${index} not found` };
        }
        return result;
      },
    }),

    getAllowedSymbols: tool({
      description: 'Get available trading symbols/pairs',
      inputSchema: z.object({}),
      execute: async () => {
        return ctx.getAvailableSymbols();
      },
    }),

    // ==================== Time management ====================

    getCurrentTime: tool({
      description: 'Get current time',
      inputSchema: z.object({}),
      execute: () => {
        return ctx.getPlayheadTime();
      },
    }),

    // ==================== Calculation tools ====================

    calculateIndicator: tool({
      description: `
Calculate technical indicators and statistics using formula expressions.

**Supported Functions:**

Data Access (returns array):
- CLOSE(symbol, lookback) - Get close prices
- HIGH(symbol, lookback) - Get high prices
- LOW(symbol, lookback) - Get low prices
- OPEN(symbol, lookback) - Get open prices
- VOLUME(symbol, lookback) - Get volume data

Statistics (input: array, returns: number):
- SMA(data, period) - Simple Moving Average
- EMA(data, period) - Exponential Moving Average
- STDEV(data) - Standard Deviation
- MAX(data) - Maximum value
- MIN(data) - Minimum value
- SUM(data) - Sum of values
- AVERAGE(data) - Average value

Technical Indicators (input: array, returns: number or object):
- RSI(data, period) - Relative Strength Index
- BBANDS(data, period, stddev) - Bollinger Bands (returns {upper, middle, lower})
- MACD(data, fast, slow, signal) - MACD (returns {macd, signal, histogram})
- ATR(highs, lows, closes, period) - Average True Range

Array Access:
- Use [index] to access array elements (supports negative indices)
- Example: CLOSE('BTC/USD', 1)[0] gets the latest close price

**Examples:**
- "SMA(CLOSE('BTC/USD', 100), 20)" - 20-period moving average
- "RSI(CLOSE('BTC/USD', 50), 14)" - 14-period RSI
- "BBANDS(CLOSE('BTC/USD', 100), 20, 2)" - Bollinger Bands
- "(CLOSE('BTC/USD', 1)[0] - SMA(CLOSE('BTC/USD', 100), 50)) / SMA(CLOSE('BTC/USD', 100), 50) * 100" - Price deviation from 50MA in percentage

**Important Notes:**
- lookback parameter: number of K-lines to look back from current time
- All calculations respect time isolation (only see data <= currentTime)
- Arrays are ordered chronologically (oldest first, newest last)
- Use [0] for latest value, [-1] for oldest value in the array
      `.trim(),
      inputSchema: z.object({
        formula: z
          .string()
          .describe(
            'Formula expression using supported functions. Example: "SMA(CLOSE(\'BTC/USD\', 100), 20)"',
          ),
        description: z
          .string()
          .optional()
          .describe(
            'Optional description of what this formula calculates (for your own reference)',
          ),
      }),
      execute: async ({ formula }) => {
        return await calculateIndicator(
          {
            currentTime: ctx.getPlayheadTime(),
            dataProvider: ctx.marketDataProvider,
            calculatePreviousTime: (lookback) =>
              ctx.calculatePreviousTime(lookback),
          },
          formula,
        );
      },
    }),
  };
}
