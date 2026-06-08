/**
 * TWSE Equity Search Fetcher.
 *
 * Enumerates all Taiwan-listed securities (TWSE listed + TPEx OTC) from the
 * free official open-data APIs (no API key). Symbols are emitted with the
 * Yahoo Finance suffix convention (`2330.TW`, `6488.TWO`) so they are
 * directly usable by the yfinance provider for quotes / historical /
 * fundamentals.
 *
 * Sources (shapes verified live 2026-06-07):
 * - https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL
 *   All TWSE-listed securities incl. ETFs — { Code, Name, ... }
 * - https://www.tpex.org.tw/openapi/v1/tpex_mainboard_quotes
 *   All TPEx mainboard (OTC) securities — { SecuritiesCompanyCode, CompanyName, ... }
 * - https://openapi.twse.com.tw/v1/opendata/t187ap03_L
 *   TWSE-listed company profiles — { 公司代號, 公司簡稱, 英文簡稱, ... }
 *   Used only to enrich names with the English abbreviation ("台積電 (TSMC)")
 *   so English queries match. TPEx has no English-name field; optional.
 */

import { z } from 'zod'
import { Fetcher } from '../../../core/provider/abstract/fetcher.js'
import { twseFetch } from './common.js'
import { EquitySearchQueryParamsSchema, EquitySearchDataSchema } from '../../../standard-models/equity-search.js'

// ==================== Provider-specific schemas ====================

export const TwseEquitySearchQueryParamsSchema = EquitySearchQueryParamsSchema

export type TwseEquitySearchQueryParams = z.infer<typeof TwseEquitySearchQueryParamsSchema>

export const TwseEquitySearchDataSchema = EquitySearchDataSchema.extend({
  exchange: z.enum(['TWSE', 'TPEX']).describe('Listing board — TWSE (listed) or TPEX (OTC mainboard).'),
})

export type TwseEquitySearchData = z.infer<typeof TwseEquitySearchDataSchema>

// ==================== Raw API shapes ====================

interface TwseStockDayAllRow {
  Code: string
  Name: string
  [key: string]: unknown
}

interface TpexMainboardRow {
  SecuritiesCompanyCode: string
  CompanyName: string
  [key: string]: unknown
}

interface TwseCompanyProfileRow {
  公司代號: string
  公司簡稱: string
  英文簡稱: string
  [key: string]: unknown
}

/** Merged intermediate entry — one Taiwan security. */
export interface TwSecurityEntry {
  code: string
  name: string
  nameEn?: string
  board: 'TWSE' | 'TPEX'
}

// ==================== Endpoints ====================

const TWSE_STOCK_DAY_ALL_URL = 'https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL'
const TPEX_MAINBOARD_URL = 'https://www.tpex.org.tw/openapi/v1/tpex_mainboard_quotes'
const TWSE_PROFILE_URL = 'https://openapi.twse.com.tw/v1/opendata/t187ap03_L'

const TW_HEADERS = { Accept: 'application/json' }

// ==================== Pure merge logic ====================

/** Merge the three raw lists into board-tagged entries with English names. */
export function mergeTwSources(
  twseDaily: TwseStockDayAllRow[],
  tpexQuotes: TpexMainboardRow[],
  twseProfiles: TwseCompanyProfileRow[],
): TwSecurityEntry[] {
  const englishByCode = new Map<string, string>()
  for (const p of twseProfiles) {
    const en = p.英文簡稱?.trim()
    if (p.公司代號 && en) englishByCode.set(p.公司代號, en)
  }

  const entries: TwSecurityEntry[] = []
  const seen = new Set<string>()

  for (const row of twseDaily) {
    if (!row.Code || seen.has(`${row.Code}.TWSE`)) continue
    seen.add(`${row.Code}.TWSE`)
    entries.push({
      code: row.Code,
      name: row.Name ?? '',
      nameEn: englishByCode.get(row.Code),
      board: 'TWSE',
    })
  }

  for (const row of tpexQuotes) {
    const code = row.SecuritiesCompanyCode
    if (!code || seen.has(`${code}.TPEX`)) continue
    seen.add(`${code}.TPEX`)
    entries.push({
      code,
      name: row.CompanyName ?? '',
      board: 'TPEX',
    })
  }

  return entries
}

// ==================== Fetcher ====================

export class TwseEquitySearchFetcher extends Fetcher {
  static override requireCredentials = false

  static override transformQuery(params: Record<string, unknown>): TwseEquitySearchQueryParams {
    return TwseEquitySearchQueryParamsSchema.parse(params)
  }

  static override async extractData(
    _query: TwseEquitySearchQueryParams,
    _credentials: Record<string, string> | null,
  ): Promise<TwSecurityEntry[]> {
    const [twseDaily, tpexQuotes, twseProfiles] = await Promise.all([
      twseFetch<TwseStockDayAllRow[]>(TWSE_STOCK_DAY_ALL_URL, { headers: TW_HEADERS }),
      twseFetch<TpexMainboardRow[]>(TPEX_MAINBOARD_URL, { headers: TW_HEADERS }),
      // English names are an enrichment — failure must not break the search.
      twseFetch<TwseCompanyProfileRow[]>(TWSE_PROFILE_URL, { headers: TW_HEADERS }).catch(
        () => [] as TwseCompanyProfileRow[],
      ),
    ])

    return mergeTwSources(twseDaily, tpexQuotes, twseProfiles)
  }

  static override transformData(
    query: TwseEquitySearchQueryParams,
    data: TwSecurityEntry[],
  ): TwseEquitySearchData[] {
    const q = query.query.toLowerCase()

    // If empty query, return all (for bulk loading by SymbolIndex)
    const filtered = q
      ? data.filter((d) =>
          d.code.toLowerCase().includes(q) ||
          d.name.toLowerCase().includes(q) ||
          d.nameEn?.toLowerCase().includes(q),
        )
      : data

    return filtered.map((d) =>
      TwseEquitySearchDataSchema.parse({
        symbol: `${d.code}.${d.board === 'TWSE' ? 'TW' : 'TWO'}`,
        name: d.nameEn ? `${d.name} (${d.nameEn})` : d.name,
        exchange: d.board,
      }),
    )
  }
}
