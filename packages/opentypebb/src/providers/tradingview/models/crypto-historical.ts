/**
 * TradingView anonymous crypto historical fetcher.
 */

import { z } from 'zod'
import { Fetcher } from '../../../core/provider/abstract/fetcher.js'
import { EmptyDataError } from '../../../core/provider/utils/errors.js'
import { CryptoHistoricalDataSchema, CryptoHistoricalQueryParamsSchema } from '../../../standard-models/crypto-historical.js'
import { endTimestamp, estimateRange, formatUTCTime, inDateWindow, INTERVALS, isValidDateOnly } from '../utils/historical.js'
import { fetchTradingViewBars, type TradingViewBar } from '../utils/websocket.js'

export const TradingViewCryptoHistoricalQueryParamsSchema = CryptoHistoricalQueryParamsSchema.extend({
  start_date: z.string().refine(isValidDateOnly, 'Expected YYYY-MM-DD date.').nullable().default(null),
  end_date: z.string().refine(isValidDateOnly, 'Expected YYYY-MM-DD date.').nullable().default(null),
  interval: z.enum(['1m', '3m', '5m', '15m', '30m', '1h', '4h', '1d', '1w']).default('1d').describe('Bar interval.'),
  count: z.number().int().positive().optional().describe('Requested number of most-recent bars.'),
})

export type TradingViewCryptoHistoricalQueryParams = z.infer<typeof TradingViewCryptoHistoricalQueryParamsSchema>

export class TradingViewCryptoHistoricalFetcher extends Fetcher {
  static override requireCredentials = false

  static override transformQuery(params: Record<string, unknown>): TradingViewCryptoHistoricalQueryParams {
    return TradingViewCryptoHistoricalQueryParamsSchema.parse(params)
  }

  static override async extractData(
    query: TradingViewCryptoHistoricalQueryParams,
    _credentials: Record<string, string> | null,
  ): Promise<TradingViewBar[]> {
    return fetchTradingViewBars({
      symbol: query.symbol,
      interval: INTERVALS[query.interval],
      range: estimateRange(query),
      to: endTimestamp(query),
    })
  }

  static override transformData(
    query: TradingViewCryptoHistoricalQueryParams,
    bars: TradingViewBar[],
  ) {
    const out = [...bars]
      .sort((a, b) => a.time - b.time)
      .map((bar) => ({
        date: formatUTCTime(bar.time),
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
        volume: bar.volume,
        vwap: null,
        symbol: query.symbol,
        provider: 'tradingview',
      }))
      .filter((row) => inDateWindow(row.date, query))

    if (out.length === 0) {
      throw new EmptyDataError('No TradingView crypto bars returned for the requested window.')
    }

    return out.map((row) => CryptoHistoricalDataSchema.parse(row))
  }
}
