/**
 * OANDA v20 Currency Search Model.
 * Maps to: openbb_oanda/models/currency_pairs.py
 *
 * Enumerates the account's tradable instruments (GET /v3/accounts/{id}/instruments)
 * and filters to FX pairs matching the query. Data-only — no order placement.
 */

import { z } from 'zod'
import { Fetcher } from '../../../core/provider/abstract/fetcher.js'
import { CurrencyPairsQueryParamsSchema, CurrencyPairsDataSchema } from '../../../standard-models/currency-pairs.js'
import { getOandaInstruments, normalizeOandaSymbol } from '../utils/helpers.js'

export const OandaCurrencyPairsQueryParamsSchema = CurrencyPairsQueryParamsSchema
export type OandaCurrencyPairsQueryParams = z.infer<typeof OandaCurrencyPairsQueryParamsSchema>

export const OandaCurrencyPairsDataSchema = CurrencyPairsDataSchema
export type OandaCurrencyPairsData = z.infer<typeof OandaCurrencyPairsDataSchema>

export class OandaCurrencyPairsFetcher extends Fetcher {
  static override transformQuery(params: Record<string, unknown>): OandaCurrencyPairsQueryParams {
    return OandaCurrencyPairsQueryParamsSchema.parse(params)
  }

  static override async extractData(
    query: OandaCurrencyPairsQueryParams,
    credentials: Record<string, string> | null,
  ): Promise<Record<string, unknown>[]> {
    if (!query.query) return []

    const instruments = await getOandaInstruments(credentials)
    // Accept both the canonical pair name (EUR_GBP) and the bare form
    // (EURGBP — normalized, matching historical's symbol handling), plus
    // plain substrings over the display name.
    const needle = normalizeOandaSymbol(query.query).toLowerCase()
    const rawNeedle = query.query.toLowerCase()
    return instruments
      .filter((i) => i.type === 'CURRENCY')
      .filter((i) => {
        const name = (i.name ?? '').toLowerCase()
        const display = (i.displayName ?? '').toLowerCase()
        return name.includes(needle) || name.includes(rawNeedle) || display.includes(rawNeedle)
      })
      .map((i) => ({
        symbol: i.name ?? '',
        name: i.displayName ?? i.name ?? null,
      }))
      .filter((r) => r.symbol !== '')
  }

  static override transformData(
    query: OandaCurrencyPairsQueryParams,
    data: Record<string, unknown>[],
  ): OandaCurrencyPairsData[] {
    return data.map(d => OandaCurrencyPairsDataSchema.parse(d))
  }
}
