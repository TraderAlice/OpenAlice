/**
 * Eastmoney (东方财富) Equity Search Fetcher.
 *
 * Online CN A-share search via Eastmoney's public `suggest` endpoint. Unlike
 * yfinance (Latin/pinyin only), this matches Chinese company names natively
 * (茅台 → 600519) — the reason a CN user opts this vendor in. Returns the
 * Eastmoney secid (`{MktNum}.{Code}`, e.g. `1.600519` SSE / `0.000001` SZSE) as
 * the symbol, so it feeds straight into this provider's EquityHistorical — the
 * Eastmoney channel is self-consistent in its own namespace, never mixed with
 * Yahoo tickers.
 *
 * A-shares only (SecurityType 1=沪A / 2=深A); 三板/港股/etc are filtered out —
 * that's the vendor's特质化 scope. Keyless; TOKEN below is the public fixed
 * web token, not a user credential.
 */

import { z } from 'zod'
import { Fetcher } from '../../../core/provider/abstract/fetcher.js'
import { amakeRequest } from '../../../core/provider/utils/helpers.js'
import { EquitySearchQueryParamsSchema, EquitySearchDataSchema } from '../../../standard-models/equity-search.js'

const SUGGEST_URL = 'https://searchapi.eastmoney.com/api/suggest/get'
const TOKEN = 'D43BF722C8E33BDC906FB84D85E326E8'
const HEADERS = { 'User-Agent': 'Mozilla/5.0', Referer: 'https://www.eastmoney.com/' }

export const EastmoneyEquitySearchQueryParamsSchema = EquitySearchQueryParamsSchema
export type EastmoneyEquitySearchQueryParams = z.infer<typeof EastmoneyEquitySearchQueryParamsSchema>

export const EastmoneyEquitySearchDataSchema = EquitySearchDataSchema.extend({
  exchange: z.string().nullable().default(null).describe('Eastmoney security-type label (沪A / 深A).'),
  pinyin: z.string().nullable().default(null).describe('Pinyin abbreviation, aids Latin recall.'),
}).passthrough()
export type EastmoneyEquitySearchData = z.infer<typeof EastmoneyEquitySearchDataSchema>

interface SuggestEntry {
  Code: string
  Name: string
  PinYin?: string
  SecurityType?: string | number
  SecurityTypeName?: string
  MktNum?: string | number
}

export class EastmoneyEquitySearchFetcher extends Fetcher {
  static override requireCredentials = false

  static override transformQuery(params: Record<string, unknown>): EastmoneyEquitySearchQueryParams {
    return EastmoneyEquitySearchQueryParamsSchema.parse(params)
  }

  static override async extractData(
    query: EastmoneyEquitySearchQueryParams,
    _credentials: Record<string, string> | null,
  ): Promise<SuggestEntry[]> {
    if (!query.query) return []
    const url =
      `${SUGGEST_URL}?input=${encodeURIComponent(query.query)}&type=14&count=12&token=${TOKEN}`
    const raw = await amakeRequest<{ QuotationCodeTable?: { Data?: SuggestEntry[] } }>(url, { headers: HEADERS })
    const data = raw.QuotationCodeTable?.Data ?? []
    // A-shares only: SecurityType 1=沪A, 2=深A. (三板=10 / 港股=19 / US / … dropped.)
    return data.filter((d) => Number(d.SecurityType) === 1 || Number(d.SecurityType) === 2)
  }

  static override transformData(
    _query: EastmoneyEquitySearchQueryParams,
    data: SuggestEntry[],
  ): EastmoneyEquitySearchData[] {
    return data.map((d) =>
      EastmoneyEquitySearchDataSchema.parse({
        symbol: `${d.MktNum}.${d.Code}`, // secid — feeds straight into EquityHistorical
        name: d.Name,
        exchange: d.SecurityTypeName ?? null,
        pinyin: d.PinYin ?? null,
      }),
    )
  }
}
