/**
 * TradingView crypto search fetcher.
 */

import { z } from 'zod'
import { Fetcher } from '../../../core/provider/abstract/fetcher.js'
import { CryptoSearchDataSchema, CryptoSearchQueryParamsSchema } from '../../../standard-models/crypto-search.js'
import { mapTradingViewSearchRows, searchTradingViewSymbols } from '../domain.js'

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
    return mapTradingViewSearchRows(rows, 'crypto')
      .map((row) => CryptoSearchDataSchema.parse(row))
  }
}
