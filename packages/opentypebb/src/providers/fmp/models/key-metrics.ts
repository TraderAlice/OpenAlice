/**
 * FMP Key Metrics Model.
 * Maps to: openbb_fmp/models/key_metrics.py
 */

import { z } from 'zod'
import { Fetcher } from '../../../core/provider/abstract/fetcher.js'
import { KeyMetricsQueryParamsSchema, KeyMetricsDataSchema } from '../../../standard-models/key-metrics.js'
import { applyAliases } from '../../../core/provider/utils/helpers.js'
import { EmptyDataError } from '../../../core/provider/utils/errors.js'
import { getDataMany } from '../utils/helpers.js'

// --- Query Params ---

export const FMPKeyMetricsQueryParamsSchema = KeyMetricsQueryParamsSchema.extend({
  ttm: z.enum(['include', 'exclude', 'only']).default('only').describe("Specify whether to include, exclude, or only show TTM data."),
  period: z.enum(['q1', 'q2', 'q3', 'q4', 'fy', 'annual', 'quarter']).default('annual').describe('Specify the fiscal period for the data.'),
  limit: z.number().int().nullable().default(null).describe('Number of most recent reporting periods to return.'),
})

export type FMPKeyMetricsQueryParams = z.infer<typeof FMPKeyMetricsQueryParamsSchema>

// --- Data ---

const ALIAS_DICT: Record<string, string> = {
  period_ending: 'date',
  fiscal_period: 'period',
  currency: 'reportedCurrency',
}

const TTM_ALIAS_DICT: Record<string, string> = {
  period_ending: 'date',
  fiscal_period: 'fiscal_period',
  currency: 'reportedCurrency',
  enterprise_value: 'enterpriseValueTTM',
  ev_to_sales: 'evToSalesTTM',
  ev_to_ebitda: 'evToEBITDATTM',
  return_on_equity: 'returnOnEquityTTM',
  return_on_assets: 'returnOnAssetsTTM',
  return_on_invested_capital: 'returnOnInvestedCapitalTTM',
  current_ratio: 'currentRatioTTM',
}

export const FMPKeyMetricsDataSchema = KeyMetricsDataSchema.extend({
  enterprise_value: z.number().nullable().default(null).describe('Enterprise Value.'),
  ev_to_sales: z.number().nullable().default(null).describe('Enterprise Value to Sales ratio.'),
  ev_to_ebitda: z.number().nullable().default(null).describe('Enterprise Value to EBITDA ratio.'),
  return_on_equity: z.number().nullable().default(null).describe('Return on Equity.'),
  return_on_assets: z.number().nullable().default(null).describe('Return on Assets.'),
  return_on_invested_capital: z.number().nullable().default(null).describe('Return on Invested Capital.'),
  current_ratio: z.number().nullable().default(null).describe('Current Ratio.'),
}).passthrough()

export type FMPKeyMetricsData = z.infer<typeof FMPKeyMetricsDataSchema>

// --- Fetcher ---

export class FMPKeyMetricsFetcher extends Fetcher {
  static override transformQuery(params: Record<string, unknown>): FMPKeyMetricsQueryParams {
    return FMPKeyMetricsQueryParamsSchema.parse(params)
  }

  static override async extractData(
    query: FMPKeyMetricsQueryParams,
    credentials: Record<string, string> | null,
  ): Promise<Record<string, unknown>[]> {
    const apiKey = credentials?.fmp_api_key ?? ''
    const symbols = query.symbol.split(',')
    const results: Record<string, unknown>[] = []
    const baseUrl = 'https://financialmodelingprep.com/stable/key-metrics'
    const limit = query.limit && query.ttm !== 'only' ? query.limit : 1

    const getOne = async (symbol: string) => {
      try {
        const ttmUrl = `${baseUrl}-ttm?symbol=${symbol}&apikey=${apiKey}`
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
          // Empty-but-successful: the asset legitimately has no key-metrics
          // data on FMP. Common for ETFs / partnerships / commodity pools
          // (Teucrium CORN, GLD, etc.) — they don't report standard company
          // metrics. info, not warn — this is degradation, not an error.
          console.info(`fmp/key-metrics: no rows for ${symbol} (typical for ETFs / partnerships without conventional fundamentals)`)
        }
      } catch (err) {
        // Real failure path — preserve the cause so it's debuggable.
        console.warn(`fmp/key-metrics: request failed for ${symbol}:`, err instanceof Error ? err.message : err)
      }
    }

    await Promise.all(symbols.map(getOne))

    if (results.length === 0) {
      throw new EmptyDataError('No data found for given symbols.')
    }

    return results
  }

  static override transformData(
    query: FMPKeyMetricsQueryParams,
    data: Record<string, unknown>[],
  ): FMPKeyMetricsData[] {
    const sorted = [...data].sort((a, b) =>
      String(b.date ?? '').localeCompare(String(a.date ?? '')),
    )

    return sorted.map((d) => {
      const isTTM = d.fiscal_period === 'TTM'
      const aliased = applyAliases(d, isTTM ? TTM_ALIAS_DICT : ALIAS_DICT)
      return FMPKeyMetricsDataSchema.parse(aliased)
    })
  }
}
