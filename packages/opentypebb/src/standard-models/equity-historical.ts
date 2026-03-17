/**
 * Equity Historical Price Standard Model.
 * Maps to: openbb_core/provider/standard_models/equity_historical.py
 */

import { z } from 'zod'

export const EquityHistoricalQueryParamsSchema = z.object({
  symbol: z.string().transform((v) => v.toUpperCase()),
  start_date: z.string().nullable().default(null).describe('Start date of the data, in YYYY-MM-DD format.'),
  end_date: z.string().nullable().default(null).describe('End date of the data, in YYYY-MM-DD format.'),
}).passthrough()

export type EquityHistoricalQueryParams = z.infer<typeof EquityHistoricalQueryParamsSchema>

export const EquityHistoricalDataSchema = z.object({
  date: z.string().describe('The date of the data.'),
  open: z.number().nullable().default(null).describe('The open price.'),
  high: z.number().nullable().default(null).describe('The high price.'),
  low: z.number().nullable().default(null).describe('The low price.'),
  close: z.number().nullable().default(null).describe('The close price.'),
  volume: z.number().nullable().default(null).describe('The trading volume.'),
  vwap: z.number().nullable().default(null).describe('Volume Weighted Average Price over the period.'),
}).passthrough()

export type EquityHistoricalData = z.infer<typeof EquityHistoricalDataSchema>
