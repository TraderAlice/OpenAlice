/**
 * YFinance Key Metrics Model.
 * Maps to: openbb_yfinance/models/key_metrics.py
 */

import { z } from 'zod'
import { Fetcher } from '../../../core/provider/abstract/fetcher.js'
import { KeyMetricsQueryParamsSchema, KeyMetricsDataSchema } from '../../../standard-models/key-metrics.js'
import { applyAliases } from '../../../core/provider/utils/helpers.js'
import { EmptyDataError } from '../../../core/provider/utils/errors.js'
import { getQuoteSummary } from '../utils/helpers.js'

// Canonical field names deliberately align with the FMP provider's aliases
// (price_to_earnings, ev_to_ebitda, gross_profit_margin, …) so downstream
// consumers can read one set of keys across providers.
const ALIAS_DICT: Record<string, string> = {
  market_cap: 'marketCap',
  price_to_earnings: 'trailingPE',
  forward_pe: 'forwardPE',
  peg_ratio: 'pegRatio',
  peg_ratio_ttm: 'trailingPegRatio',
  eps_ttm: 'trailingEps',
  eps_forward: 'forwardEps',
  ev_to_ebitda: 'enterpriseToEbitda',
  ev_to_sales: 'enterpriseToRevenue',
  price_to_sales: 'priceToSalesTrailing12Months',
  earnings_growth: 'earningsGrowth',
  earnings_growth_quarterly: 'earningsQuarterlyGrowth',
  revenue_per_share: 'revenuePerShare',
  revenue_growth: 'revenueGrowth',
  cash_per_share: 'totalCashPerShare',
  quick_ratio: 'quickRatio',
  current_ratio: 'currentRatio',
  debt_to_equity: 'debtToEquity',
  gross_profit_margin: 'grossMargins',
  operating_profit_margin: 'operatingMargins',
  ebitda_margin: 'ebitdaMargins',
  net_profit_margin: 'profitMargins',
  return_on_assets: 'returnOnAssets',
  return_on_equity: 'returnOnEquity',
  dividend_yield: 'dividendYield',
  dividend_yield_5y_avg: 'fiveYearAvgDividendYield',
  payout_ratio: 'payoutRatio',
  book_value: 'bookValue',
  price_to_book: 'priceToBook',
  enterprise_value: 'enterpriseValue',
  overall_risk: 'overallRisk',
  audit_risk: 'auditRisk',
  board_risk: 'boardRisk',
  compensation_risk: 'compensationRisk',
  shareholder_rights_risk: 'shareHolderRightsRisk',
  price_return_1y: '52WeekChange',
  currency: 'financialCurrency',
}

export const YFinanceKeyMetricsQueryParamsSchema = KeyMetricsQueryParamsSchema
export type YFinanceKeyMetricsQueryParams = z.infer<typeof YFinanceKeyMetricsQueryParamsSchema>

