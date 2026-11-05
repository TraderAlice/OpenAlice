/**
 * FXMacroData Available Indicators Model.
 * Lists the indicator catalogue for one or more currencies.
 */

import { z } from 'zod'
import { Fetcher } from '../../../core/provider/abstract/fetcher.js'
import { AvailableIndicatorsDataSchema } from '../../../standard-models/available-indicators.js'
import { EmptyDataError } from '../../../core/provider/utils/errors.js'
import { fxmdGet, getApiKey, resolveCurrencies, FXMD_CURRENCIES } from '../utils/helpers.js'

export const FXMDAvailableIndicatorsQueryParamsSchema = z.object({
  country: z.string().nullable().default(null).describe(
    'Currency code(s) or country name(s), comma-separated. Defaults to USD.',
  ),
}).passthrough()
export type FXMDAvailableIndicatorsQueryParams = z.infer<typeof FXMDAvailableIndicatorsQueryParamsSchema>

export const FXMDAvailableIndicatorsDataSchema = AvailableIndicatorsDataSchema.extend({
  currency: z.string().nullable().default(null).describe('Currency the indicator belongs to.'),
  unit: z.string().nullable().default(null).describe('Unit of the indicator values.'),
  source: z.string().nullable().default(null).describe('Publishing institution.'),
}).passthrough()
export type FXMDAvailableIndicatorsData = z.infer<typeof FXMDAvailableIndicatorsDataSchema>

interface CatalogueEntry {
  name?: string
  unit?: string
  frequency?: string
  source?: string
}

export class FXMDAvailableIndicatorsFetcher extends Fetcher {
  static override requireCredentials = false

  static override transformQuery(params: Record<string, unknown>): FXMDAvailableIndicatorsQueryParams {
    return FXMDAvailableIndicatorsQueryParamsSchema.parse(params)
  }

  static override async extractData(
    query: FXMDAvailableIndicatorsQueryParams,
    credentials: Record<string, string> | null,
  ): Promise<Record<string, unknown>[]> {
    const apiKey = getApiKey(credentials)
    const results: Record<string, unknown>[] = []
    for (const currency of resolveCurrencies(query.country)) {
      const catalogue = await fxmdGet<Record<string, CatalogueEntry>>(
        `/data_catalogue/${currency.toLowerCase()}`, {}, apiKey)
      for (const [indicator, entry] of Object.entries(catalogue ?? {})) {
        if (!entry || typeof entry !== 'object') continue
        results.push({ currency, indicator, ...entry })
      }
    }
    if (results.length === 0) throw new EmptyDataError('FXMacroData catalogue is empty.')
    return results
  }

  static override transformData(
    _query: FXMDAvailableIndicatorsQueryParams,
    data: Record<string, unknown>[],
  ): FXMDAvailableIndicatorsData[] {
    return data.map(d => {
      const currency = String(d.currency)
      const info = FXMD_CURRENCIES[currency]
      return FXMDAvailableIndicatorsDataSchema.parse({
        symbol_root: d.indicator,
        symbol: `${currency}.${d.indicator}`,
        country: info?.country ?? null,
        iso: info?.iso ?? null,
        description: d.name ?? null,
        frequency: d.frequency ?? null,
        currency,
        unit: d.unit ?? null,
        source: d.source ?? null,
      })
    })
  }
}
