/**
 * TradingView equity search fetcher.
 */

import { z } from 'zod'
import { EquitySearchDataSchema, EquitySearchQueryParamsSchema } from '../../../standard-models/equity-search.js'
import { createTradingViewSearchFetcher } from './factories.js'

export const TradingViewEquitySearchQueryParamsSchema = EquitySearchQueryParamsSchema
export type TradingViewEquitySearchQueryParams = z.infer<typeof TradingViewEquitySearchQueryParamsSchema>

export const TradingViewEquitySearchFetcher = createTradingViewSearchFetcher({
  querySchema: TradingViewEquitySearchQueryParamsSchema,
  dataSchema: EquitySearchDataSchema,
  searchType: 'stock',
  assetKind: 'equity',
})
