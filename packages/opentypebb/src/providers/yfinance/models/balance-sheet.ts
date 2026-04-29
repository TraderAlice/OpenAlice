/**
 * YFinance Balance Sheet Model.
 * Maps to: openbb_yfinance/models/balance_sheet.py
 */

import { z } from 'zod'
import { Fetcher } from '../../../core/provider/abstract/fetcher.js'
import { BalanceSheetQueryParamsSchema, BalanceSheetDataSchema } from '../../../standard-models/balance-sheet.js'
import { applyAliases } from '../../../core/provider/utils/helpers.js'
import { getFinancialStatements } from '../utils/helpers.js'

// --- Query Params ---

export const YFinanceBalanceSheetQueryParamsSchema = BalanceSheetQueryParamsSchema.extend({
  period: z.enum(['annual', 'quarter']).default('annual').describe('Time period of the data to return.'),
  limit: z.coerce.number().int().min(1).max(5).nullable().default(5).describe('The number of data entries to return (max 5).'),
})

export type YFinanceBalanceSheetQueryParams = z.infer<typeof YFinanceBalanceSheetQueryParamsSchema>

// --- Data ---

// yahoo-finance2 keys → canonical snake_case aliases. Names are picked to
// match what FMP emits after its own alias pass, so consumers see one
// schema across providers.
const ALIAS_DICT: Record<string, string> = {
  short_term_investments: 'other_short_term_investments',
  net_receivables: 'receivables',
  inventories: 'inventory',
  total_current_assets: 'current_assets',
  total_current_liabilities: 'current_liabilities',
  short_term_debt: 'current_debt',
  total_liabilities: 'total_liabilities_net_minority_interest',
  plant_property_equipment_gross: 'gross_ppe',
  plant_property_equipment_net: 'net_ppe',
  total_common_equity: 'stockholders_equity',
  total_equity_non_controlling_interests: 'total_equity_gross_minority_interest',
}

export const YFinanceBalanceSheetDataSchema = BalanceSheetDataSchema.extend({}).passthrough()
export type YFinanceBalanceSheetData = z.infer<typeof YFinanceBalanceSheetDataSchema>

// --- Fetcher ---

export class YFinanceBalanceSheetFetcher extends Fetcher {
  static override requireCredentials = false

  static override transformQuery(params: Record<string, unknown>): YFinanceBalanceSheetQueryParams {
    return YFinanceBalanceSheetQueryParamsSchema.parse(params)
  }

  static override async extractData(
    query: YFinanceBalanceSheetQueryParams,
    credentials: Record<string, string> | null,
  ): Promise<Record<string, unknown>[]> {
    return getFinancialStatements(query.symbol, query.period, query.limit ?? 5)
  }

  static override transformData(
    query: YFinanceBalanceSheetQueryParams,
    data: Record<string, unknown>[],
  ): YFinanceBalanceSheetData[] {
    return data.map(d => {
      const aliased = applyAliases(d, ALIAS_DICT)
      return YFinanceBalanceSheetDataSchema.parse(aliased)
    })
  }
}
