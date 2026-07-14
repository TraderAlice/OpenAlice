/**
 * TradingView anonymous currency historical fetcher.
 */

import { z } from 'zod'
import { CurrencyHistoricalDataSchema, CurrencyHistoricalQueryParamsSchema } from '../../../standard-models/currency-historical.js'
import {
  isValidTradingViewDateOnly,
  TRADINGVIEW_HISTORICAL_INTERVALS,
} from '../domain.js'
import { createTradingViewHistoricalFetcher } from './factories.js'

export const TradingViewCurrencyHistoricalQueryParamsSchema = CurrencyHistoricalQueryParamsSchema.extend({
  start_date: z.string().refine(isValidTradingViewDateOnly, 'Expected YYYY-MM-DD date.').nullable().default(null),
  end_date: z.string().refine(isValidTradingViewDateOnly, 'Expected YYYY-MM-DD date.').nullable().default(null),
  interval: z.enum(TRADINGVIEW_HISTORICAL_INTERVALS).default('1d').describe('Bar interval.'),
  count: z.number().int().positive().optional().describe('Requested number of most-recent bars.'),
})

export type TradingViewCurrencyHistoricalQueryParams = z.infer<typeof TradingViewCurrencyHistoricalQueryParamsSchema>

export const TradingViewCurrencyHistoricalFetcher = createTradingViewHistoricalFetcher({
  querySchema: TradingViewCurrencyHistoricalQueryParamsSchema,
  dataSchema: CurrencyHistoricalDataSchema,
  assetKind: 'currency',
  emptyDataMessage: 'No TradingView currency bars returned for the requested window.',
})
