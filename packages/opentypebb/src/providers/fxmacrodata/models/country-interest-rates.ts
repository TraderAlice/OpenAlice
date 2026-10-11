/**
 * FXMacroData Country Interest Rates Model.
 *
 * Central-bank policy rate, one row per decision. Values follow the
 * standard-model convention used by the OECD fetcher (decimal, 4.25% → 0.0425).
 * Where a bank targets a range the API's headline rate is used — for the
 * Federal Reserve that is the upper bound, named in `rate_name`.
 */

import { z } from 'zod'
import { Fetcher } from '../../../core/provider/abstract/fetcher.js'
import {
  CountryInterestRatesQueryParamsSchema,
  CountryInterestRatesDataSchema,
} from '../../../standard-models/country-interest-rates.js'
import { EmptyDataError } from '../../../core/provider/utils/errors.js'
import { epochToIso, fxmdGetAllPages, getApiKey, resolveCurrencies, FXMD_CURRENCIES } from '../utils/helpers.js'

export const FXMDCountryInterestRatesQueryParamsSchema = CountryInterestRatesQueryParamsSchema.extend({
  country: z.string().default('united_states').describe(
    'Country name(s) or currency code(s), comma-separated.',
  ),
})
export type FXMDCountryInterestRatesQueryParams = z.infer<typeof FXMDCountryInterestRatesQueryParamsSchema>

export const FXMDCountryInterestRatesDataSchema = CountryInterestRatesDataSchema.extend({
  currency: z.string().nullable().default(null).describe('Currency of the central bank.'),
  rate_name: z.string().nullable().default(null).describe('Name of the policy rate as published.'),
  release_datetime: z.string().nullable().default(null).describe('When the decision was announced (UTC).'),
}).passthrough()
export type FXMDCountryInterestRatesData = z.infer<typeof FXMDCountryInterestRatesDataSchema>

interface PolicyRateResponse {
  name?: string
  data?: Record<string, unknown>[]
  pagination?: { has_more?: boolean }
}

export class FXMDCountryInterestRatesFetcher extends Fetcher {
  static override requireCredentials = false

  static override transformQuery(params: Record<string, unknown>): FXMDCountryInterestRatesQueryParams {
    return FXMDCountryInterestRatesQueryParamsSchema.parse(params)
  }

  static override async extractData(
    query: FXMDCountryInterestRatesQueryParams,
    credentials: Record<string, string> | null,
  ): Promise<Record<string, unknown>[]> {
    const apiKey = getApiKey(credentials)
    const results: Record<string, unknown>[] = []
    for (const currency of resolveCurrencies(query.country)) {
      const { first, rows } = await fxmdGetAllPages<PolicyRateResponse>(
        `/announcements/${currency.toLowerCase()}/policy_rate`,
        { start_date: query.start_date, end_date: query.end_date },
        apiKey,
      )
      for (const row of rows) {
        if (typeof row.val !== 'number') continue
        results.push({
          date: row.date ?? null,
          value: row.val / 100,
          country: FXMD_CURRENCIES[currency].country,
          currency,
          rate_name: first?.name ?? null,
          release_datetime: epochToIso(row.announcement_datetime),
        })
      }
    }
    if (results.length === 0) throw new EmptyDataError('No FXMacroData policy rate data found.')
    return results
  }

  static override transformData(
    _query: FXMDCountryInterestRatesQueryParams,
    data: Record<string, unknown>[],
  ): FXMDCountryInterestRatesData[] {
    return data
      .sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.currency).localeCompare(String(b.currency)))
      .map(d => FXMDCountryInterestRatesDataSchema.parse(d))
  }
}
