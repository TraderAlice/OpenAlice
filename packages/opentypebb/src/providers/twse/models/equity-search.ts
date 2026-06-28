/**
 * TWSE / TPEx Equity Search.
 *
 * Heuristic search over the FULL official company directory (listed + OTC),
 * cached in-process. This is the same shape as searching the US/SEC full list —
 * the "search target" is just a local roster instead of a remote fuzzy endpoint.
 * Matches Chinese name (台積電), abbreviation (台積電), code (2330), or English
 * short-name. Emits Yahoo-suffixed symbols (`2330.TW` / `6488.TWO`) so K-lines
 * resolve through Yahoo's chart API (see provider index — EquityHistorical reuses
 * yfinance's fetcher).
 *
 * Keyless — TWSE/TPEx open data is public.
 */

import { z } from 'zod'
import { Fetcher } from '../../../core/provider/abstract/fetcher.js'
import { EquitySearchQueryParamsSchema, EquitySearchDataSchema } from '../../../standard-models/equity-search.js'
import { allCompanies, type TwCompany } from '../common.js'

export const TWSEEquitySearchQueryParamsSchema = EquitySearchQueryParamsSchema
export type TWSEEquitySearchQueryParams = z.infer<typeof TWSEEquitySearchQueryParamsSchema>

export const TWSEEquitySearchDataSchema = EquitySearchDataSchema.extend({
  exchange: z.string().nullable().default(null).describe('Listing board — TWSE (上市) or TPEx (上櫃).'),
  industry: z.string().nullable().default(null).describe('TWSE/TPEx industry-category code.'),
}).passthrough()
export type TWSEEquitySearchData = z.infer<typeof TWSEEquitySearchDataSchema>

const MAX_RESULTS = 30

export class TWSEEquitySearchFetcher extends Fetcher {
  static override requireCredentials = false

  static override transformQuery(params: Record<string, unknown>): TWSEEquitySearchQueryParams {
    return TWSEEquitySearchQueryParamsSchema.parse(params)
  }

  static override async extractData(
    query: TWSEEquitySearchQueryParams,
    _credentials: Record<string, string> | null,
  ): Promise<TwCompany[]> {
    const companies = await allCompanies()
    const q = query.query.trim()
    if (!q) return companies.slice(0, MAX_RESULTS)

    const needle = q.toLowerCase()
    const scored: { c: TwCompany; score: number }[] = []
    for (const c of companies) {
      const code = c.code.toLowerCase()
      let score = -1
      if (code === needle) score = 100
      else if (code.startsWith(needle)) score = 80
      else if ((c.name && c.name.includes(q)) || (c.abbr && c.abbr.includes(q))) score = 60
      else if (c.enName && c.enName.toLowerCase().includes(needle)) score = 40
      if (score >= 0) scored.push({ c, score })
    }
    scored.sort((a, b) => b.score - a.score)
    return scored.slice(0, MAX_RESULTS).map((x) => x.c)
  }

  static override transformData(
    _query: TWSEEquitySearchQueryParams,
    data: TwCompany[],
  ): TWSEEquitySearchData[] {
    return data.map((c) =>
      TWSEEquitySearchDataSchema.parse({
        // Prefer the exchange short-name (台積電) over the legal name
        // (台灣積體電路製造股份有限公司) — it's what a user/AI recognizes.
        symbol: `${c.code}.${c.board}`,
        name: c.abbr ?? c.name,
        exchange: c.board === 'TW' ? 'TWSE' : 'TPEx',
        industry: c.industry,
      }),
    )
  }
}
