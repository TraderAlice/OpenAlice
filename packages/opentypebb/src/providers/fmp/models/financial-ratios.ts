/**
 * FMP Financial Ratios Model.
 * Maps to: openbb_fmp/models/financial_ratios.py
 */

import { z } from 'zod'
import { Fetcher } from '../../../core/provider/abstract/fetcher.js'
import { FinancialRatiosQueryParamsSchema, FinancialRatiosDataSchema } from '../../../standard-models/financial-ratios.js'
import { applyAliases } from '../../../core/provider/utils/helpers.js'
import { EmptyDataError } from '../../../core/provider/utils/errors.js'
import { getDataMany } from '../utils/helpers.js'

// --- Query Params ---

export const FMPFinancialRatiosQueryParamsSchema = FinancialRatiosQueryParamsSchema.extend({
  ttm: z.enum(['include', 'exclude', 'only']).default('only').describe("Specify whether to include, exclude, or only show TTM data. Default: 'only'."),
  period: z.enum(['q1', 'q2', 'q3', 'q4', 'fy', 'annual', 'quarter']).default('annual').describe('Specify the fiscal period for the data.'),
  limit: z.number().int().nullable().default(null).describe('Number of most recent reporting periods to return.'),
})

export type FMPFinancialRatiosQueryParams = z.infer<typeof FMPFinancialRatiosQueryParamsSchema>

// --- Data ---

const ALIAS_DICT: Record<string, string> = {
  currency: 'reportedCurrency',
  period_ending: 'date',
  fiscal_period: 'period',
  price_to_earnings: 'priceToEarningsRatio',
  price_to_book: 'priceToBookRatio',
  price_to_sales: 'priceToSalesRatio',
  debt_to_equity: 'debtToEquityRatio',
  debt_to_assets: 'debtToAssetsRatio',
  current_ratio: 'currentRatio',
  gross_profit_margin: 'grossProfitMargin',
  net_profit_margin: 'netProfitMargin',
  operating_profit_margin: 'operatingProfitMargin',
  dividend_yield: 'dividendYield',
  return_on_equity: 'returnOnEquity',
  return_on_assets: 'returnOnAssets',
}

// TTM alias variants
const TTM_ALIAS_DICT: Record<string, string> = {
  currency: 'reportedCurrency',
  period_ending: 'date',
  fiscal_period: 'fiscal_period',
  price_to_earnings: 'priceToEarningsRatioTTM',
  price_to_book: 'priceToBookRatioTTM',
  price_to_sales: 'priceToSalesRatioTTM',
  debt_to_equity: 'debtToEquityRatioTTM',
  debt_to_assets: 'debtToAssetsRatioTTM',
  current_ratio: 'currentRatioTTM',
  gross_profit_margin: 'grossProfitMarginTTM',
  net_profit_margin: 'netProfitMarginTTM',
  operating_profit_margin: 'operatingProfitMarginTTM',
  dividend_yield: 'dividendYieldTTM',
  return_on_equity: 'returnOnEquityTTM',
  return_on_assets: 'returnOnAssetsTTM',
}

export const FMPFinancialRatiosDataSchema = FinancialRatiosDataSchema.extend({
  currency: z.string().nullable().default(null).describe('Currency in which the company reports financials.'),
  gross_profit_margin: z.number().nullable().default(null).describe('Gross profit margin.'),
  net_profit_margin: z.number().nullable().default(null).describe('Net profit margin.'),
  operating_profit_margin: z.number().nullable().default(null).describe('Operating profit margin.'),
  current_ratio: z.number().nullable().default(null).describe('Current ratio.'),
  debt_to_equity: z.number().nullable().default(null).describe('Debt to equity ratio.'),
  debt_to_assets: z.number().nullable().default(null).describe('Debt to assets ratio.'),
  price_to_earnings: z.number().nullable().default(null).describe('Price to earnings ratio.'),
  price_to_book: z.number().nullable().default(null).describe('Price to book ratio.'),
  price_to_sales: z.number().nullable().default(null).describe('Price to sales ratio.'),
  dividend_yield: z.number().nullable().default(null).describe('Dividend yield.'),
  return_on_equity: z.number().nullable().default(null).describe('Return on equity.'),
  return_on_assets: z.number().nullable().default(null).describe('Return on assets.'),
}).passthrough()

export type FMPFinancialRatiosData = z.infer<typeof FMPFinancialRatiosDataSchema>

// --- Fetcher ---

export class FMPFinancialRatiosFetcher extends Fetcher {
  static override transformQuery(params: Record<string, unknown>): FMPFinancialRatiosQueryParams {
    return FMPFinancialRatiosQueryParamsSchema.parse(params)
  }

  static override async extractData(
    query: FMPFinancialRatiosQueryParams,
    credentials: Record<string, string> | null,
  ): Promise<Record<string, unknown>[]> {
    const apiKey = credentials?.fmp_api_key ?? ''
    const symbols = query.symbol.split(',')
    const results: Record<string, unknown>[] = []
    const baseUrl = 'https://financialmodelingprep.com/stable/ratios'

    const getOne = async (symbol: string) => {
      try {
        const ttmUrl = `${baseUrl}-ttm?symbol=${symbol}&apikey=${apiKey}`
        const limit = query.ttm !== 'only' ? (query.limit ?? 5) : 1
        const metricsUrl = `${baseUrl}?symbol=${symbol}&period=${query.period}&limit=${limit}&apikey=${apiKey}`

        const [ttmData, metricsData] = await Promise.all([
          getDataMany(ttmUrl).catch(() => []),
          getDataMany(metricsUrl).catch(() => []),
        ])

        const result: Record<string, unknown>[] = []
        let currency: string | null = null

        if (metricsData.length > 0) {
          if (query.ttm !== 'only') {
            result.push(...metricsData)
          }
          currency = metricsData[0].reportedCurrency as string ?? null
        }

        if (ttmData.length > 0 && query.ttm !== 'exclude') {
          const ttmResult = { ...ttmData[0] }
          ttmResult.date = new Date().toISOString().split('T')[0]
          ttmResult.fiscal_period = 'TTM'
          ttmResult.fiscal_year = new Date().getFullYear()
          if (currency) ttmResult.reportedCurrency = currency
          result.unshift(ttmResult)
        }

        if (result.length > 0) {
          results.push(...result)
        } else {
          // Asset has no traditional financial ratios on FMP — typical for
          // ETFs, commodity pools, and other non-operating-company structures.
          console.info(`fmp/ratios: no rows for ${symbol} (typical for ETFs / partnerships without conventional fundamentals)`)
        }
      } catch (err) {
        console.warn(`fmp/ratios: request failed for ${symbol}:`, err instanceof Error ? err.message : err)
      }
    }

    await Promise.all(symbols.map(getOne))

    if (results.length === 0) {
      throw new EmptyDataError('No data found for given symbols.')
    }

    return results
  }

  static override transformData(
    query: FMPFinancialRatiosQueryParams,
    data: Record<string, unknown>[],
  ): FMPFinancialRatiosData[] {
    const sorted = [...data].sort((a, b) =>
      String(b.date ?? '').localeCompare(String(a.date ?? '')),
    )

    return sorted.map((d) => {
      const isTTM = d.fiscal_period === 'TTM'
      const aliased = applyAliases(d, isTTM ? TTM_ALIAS_DICT : ALIAS_DICT)
      return FMPFinancialRatiosDataSchema.parse(aliased)
    })
  }
}
