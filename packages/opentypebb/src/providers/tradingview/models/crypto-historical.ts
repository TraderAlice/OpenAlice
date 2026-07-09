/**
 * TradingView anonymous crypto historical fetcher.
 */

import { z } from 'zod'
import { Fetcher } from '../../../core/provider/abstract/fetcher.js'
import { CryptoHistoricalDataSchema, CryptoHistoricalQueryParamsSchema } from '../../../standard-models/crypto-historical.js'
import {
  fetchTradingViewHistoricalBars,
  isValidTradingViewDateOnly,
  mapTradingViewHistoricalBars,
  TRADINGVIEW_HISTORICAL_INTERVALS,
} from '../domain.js'
import type { TradingViewBar } from '../utils/websocket.js'

export const TradingViewCryptoHistoricalQueryParamsSchema = CryptoHistoricalQueryParamsSchema.extend({
  start_date: z.string().refine(isValidTradingViewDateOnly, 'Expected YYYY-MM-DD date.').nullable().default(null),
  end_date: z.string().refine(isValidTradingViewDateOnly, 'Expected YYYY-MM-DD date.').nullable().default(null),
  interval: z.enum(TRADINGVIEW_HISTORICAL_INTERVALS).default('1d').describe('Bar interval.'),
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
    return mapTradingViewHistoricalBars(query, bars, {
      assetKind: 'crypto',
      emptyDataMessage: 'No TradingView crypto bars returned for the requested window.',
      mapBar: ({ bar, date, semantics }) => ({
        date,
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
        volume: bar.volume,
        vwap: null,
        symbol: query.symbol,
        provider: semantics.provider,
      }),
      parse: (row) => CryptoHistoricalDataSchema.parse(row),
    })
  }
}
