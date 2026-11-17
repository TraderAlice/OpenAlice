/**
 * FXMacroData Economic Calendar Model.
 *
 * Release schedule taken from the publishers' own calendars. The feed carries
 * release times and importance only — consensus, previous and actual stay
 * null rather than being filled from another series.
 */

import { z } from 'zod'
import { Fetcher } from '../../../core/provider/abstract/fetcher.js'
import {
  EconomicCalendarQueryParamsSchema,
  EconomicCalendarDataSchema,
} from '../../../standard-models/economic-calendar.js'
import { EmptyDataError } from '../../../core/provider/utils/errors.js'
import { fxmdGet, getApiKey, resolveCurrencies, FXMD_CURRENCIES } from '../utils/helpers.js'

export const FXMDEconomicCalendarQueryParamsSchema = EconomicCalendarQueryParamsSchema.extend({
  country: z.string().nullable().default(null).describe(
    'Currency code(s) or country name(s), comma-separated. Defaults to USD.',
  ),
})
export type FXMDEconomicCalendarQueryParams = z.infer<typeof FXMDEconomicCalendarQueryParamsSchema>

export const FXMDEconomicCalendarDataSchema = EconomicCalendarDataSchema.extend({
  indicator: z.string().nullable().default(null).describe('Indicator slug, usable as an EconomicIndicators symbol.'),
  reference_date: z.string().nullable().default(null).describe('Reference period the release covers, when known.'),
  date_confirmed: z.boolean().nullable().default(null).describe('Whether the publisher has confirmed the release date.'),
}).passthrough()
export type FXMDEconomicCalendarData = z.infer<typeof FXMDEconomicCalendarDataSchema>

interface CalendarResponse {
  data?: Record<string, unknown>[]
}

export class FXMDEconomicCalendarFetcher extends Fetcher {
  static override requireCredentials = false

  static override transformQuery(params: Record<string, unknown>): FXMDEconomicCalendarQueryParams {
    return FXMDEconomicCalendarQueryParamsSchema.parse(params)
  }

  static override async extractData(
    query: FXMDEconomicCalendarQueryParams,
    credentials: Record<string, string> | null,
  ): Promise<Record<string, unknown>[]> {
    const apiKey = getApiKey(credentials)
    const results: Record<string, unknown>[] = []
    for (const currency of resolveCurrencies(query.country)) {
      const res = await fxmdGet<CalendarResponse>(
        `/calendar/${currency.toLowerCase()}`,
        { start_date: query.start_date, end_date: query.end_date },
        apiKey,
      )
      for (const row of res.data ?? []) results.push({ ...row, _currency: currency })
    }
    if (results.length === 0) throw new EmptyDataError('No FXMacroData calendar events found.')
    return results
  }

  static override transformData(
    _query: FXMDEconomicCalendarQueryParams,
    data: Record<string, unknown>[],
  ): FXMDEconomicCalendarData[] {
    return data
      .map(d => {
        const currency = String(d.data_currency ?? d._currency).toUpperCase()
        return FXMDEconomicCalendarDataSchema.parse({
          date: d.announcement_datetime_utc ?? null,
          country: FXMD_CURRENCIES[currency]?.country ?? null,
          event: d.name ?? null,
          importance: d.event_importance ?? null,
          source: d.source ?? null,
          currency,
          indicator: d.release ?? null,
          reference_date: d.date ?? null,
          date_confirmed: typeof d.release_date_confirmed === 'boolean' ? d.release_date_confirmed : null,
        })
      })
      .sort((a, b) => String(a.date).localeCompare(String(b.date)))
  }
}
