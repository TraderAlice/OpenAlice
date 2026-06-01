/**
 * Currency Historical Price Standard Model.
 * Maps to: openbb_core/provider/standard_models/currency_historical.py
 */

import { z } from 'zod'

export const CurrencyHistoricalQueryParamsSchema = z.object({
  symbol: z.string().transform((v) => v.toUpperCase().replace(/-/g, '')),
  start_date: z.string().nullable().default(null).describe('Start date of the data, in YYYY-MM-DD format.'),
  end_date: z.string().nullable().default(null).describe('End date of the data, in YYYY-MM-DD format.'),
}).passthrough()

export type CurrencyHistoricalQueryParams = z.infer<typeof CurrencyHistoricalQueryParamsSchema>

export const CurrencyHistoricalDataSchema = z.object({
  date: z.string().describe('The date of the data.'),
  open: z.number().nullable().default(null).describe('The open price.'),
  high: z.number().nullable().default(null).describe('The high price.'),
  low: z.number().nullable().default(null).describe('The low price.'),
  close: z.number().nullable().default(null).describe('The close price.'),
  volume: z.number().nullable().default(null).describe('The trading volume.'),
  vwap: z.number().nullable().default(null).describe('Volume Weighted Average Price over the period.'),
}).passthrough()

export type CurrencyHistoricalData = z.infer<typeof CurrencyHistoricalDataSchema>
