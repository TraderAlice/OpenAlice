/**
 * TradingView anonymous currency historical fetcher.
 */

import { z } from 'zod'
import { Fetcher } from '../../../core/provider/abstract/fetcher.js'
import { CurrencyHistoricalDataSchema, CurrencyHistoricalQueryParamsSchema } from '../../../standard-models/currency-historical.js'
import {
  fetchTradingViewHistoricalBars,
  isValidTradingViewDateOnly,
  mapTradingViewHistoricalBars,
  TRADINGVIEW_HISTORICAL_INTERVALS,
} from '../domain.js'
import type { TradingViewBar } from '../utils/websocket.js'

export const TradingViewCurrencyHistoricalQueryParamsSchema = CurrencyHistoricalQueryParamsSchema.extend({
  start_date: z.string().refine(isValidTradingViewDateOnly, 'Expected YYYY-MM-DD date.').nullable().default(null),
  end_date: z.string().refine(isValidTradingViewDateOnly, 'Expected YYYY-MM-DD date.').nullable().default(null),
  interval: z.enum(TRADINGVIEW_HISTORICAL_INTERVALS).default('1d').describe('Bar interval.'),
  count: z.number().int().positive().optional().describe('Requested number of most-recent bars.'),
})

export type TradingViewCurrencyHistoricalQueryParams = z.infer<typeof TradingViewCurrencyHistoricalQueryParamsSchema>

export class TradingViewCurrencyHistoricalFetcher extends Fetcher {
  static override requireCredentials = false

  static override transformQuery(params: Record<string, unknown>): TradingViewCurrencyHistoricalQueryParams {
    return TradingViewCurrencyHistoricalQueryParamsSchema.parse(params)
  }

  static override async extractData(
    query: TradingViewCurrencyHistoricalQueryParams,
    _credentials: Record<string, string> | null,
  ): Promise<TradingViewBar[]> {
    return fetchTradingViewHistoricalBars(query)
  }

  static override transformData(
    query: TradingViewCurrencyHistoricalQueryParams,
    bars: TradingViewBar[],
  ) {
    return mapTradingViewHistoricalBars(query, bars, {
      assetKind: 'currency',
      emptyDataMessage: 'No TradingView currency bars returned for the requested window.',
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
      parse: (row) => CurrencyHistoricalDataSchema.parse(row),
    })
  }
}
