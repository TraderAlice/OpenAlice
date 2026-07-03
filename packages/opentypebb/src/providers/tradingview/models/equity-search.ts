/**
 * TradingView equity search fetcher.
 */

import { z } from 'zod'
import { Fetcher } from '../../../core/provider/abstract/fetcher.js'
import { EquitySearchDataSchema, EquitySearchQueryParamsSchema } from '../../../standard-models/equity-search.js'
import { baseSymbolAlias, fullSymbol, searchTradingViewSymbols } from '../utils/search.js'

export const TradingViewEquitySearchQueryParamsSchema = EquitySearchQueryParamsSchema
export type TradingViewEquitySearchQueryParams = z.infer<typeof TradingViewEquitySearchQueryParamsSchema>

export class TradingViewEquitySearchFetcher extends Fetcher {
  static override requireCredentials = false

  static override transformQuery(params: Record<string, unknown>): TradingViewEquitySearchQueryParams {
    return TradingViewEquitySearchQueryParamsSchema.parse(params)
  }

  static override async extractData(
    query: TradingViewEquitySearchQueryParams,
    _credentials: Record<string, string> | null,
  ): Promise<Record<string, unknown>[]> {
    return searchTradingViewSymbols(query.query, 'stock')
  }

  static override transformData(
    _query: TradingViewEquitySearchQueryParams,
    rows: Record<string, unknown>[],
  ) {
    return rows
      .map((row) => ({
        symbol: fullSymbol(row),
        name: row['description'] ?? null,
        aliases: baseSymbolAlias(row),
        exchange: row['exchange'] ?? null,
        listed_exchange: row['source_id'] ?? row['exchange'] ?? null,
        provider_id: row['provider_id'] ?? null,
        country: row['country'] ?? null,
        type: row['type'] ?? null,
        coverage: 'tradingview_global',
        volume_quality: 'exchange_dependent',
      }))
      .filter((row) => row.symbol)
      .map((row) => EquitySearchDataSchema.parse(row))
  }
}
