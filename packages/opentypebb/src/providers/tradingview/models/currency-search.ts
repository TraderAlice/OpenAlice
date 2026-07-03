/**
 * TradingView currency pair search fetcher.
 */

import { z } from 'zod'
import { Fetcher } from '../../../core/provider/abstract/fetcher.js'
import { CurrencyPairsDataSchema, CurrencyPairsQueryParamsSchema } from '../../../standard-models/currency-pairs.js'
import { baseSymbolAlias, fullSymbol, searchTradingViewSymbols } from '../utils/search.js'

export const TradingViewCurrencySearchQueryParamsSchema = CurrencyPairsQueryParamsSchema
export type TradingViewCurrencySearchQueryParams = z.infer<typeof TradingViewCurrencySearchQueryParamsSchema>

export class TradingViewCurrencySearchFetcher extends Fetcher {
  static override requireCredentials = false

  static override transformQuery(params: Record<string, unknown>): TradingViewCurrencySearchQueryParams {
    return TradingViewCurrencySearchQueryParamsSchema.parse(params)
  }

  static override async extractData(
    query: TradingViewCurrencySearchQueryParams,
    _credentials: Record<string, string> | null,
  ): Promise<Record<string, unknown>[]> {
    return searchTradingViewSymbols(query.query, 'forex')
  }

  static override transformData(
    _query: TradingViewCurrencySearchQueryParams,
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
        type: row['type'] ?? null,
      }))
      .filter((row) => row.symbol)
      .map((row) => CurrencyPairsDataSchema.parse(row))
  }
}
