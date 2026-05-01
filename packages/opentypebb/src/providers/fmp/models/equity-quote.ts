/**
 * FMP Equity Quote Model.
 * Maps to: openbb_fmp/models/equity_quote.py
 */

import { z } from 'zod'
import { Fetcher } from '../../../core/provider/abstract/fetcher.js'
import { EquityQuoteQueryParamsSchema, EquityQuoteDataSchema } from '../../../standard-models/equity-quote.js'
import { applyAliases } from '../../../core/provider/utils/helpers.js'
import { EmptyDataError } from '../../../core/provider/utils/errors.js'
import { amakeRequest } from '../../../core/provider/utils/helpers.js'
import { responseCallback } from '../utils/helpers.js'

// --- Query Params ---

export const FMPEquityQuoteQueryParamsSchema = EquityQuoteQueryParamsSchema

export type FMPEquityQuoteQueryParams = z.infer<typeof FMPEquityQuoteQueryParamsSchema>

// --- Data ---

const ALIAS_DICT: Record<string, string> = {
  ma50: 'priceAvg50',
  ma200: 'priceAvg200',
  last_timestamp: 'timestamp',
  high: 'dayHigh',
  low: 'dayLow',
  last_price: 'price',
  change_percent: 'changePercentage',
  prev_close: 'previousClose',
  year_high: 'yearHigh',
  year_low: 'yearLow',
  market_cap: 'marketCap',
}

export const FMPEquityQuoteDataSchema = EquityQuoteDataSchema.extend({
  ma50: z.number().nullable().default(null).describe('50 day moving average price.'),
  ma200: z.number().nullable().default(null).describe('200 day moving average price.'),
  market_cap: z.number().nullable().default(null).describe('Market cap of the company.'),
}).passthrough()

export type FMPEquityQuoteData = z.infer<typeof FMPEquityQuoteDataSchema>

// --- Fetcher ---

export class FMPEquityQuoteFetcher extends Fetcher {
  static override transformQuery(params: Record<string, unknown>): FMPEquityQuoteQueryParams {
    return FMPEquityQuoteQueryParamsSchema.parse(params)
  }

  static override async extractData(
    query: FMPEquityQuoteQueryParams,
    credentials: Record<string, string> | null,
  ): Promise<Record<string, unknown>[]> {
    const apiKey = credentials?.fmp_api_key ?? ''
    const baseUrl = 'https://financialmodelingprep.com/stable/quote?'
    const symbols = query.symbol.split(',')
    const results: Record<string, unknown>[] = []

    const getOne = async (symbol: string) => {
      const url = `${baseUrl}symbol=${symbol}&apikey=${apiKey}`
      try {
        const result = await amakeRequest<Record<string, unknown>[]>(url, { responseCallback })
        if (result && result.length > 0) {
          results.push(...result)
        } else {
          // No quote means delisted, halted, or outside FMP coverage. Not
          // an error — quote is the most basic endpoint, so empty here is
          // a strong "we don't carry this asset" signal worth logging at
          // info level.
          console.info(`fmp/quote: no quote for ${symbol} (likely delisted or outside FMP coverage)`)
        }
      } catch (err) {
        console.warn(`fmp/quote: request failed for ${symbol}:`, err instanceof Error ? err.message : err)
      }
    }

    await Promise.all(symbols.map(getOne))

    if (results.length === 0) {
      throw new EmptyDataError('No data found for the given symbols.')
    }

    return results.sort((a, b) => {
      const ai = symbols.indexOf(String(a.symbol ?? ''))
      const bi = symbols.indexOf(String(b.symbol ?? ''))
      return ai - bi
    })
  }

  static override transformData(
    query: FMPEquityQuoteQueryParams,
    data: Record<string, unknown>[],
  ): FMPEquityQuoteData[] {
    return data.map((d) => {
      const aliased = applyAliases(d, ALIAS_DICT)
      // Normalize timestamp to ISO date string
      if (aliased.last_timestamp && typeof aliased.last_timestamp === 'number') {
        aliased.last_timestamp = new Date(aliased.last_timestamp * 1000).toISOString().split('T')[0]
      }
      // Normalize percent
      if (typeof aliased.change_percent === 'number') {
        aliased.change_percent = aliased.change_percent / 100
      }
      return FMPEquityQuoteDataSchema.parse(aliased)
    })
  }
}
