/**
 * FMP Equity Profile Model.
 * Maps to: openbb_fmp/models/equity_profile.py
 */

import { z } from 'zod'
import { Fetcher } from '../../../core/provider/abstract/fetcher.js'
import { EquityInfoQueryParamsSchema, EquityInfoDataSchema } from '../../../standard-models/equity-info.js'
import { applyAliases, replaceEmptyStrings } from '../../../core/provider/utils/helpers.js'
import { EmptyDataError } from '../../../core/provider/utils/errors.js'
import { amakeRequest } from '../../../core/provider/utils/helpers.js'
import { responseCallback } from '../utils/helpers.js'

// --- Query Params ---

export const FMPEquityProfileQueryParamsSchema = EquityInfoQueryParamsSchema

export type FMPEquityProfileQueryParams = z.infer<typeof FMPEquityProfileQueryParamsSchema>

// --- Data ---

const ALIAS_DICT: Record<string, string> = {
  name: 'companyName',
  stock_exchange: 'exchange',
  company_url: 'website',
  hq_address1: 'address',
  hq_address_city: 'city',
  hq_address_postal_code: 'zip',
  hq_state: 'state',
  hq_country: 'country',
  business_phone_no: 'phone',
  industry_category: 'industry',
  employees: 'fullTimeEmployees',
  long_description: 'description',
  first_stock_price_date: 'ipoDate',
  last_price: 'price',
  volume_avg: 'averageVolume',
  annualized_dividend_amount: 'lastDividend',
}

export const FMPEquityProfileDataSchema = EquityInfoDataSchema.extend({
  is_etf: z.boolean().default(false).describe('If the symbol is an ETF.'),
  is_actively_trading: z.boolean().default(true).describe('If the company is actively trading.'),
  is_adr: z.boolean().default(false).describe('If the stock is an ADR.'),
  is_fund: z.boolean().default(false).describe('If the company is a fund.'),
  image: z.string().nullable().default(null).describe('Image of the company.'),
  currency: z.string().nullable().default(null).describe('Currency in which the stock is traded.'),
  market_cap: z.number().nullable().default(null).describe('Market capitalization of the company.'),
  last_price: z.number().nullable().default(null).describe('The last traded price.'),
  year_high: z.number().nullable().default(null).describe('The one-year high of the price.'),
  year_low: z.number().nullable().default(null).describe('The one-year low of the price.'),
  volume_avg: z.number().nullable().default(null).describe('Average daily trading volume.'),
  annualized_dividend_amount: z.number().nullable().default(null).describe('The annualized dividend payment based on the most recent regular dividend payment.'),
  beta: z.number().nullable().default(null).describe('Beta of the stock relative to the market.'),
}).strip()

export type FMPEquityProfileData = z.infer<typeof FMPEquityProfileDataSchema>

// --- Fetcher ---

export class FMPEquityProfileFetcher extends Fetcher {
  static override transformQuery(params: Record<string, unknown>): FMPEquityProfileQueryParams {
    return FMPEquityProfileQueryParamsSchema.parse(params)
  }

  static override async extractData(
    query: FMPEquityProfileQueryParams,
    credentials: Record<string, string> | null,
  ): Promise<Record<string, unknown>[]> {
    const apiKey = credentials?.fmp_api_key ?? ''
    const symbols = query.symbol.split(',')
    const baseUrl = 'https://financialmodelingprep.com/stable/'
    const results: Record<string, unknown>[] = []

    const getOne = async (symbol: string) => {
      const url = `${baseUrl}profile?symbol=${symbol}&apikey=${apiKey}`
      try {
        const result = await amakeRequest<Record<string, unknown>[]>(url, { responseCallback })
        if (result && result.length > 0) {
          results.push(result[0])
        } else {
          // FMP returned an empty array — usually means delisted, never
          // listed, or simply outside FMP's coverage (some international
          // tickers, very obscure assets).
          console.info(`fmp/profile: no profile for ${symbol} (delisted, unsupported region, or outside FMP coverage)`)
        }
      } catch (err) {
        console.warn(`fmp/profile: request failed for ${symbol}:`, err instanceof Error ? err.message : err)
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
    query: FMPEquityProfileQueryParams,
    data: Record<string, unknown>[],
  ): FMPEquityProfileData[] {
    return data.map((d) => {
      // Extract year_low and year_high from range
      const range = d.range as string | undefined
      if (range) {
        const [low, high] = range.split('-')
        d.year_low = parseFloat(low) || null
        d.year_high = parseFloat(high) || null
        delete d.range
      }
      const cleaned = replaceEmptyStrings(d)
      const aliased = applyAliases(cleaned, ALIAS_DICT)
      // FMP returns employees as string — coerce to number
      if (typeof aliased.employees === 'string') aliased.employees = parseInt(aliased.employees, 10) || null
      return FMPEquityProfileDataSchema.parse(aliased)
    })
  }
}
