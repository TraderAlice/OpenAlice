/**
 * YFinance Income Statement Model.
 * Maps to: openbb_yfinance/models/income_statement.py
 */

import { z } from 'zod'
import { Fetcher } from '../../../core/provider/abstract/fetcher.js'
import { IncomeStatementQueryParamsSchema, IncomeStatementDataSchema } from '../../../standard-models/income-statement.js'
import { applyAliases } from '../../../core/provider/utils/helpers.js'
import { getFinancialStatements } from '../utils/helpers.js'

// --- Query Params ---

export const YFinanceIncomeStatementQueryParamsSchema = IncomeStatementQueryParamsSchema.extend({
  period: z.enum(['annual', 'quarter']).default('annual').describe('Time period of the data to return.'),
  limit: z.coerce.number().int().min(1).max(5).nullable().default(5).describe('The number of data entries to return (max 5).'),
})

export type YFinanceIncomeStatementQueryParams = z.infer<typeof YFinanceIncomeStatementQueryParamsSchema>

// --- Data ---

// Canonical names chosen to match FMP's post-alias output so downstream
// consumers can read one key per concept regardless of provider.
const ALIAS_DICT: Record<string, string> = {
  revenue: 'total_revenue',
  selling_general_and_admin_expense: 'selling_general_and_administration',
  research_and_development_expense: 'research_and_development',
  total_operating_income: 'total_operating_income_as_reported',
  income_tax_expense: 'tax_provision',
  consolidated_net_income: 'net_income',
  total_pre_tax_income: 'pretax_income',
  net_income_attributable_to_common_shareholders: 'net_income_common_stockholders',
  weighted_average_basic_shares_outstanding: 'basic_average_shares',
  weighted_average_diluted_shares_outstanding: 'diluted_average_shares',
  basic_earnings_per_share: 'basic_eps',
  diluted_earnings_per_share: 'diluted_eps',
}

export const YFinanceIncomeStatementDataSchema = IncomeStatementDataSchema.extend({}).passthrough()
export type YFinanceIncomeStatementData = z.infer<typeof YFinanceIncomeStatementDataSchema>

// --- Fetcher ---

export class YFinanceIncomeStatementFetcher extends Fetcher {
  static override requireCredentials = false

  static override transformQuery(params: Record<string, unknown>): YFinanceIncomeStatementQueryParams {
    return YFinanceIncomeStatementQueryParamsSchema.parse(params)
  }

  static override async extractData(
    query: YFinanceIncomeStatementQueryParams,
    credentials: Record<string, string> | null,
  ): Promise<Record<string, unknown>[]> {
    return getFinancialStatements(query.symbol, query.period, query.limit ?? 5)
  }

  static override transformData(
    query: YFinanceIncomeStatementQueryParams,
    data: Record<string, unknown>[],
  ): YFinanceIncomeStatementData[] {
    return data.map(d => {
      const aliased = applyAliases(d, ALIAS_DICT)
      return YFinanceIncomeStatementDataSchema.parse(aliased)
    })
  }
}
