/**
 * TradingView crypto search fetcher.
 */

import { z } from 'zod'
import { CryptoSearchDataSchema, CryptoSearchQueryParamsSchema } from '../../../standard-models/crypto-search.js'
import { createTradingViewSearchFetcher } from './factories.js'

export const TradingViewCryptoSearchQueryParamsSchema = CryptoSearchQueryParamsSchema
export type TradingViewCryptoSearchQueryParams = z.infer<typeof TradingViewCryptoSearchQueryParamsSchema>

export const TradingViewCryptoSearchFetcher = createTradingViewSearchFetcher({
  querySchema: TradingViewCryptoSearchQueryParamsSchema,
  dataSchema: CryptoSearchDataSchema,
  searchType: 'crypto',
  assetKind: 'crypto',
})
