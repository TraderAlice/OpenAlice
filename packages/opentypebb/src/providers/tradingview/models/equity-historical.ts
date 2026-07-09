/**
 * TradingView anonymous equity historical fetcher.
 *
 * Free global equity intraday data via TradingView's anonymous WebSocket feed.
 * Freshness is exchange-dependent: bare US equities may resolve to Cboe
 * One/BATS partial-market realtime data, while exchange-qualified US symbols
 * and non-US equities are commonly delayed without paid exchange entitlements.
 * CN A-shares, Hong Kong, Taiwan, and other international markets are supported.
 *
 * Timestamps are returned in UTC (consistent with yfinance and broker sources):
 * - All bars use UTC time: "YYYY-MM-DD HH:MM:SS"
 * - Daily bars are date-only: "YYYY-MM-DD"
 *
 * When a US symbol resolves to Cboe, volume is partial-market Cboe One/BATS
 * volume, not SIP consolidated volume. Use for chart structure and intrabar
 * aggregation (order flow analysis), not for precise volume comparisons.
 */

import { z } from 'zod'
import { Fetcher } from '../../../core/provider/abstract/fetcher.js'
import { EquityHistoricalDataSchema, EquityHistoricalQueryParamsSchema } from '../../../standard-models/equity-historical.js'
import {
  fetchTradingViewHistoricalBars,
  isValidTradingViewDateOnly,
  mapTradingViewHistoricalBars,
  TRADINGVIEW_HISTORICAL_INTERVALS,
} from '../domain.js'
import type { TradingViewBar } from '../utils/websocket.js'

export const TradingViewEquityHistoricalQueryParamsSchema = EquityHistoricalQueryParamsSchema.extend({
  start_date: z.string().refine(isValidTradingViewDateOnly, 'Expected YYYY-MM-DD date.').nullable().default(null),
  end_date: z.string().refine(isValidTradingViewDateOnly, 'Expected YYYY-MM-DD date.').nullable().default(null),
  interval: z.enum(TRADINGVIEW_HISTORICAL_INTERVALS).default('1d').describe('Bar interval.'),
  extended_hours: z.boolean().default(false).describe('Include premarket and postmarket data.'),
  count: z.number().int().positive().optional().describe('Requested number of most-recent bars.'),
})

export type TradingViewEquityHistoricalQueryParams = z.infer<typeof TradingViewEquityHistoricalQueryParamsSchema>

export class TradingViewEquityHistoricalFetcher extends Fetcher {
  static override requireCredentials = false

  static override transformQuery(params: Record<string, unknown>): TradingViewEquityHistoricalQueryParams {
    return TradingViewEquityHistoricalQueryParamsSchema.parse(params)
  }

  static override async extractData(
    query: TradingViewEquityHistoricalQueryParams,
    _credentials: Record<string, string> | null,
  ): Promise<TradingViewBar[]> {
    return fetchTradingViewHistoricalBars(query, {
      session: query.extended_hours ? 'extended' : undefined,
    })
  }

  static override transformData(
    query: TradingViewEquityHistoricalQueryParams,
    bars: TradingViewBar[],
  ) {
    return mapTradingViewHistoricalBars(query, bars, {
      assetKind: 'equity',
      emptyDataMessage: 'No TradingView bars returned for the requested window.',
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
        coverage: semantics.coverage,
        volume_quality: semantics.volumeQuality,
      }),
      parse: (row) => EquityHistoricalDataSchema.parse(row),
    })
  }
}
