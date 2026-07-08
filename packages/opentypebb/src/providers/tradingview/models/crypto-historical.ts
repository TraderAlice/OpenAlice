/**
 * TradingView anonymous crypto historical fetcher.
 */

import { z } from 'zod'
import { Fetcher } from '../../../core/provider/abstract/fetcher.js'
import { CryptoHistoricalDataSchema, CryptoHistoricalQueryParamsSchema } from '../../../standard-models/crypto-historical.js'
import { isValidDateOnly } from '../utils/historical.js'
import { fetchTradingViewHistoricalBars, transformTradingViewHistoricalData } from '../utils/historical-fetcher.js'
import type { TradingViewBar } from '../utils/websocket.js'

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
    return fetchTradingViewHistoricalBars(query)
  }

  static override transformData(
    query: TradingViewCryptoHistoricalQueryParams,
    bars: TradingViewBar[],
  ) {
    return transformTradingViewHistoricalData(query, bars, {
      emptyDataMessage: 'No TradingView crypto bars returned for the requested window.',
      mapBar: ({ bar, date }) => ({
        date,
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
        volume: bar.volume,
        vwap: null,
        symbol: query.symbol,
        provider: 'tradingview',
      }),
      parse: (row) => CryptoHistoricalDataSchema.parse(row),
    })
  }
}
