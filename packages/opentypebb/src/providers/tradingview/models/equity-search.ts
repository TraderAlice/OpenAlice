/**
 * TradingView equity search fetcher.
 */

import { z } from 'zod'
import { Fetcher } from '../../../core/provider/abstract/fetcher.js'
import { EquitySearchDataSchema, EquitySearchQueryParamsSchema } from '../../../standard-models/equity-search.js'
import { mapTradingViewSearchRows, searchTradingViewSymbols } from '../domain.js'

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
    return mapTradingViewSearchRows(rows, 'equity')
      .map((row) => EquitySearchDataSchema.parse(row))
  }
}
