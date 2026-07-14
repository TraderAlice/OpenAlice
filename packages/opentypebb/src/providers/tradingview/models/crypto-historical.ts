/**
 * TradingView anonymous crypto historical fetcher.
 */

import { z } from 'zod'
import { CryptoHistoricalDataSchema, CryptoHistoricalQueryParamsSchema } from '../../../standard-models/crypto-historical.js'
import {
  isValidTradingViewDateOnly,
  TRADINGVIEW_HISTORICAL_INTERVALS,
} from '../domain.js'
import { createTradingViewHistoricalFetcher } from './factories.js'

export const TradingViewCryptoHistoricalQueryParamsSchema = CryptoHistoricalQueryParamsSchema.extend({
  start_date: z.string().refine(isValidTradingViewDateOnly, 'Expected YYYY-MM-DD date.').nullable().default(null),
  end_date: z.string().refine(isValidTradingViewDateOnly, 'Expected YYYY-MM-DD date.').nullable().default(null),
  interval: z.enum(TRADINGVIEW_HISTORICAL_INTERVALS).default('1d').describe('Bar interval.'),
  count: z.number().int().positive().optional().describe('Requested number of most-recent bars.'),
})

export type TradingViewCryptoHistoricalQueryParams = z.infer<typeof TradingViewCryptoHistoricalQueryParamsSchema>

export const TradingViewCryptoHistoricalFetcher = createTradingViewHistoricalFetcher({
  querySchema: TradingViewCryptoHistoricalQueryParamsSchema,
  dataSchema: CryptoHistoricalDataSchema,
  assetKind: 'crypto',
  emptyDataMessage: 'No TradingView crypto bars returned for the requested window.',
})
