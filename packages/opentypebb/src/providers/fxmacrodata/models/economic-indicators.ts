/**
 * FXMacroData Economic Indicators Model.
 *
 * `symbol` takes indicator slugs from AvailableIndicators. A bare slug
 * ("inflation") uses `country`; a qualified one ("EUR.inflation") carries its
 * own currency, so several economies can be requested at once. Values are
 * returned as published, in the unit reported for the series.
 */

import { z } from 'zod'
import { Fetcher } from '../../../core/provider/abstract/fetcher.js'
import {
  EconomicIndicatorsQueryParamsSchema,
  EconomicIndicatorsDataSchema,
} from '../../../standard-models/economic-indicators.js'
import { EmptyDataError } from '../../../core/provider/utils/errors.js'
import { epochToIso, fxmdGetAllPages, getApiKey, resolveCurrency, FXMD_CURRENCIES } from '../utils/helpers.js'

export const FXMDEconomicIndicatorsQueryParamsSchema = EconomicIndicatorsQueryParamsSchema.extend({
  symbol: z.string().describe(
    'Indicator slug(s), comma-separated, e.g. "inflation" or "EUR.policy_rate". See AvailableIndicators.',
  ),
  country: z.string().nullable().default(null).describe(
    'Currency code or country name for bare slugs. Defaults to USD, the only currency served without an API key.',
  ),
})
export type FXMDEconomicIndicatorsQueryParams = z.infer<typeof FXMDEconomicIndicatorsQueryParamsSchema>

export const FXMDEconomicIndicatorsDataSchema = EconomicIndicatorsDataSchema.extend({
  currency: z.string().nullable().default(null).describe('Currency the series belongs to.'),
  unit: z.string().nullable().default(null).describe('Unit of the value, e.g. "%YoY" or "USD bn".'),
  release_datetime: z.string().nullable().default(null).describe('When the value was published (UTC).'),
}).passthrough()
export type FXMDEconomicIndicatorsData = z.infer<typeof FXMDEconomicIndicatorsDataSchema>

interface AnnouncementsResponse {
  value_metadata?: { source_unit?: string | null }
  data?: Record<string, unknown>[]
  pagination?: { has_more?: boolean }
}

export function parseSeriesSymbols(symbol: string, country: string | null): Array<{ currency: string; indicator: string }> {
  const out: Array<{ currency: string; indicator: string }> = []
  for (const part of symbol.split(',').map(s => s.trim()).filter(Boolean)) {
    const dot = part.indexOf('.')
    const currency = dot > 0 ? resolveCurrency(part.slice(0, dot)) : resolveCurrency(country)
    const indicator = (dot > 0 ? part.slice(dot + 1) : part).toLowerCase()
    if (indicator) out.push({ currency, indicator })
  }
  return out
}

export class FXMDEconomicIndicatorsFetcher extends Fetcher {
  static override requireCredentials = false

  static override transformQuery(params: Record<string, unknown>): FXMDEconomicIndicatorsQueryParams {
    return FXMDEconomicIndicatorsQueryParamsSchema.parse(params)
  }

  static override async extractData(
    query: FXMDEconomicIndicatorsQueryParams,
    credentials: Record<string, string> | null,
  ): Promise<Record<string, unknown>[]> {
    const series = parseSeriesSymbols(query.symbol, query.country)
    if (series.length === 0) throw new EmptyDataError('No indicator symbols provided.')
    const apiKey = getApiKey(credentials)

    const results: Record<string, unknown>[] = []
    for (const { currency, indicator } of series) {
      const { first, rows } = await fxmdGetAllPages<AnnouncementsResponse>(
        `/announcements/${currency.toLowerCase()}/${encodeURIComponent(indicator)}`,
        { start_date: query.start_date, end_date: query.end_date },
        apiKey,
      )
      const unit = first?.value_metadata?.source_unit ?? null
      for (const row of rows) {
        if (typeof row.val !== 'number') continue
        results.push({
          date: row.date ?? null,
          symbol_root: indicator,
          symbol: `${currency}.${indicator}`,
          country: FXMD_CURRENCIES[currency].country,
          value: row.val,
          currency,
          unit,
          release_datetime: epochToIso(row.announcement_datetime),
        })
      }
    }

    if (results.length === 0) throw new EmptyDataError('No FXMacroData indicator data found.')
    return results
  }

  static override transformData(
    query: FXMDEconomicIndicatorsQueryParams,
    data: Record<string, unknown>[],
  ): FXMDEconomicIndicatorsData[] {
    let rows = data
    if (query.start_date) rows = rows.filter(d => String(d.date) >= query.start_date!)
    if (query.end_date) rows = rows.filter(d => String(d.date) <= query.end_date!)
    return rows
      .sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.symbol).localeCompare(String(b.symbol)))
      .map(d => FXMDEconomicIndicatorsDataSchema.parse(d))
  }
}
