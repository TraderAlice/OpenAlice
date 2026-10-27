/**
 * FMP Economic Calendar Model.
 * Maps to: openbb_fmp/models/economic_calendar.py
 */

import { z } from 'zod'
import { Fetcher } from '../../../core/provider/abstract/fetcher.js'
import { EconomicCalendarQueryParamsSchema, EconomicCalendarDataSchema } from '../../../standard-models/economic-calendar.js'
import { applyAliases } from '../../../core/provider/utils/helpers.js'
import { getDataMany } from '../utils/helpers.js'

// --- Query Params ---

export const FMPEconomicCalendarQueryParamsSchema = EconomicCalendarQueryParamsSchema.extend({})
export type FMPEconomicCalendarQueryParams = z.infer<typeof FMPEconomicCalendarQueryParamsSchema>

// --- Data ---

const ALIAS_DICT: Record<string, string> = {
  consensus: 'estimate',
  importance: 'impact',
  last_updated: 'updatedAt',
  created_at: 'createdAt',
  change_percent: 'changePercentage',
}

export const FMPEconomicCalendarDataSchema = EconomicCalendarDataSchema.extend({
  change: z.number().nullable().default(null).describe('Value change since previous.'),
  change_percent: z.number().nullable().default(null).describe('Percentage change since previous.'),
  last_updated: z.string().nullable().default(null).describe('Last updated timestamp.'),
  created_at: z.string().nullable().default(null).describe('Created timestamp.'),
}).passthrough()

export type FMPEconomicCalendarData = z.infer<typeof FMPEconomicCalendarDataSchema>

// --- Fetcher ---

export class FMPEconomicCalendarFetcher extends Fetcher {
  static override transformQuery(params: Record<string, unknown>): FMPEconomicCalendarQueryParams {
    return FMPEconomicCalendarQueryParamsSchema.parse(params)
  }

  static override async extractData(
    query: FMPEconomicCalendarQueryParams,
    credentials: Record<string, string> | null,
  ): Promise<Record<string, unknown>[]> {
    const apiKey = credentials?.fmp_api_key ?? ''
    const now = new Date()
    const startDate = query.start_date ?? new Date(now.getTime() - 1 * 86400000).toISOString().slice(0, 10)
    const endDate = query.end_date ?? new Date(now.getTime() + 7 * 86400000).toISOString().slice(0, 10)

    const url = 'https://financialmodelingprep.com/stable/economic-calendar'
      + `?from=${startDate}&to=${endDate}&apikey=${apiKey}`
    return getDataMany(url)
  }

  static override transformData(
    query: FMPEconomicCalendarQueryParams,
    data: Record<string, unknown>[],
  ): FMPEconomicCalendarData[] {
    return data.map(d => {
      // A zero release or estimate is data, not a missing value.
      const cleaned: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(d)) {
        cleaned[k] = v === '' ? null : v
      }
      const aliased = applyAliases(cleaned, ALIAS_DICT)
      // Normalize change_percent from percent to decimal
      if (typeof aliased.change_percent === 'number') {
        aliased.change_percent = aliased.change_percent / 100
      }
      return FMPEconomicCalendarDataSchema.parse(aliased)
    })
  }
}