export const YFinanceKeyMetricsDataSchema = KeyMetricsDataSchema.extend({
  price_to_earnings: z.number().nullable().default(null).describe('Price-to-earnings ratio (TTM).'),
  forward_pe: z.number().nullable().default(null).describe('Forward price-to-earnings ratio.'),
  peg_ratio: z.number().nullable().default(null).describe('PEG ratio (5-year expected).'),
  peg_ratio_ttm: z.number().nullable().default(null).describe('PEG ratio (TTM).'),
  eps_ttm: z.number().nullable().default(null).describe('Earnings per share (TTM).'),
  eps_forward: z.number().nullable().default(null).describe('Forward earnings per share.'),
  ev_to_ebitda: z.number().nullable().default(null).describe('Enterprise value to EBITDA ratio.'),
  ev_to_sales: z.number().nullable().default(null).describe('Enterprise value to sales ratio.'),
  price_to_sales: z.number().nullable().default(null).describe('Price-to-sales ratio (TTM).'),
  earnings_growth: z.number().nullable().default(null).describe('Earnings growth (YoY).'),
  earnings_growth_quarterly: z.number().nullable().default(null).describe('Quarterly earnings growth (YoY).'),
  revenue_per_share: z.number().nullable().default(null).describe('Revenue per share (TTM).'),
  revenue_growth: z.number().nullable().default(null).describe('Revenue growth (YoY).'),
  cash_per_share: z.number().nullable().default(null).describe('Cash per share.'),
  quick_ratio: z.number().nullable().default(null).describe('Quick ratio.'),
  current_ratio: z.number().nullable().default(null).describe('Current ratio.'),
  debt_to_equity: z.number().nullable().default(null).describe('Debt-to-equity ratio.'),
  gross_profit_margin: z.number().nullable().default(null).describe('Gross profit margin.'),
  operating_profit_margin: z.number().nullable().default(null).describe('Operating profit margin.'),
  ebitda_margin: z.number().nullable().default(null).describe('EBITDA margin.'),
  net_profit_margin: z.number().nullable().default(null).describe('Net profit margin.'),
  return_on_assets: z.number().nullable().default(null).describe('Return on assets.'),
  return_on_equity: z.number().nullable().default(null).describe('Return on equity.'),
  dividend_yield: z.number().nullable().default(null).describe('Dividend yield.'),
  dividend_yield_5y_avg: z.number().nullable().default(null).describe('5-year average dividend yield.'),
  payout_ratio: z.number().nullable().default(null).describe('Payout ratio.'),
  book_value: z.number().nullable().default(null).describe('Book value per share.'),
  price_to_book: z.number().nullable().default(null).describe('Price-to-book ratio.'),
  enterprise_value: z.number().nullable().default(null).describe('Enterprise value.'),
  overall_risk: z.number().nullable().default(null).describe('Overall risk score.'),
  audit_risk: z.number().nullable().default(null).describe('Audit risk score.'),
  board_risk: z.number().nullable().default(null).describe('Board risk score.'),
  compensation_risk: z.number().nullable().default(null).describe('Compensation risk score.'),
  shareholder_rights_risk: z.number().nullable().default(null).describe('Shareholder rights risk score.'),
  beta: z.number().nullable().default(null).describe('Beta relative to the broad market.'),
  price_return_1y: z.number().nullable().default(null).describe('One-year price return.'),
}).passthrough()
export type YFinanceKeyMetricsData = z.infer<typeof YFinanceKeyMetricsDataSchema>

export class YFinanceKeyMetricsFetcher extends Fetcher {
  static override transformQuery(params: Record<string, unknown>): YFinanceKeyMetricsQueryParams {
    return YFinanceKeyMetricsQueryParamsSchema.parse(params)
  }

  static override async extractData(
    query: YFinanceKeyMetricsQueryParams,
    credentials: Record<string, string> | null,
  ): Promise<Record<string, unknown>[]> {
    const symbols = query.symbol.split(',').map(s => s.trim()).filter(Boolean)
    const results = await Promise.allSettled(
      symbols.map(s => getQuoteSummary(s, ['defaultKeyStatistics', 'summaryDetail', 'financialData']))
    )
    const data: Record<string, unknown>[] = []
    for (const r of results) {
      if (r.status === 'fulfilled' && r.value) data.push(r.value)
    }
    return data
  }

  static override transformData(
    query: YFinanceKeyMetricsQueryParams,
    data: Record<string, unknown>[],
  ): YFinanceKeyMetricsData[] {
    if (!data.length) throw new EmptyDataError('No key metrics data returned')
    return data.map(d => {
      const aliased = applyAliases(d, ALIAS_DICT)
      // Normalize 5y avg dividend yield (comes as whole number, not decimal)
      if (typeof aliased.dividend_yield_5y_avg === 'number') {
        aliased.dividend_yield_5y_avg = aliased.dividend_yield_5y_avg / 100
      }
      return YFinanceKeyMetricsDataSchema.parse(aliased)
    })
  }
}
