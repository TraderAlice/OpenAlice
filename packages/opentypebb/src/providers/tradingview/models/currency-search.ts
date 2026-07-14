/**
 * TradingView currency pair search fetcher.
 */

import { z } from 'zod'
import { CurrencyPairsDataSchema, CurrencyPairsQueryParamsSchema } from '../../../standard-models/currency-pairs.js'
import { createTradingViewSearchFetcher } from './factories.js'

export const TradingViewCurrencySearchQueryParamsSchema = CurrencyPairsQueryParamsSchema
export type TradingViewCurrencySearchQueryParams = z.infer<typeof TradingViewCurrencySearchQueryParamsSchema>

export const TradingViewCurrencySearchFetcher = createTradingViewSearchFetcher({
  querySchema: TradingViewCurrencySearchQueryParamsSchema,
  dataSchema: CurrencyPairsDataSchema,
  searchType: 'forex',
  assetKind: 'currency',
})
