/**
 * TradingView crypto search fetcher.
 */

import { z } from 'zod'
import { Fetcher } from '../../../core/provider/abstract/fetcher.js'
import { CryptoSearchDataSchema, CryptoSearchQueryParamsSchema } from '../../../standard-models/crypto-search.js'
import { baseSymbolAlias, fullSymbol, searchTradingViewSymbols } from '../utils/search.js'

export const TradingViewCryptoSearchQueryParamsSchema = CryptoSearchQueryParamsSchema
export type TradingViewCryptoSearchQueryParams = z.infer<typeof TradingViewCryptoSearchQueryParamsSchema>

export class TradingViewCryptoSearchFetcher extends Fetcher {
  static override requireCredentials = false

  static override transformQuery(params: Record<string, unknown>): TradingViewCryptoSearchQueryParams {
    return TradingViewCryptoSearchQueryParamsSchema.parse(params)
  }

  static override async extractData(
    query: TradingViewCryptoSearchQueryParams,
    _credentials: Record<string, string> | null,
  ): Promise<Record<string, unknown>[]> {
    return searchTradingViewSymbols(query.query, 'crypto')
  }

  static override transformData(
    _query: TradingViewCryptoSearchQueryParams,
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
      .map((row) => CryptoSearchDataSchema.parse(row))
  }
}
