/**
 * FMP Insider Trading Model.
 * Maps to: openbb_fmp/models/insider_trading.py
 */

import { z } from 'zod'
import { Fetcher } from '../../../core/provider/abstract/fetcher.js'
import { InsiderTradingQueryParamsSchema, InsiderTradingDataSchema } from '../../../standard-models/insider-trading.js'
import { applyAliases } from '../../../core/provider/utils/helpers.js'
import { getDataMany, getDataUrls, getQueryString } from '../utils/helpers.js'
import { TRANSACTION_TYPES_DICT } from '../utils/definitions.js'

// --- Query Params ---

export const FMPInsiderTradingQueryParamsSchema = InsiderTradingQueryParamsSchema.extend({
  transaction_type: z.string().nullable().default(null).describe('Type of the transaction.'),
  statistics: z.boolean().default(false).describe('Flag to return summary statistics for the given symbol.'),
})

export type FMPInsiderTradingQueryParams = z.infer<typeof FMPInsiderTradingQueryParamsSchema>

// --- Data ---

// Field names per the FMP *stable* insider-trading response (the old
// dict carried legacy-v4 names — 'cik', and upstream's typo'd
// 'acquistionOrDisposition' — which left dates/types null).
const ALIAS_DICT: Record<string, string> = {
  owner_cik: 'reportingCik',
  owner_name: 'reportingName',
  owner_title: 'typeOfOwner',
  ownership_type: 'directOrIndirect',
  security_type: 'securityName',
  transaction_price: 'price',
  transaction_type: 'transactionType',
  transaction_date: 'transactionDate',
  filing_date: 'filingDate',
  acquisition_or_disposition: 'acquisitionOrDisposition',
  filing_url: 'link',
  company_cik: 'companyCik',
}

export const FMPInsiderTradingDataSchema = InsiderTradingDataSchema.extend({
  form_type: z.string().nullable().default(null).describe('The SEC form type.'),
  year: z.number().int().nullable().default(null).describe('The calendar year for the statistics.'),
  quarter: z.number().int().nullable().default(null).describe('The calendar quarter for the statistics.'),
}).passthrough()

export type FMPInsiderTradingData = z.infer<typeof FMPInsiderTradingDataSchema>

// --- Fetcher ---

export class FMPInsiderTradingFetcher extends Fetcher {
  static override transformQuery(params: Record<string, unknown>): FMPInsiderTradingQueryParams {
    return FMPInsiderTradingQueryParamsSchema.parse(params)
  }

  static override async extractData(
    query: FMPInsiderTradingQueryParams,
    credentials: Record<string, string> | null,
  ): Promise<Record<string, unknown>[]> {
    const apiKey = credentials?.fmp_api_key ?? ''

    if (query.statistics) {
      const url = `https://financialmodelingprep.com/stable/insider-trading/statistics?symbol=${query.symbol}&apikey=${apiKey}`
      return getDataMany(url)
    }

    const transactionType = query.transaction_type
      ? TRANSACTION_TYPES_DICT[query.transaction_type] ?? null
      : null

    const limit = query.limit && query.limit <= 1000 ? query.limit : 1000
    const baseUrl = 'https://financialmodelingprep.com/stable/insider-trading/search'

    const queryParams: Record<string, unknown> = {
      symbol: query.symbol,
      transactionType: transactionType,
    }
    const queryStr = getQueryString(queryParams, ['page', 'limit'])

    const pages = Math.ceil(limit / 1000)
    const urls = Array.from({ length: pages }, (_, page) =>
      `${baseUrl}?${queryStr}&page=${page}&limit=${limit}&apikey=${apiKey}`,
    )

    const results = await getDataUrls<Record<string, unknown>[]>(urls)
    return results.flat()
  }

  static override transformData(
    query: FMPInsiderTradingQueryParams,
    data: Record<string, unknown>[],
  ): FMPInsiderTradingData[] {
    const sorted = query.statistics
      ? [...data].sort((a, b) => {
          const yearDiff = Number(b.year ?? 0) - Number(a.year ?? 0)
          return yearDiff !== 0 ? yearDiff : Number(b.quarter ?? 0) - Number(a.quarter ?? 0)
        })
      : [...data].sort((a, b) =>
          String(b.filingDate ?? '').localeCompare(String(a.filingDate ?? '')),
        )

    return sorted.map((d) => {
      const aliased = applyAliases(d, ALIAS_DICT)
      return FMPInsiderTradingDataSchema.parse(aliased)
    })
  }
}
