/**
 * YFinance Cash Flow Statement Model.
 * Maps to: openbb_yfinance/models/cash_flow.py
 */

import { z } from 'zod'
import { Fetcher } from '../../../core/provider/abstract/fetcher.js'
import { CashFlowStatementQueryParamsSchema, CashFlowStatementDataSchema } from '../../../standard-models/cash-flow.js'
import { applyAliases } from '../../../core/provider/utils/helpers.js'
import { getFinancialStatements } from '../utils/helpers.js'

// --- Query Params ---

export const YFinanceCashFlowStatementQueryParamsSchema = CashFlowStatementQueryParamsSchema.extend({
  period: z.enum(['annual', 'quarter']).default('annual').describe('Time period of the data to return.'),
  limit: z.coerce.number().int().min(1).max(5).nullable().default(5).describe('The number of data entries to return (max 5).'),
})

export type YFinanceCashFlowStatementQueryParams = z.infer<typeof YFinanceCashFlowStatementQueryParamsSchema>

// --- Data ---

// Names mirror FMP's canonical output so a single key-lookup works across
// providers. Activity-level cash flow lines get the most attention because
// every statement-reading UI wants them.
const ALIAS_DICT: Record<string, string> = {
  net_cash_from_operating_activities: 'operating_cash_flow',
  net_cash_from_investing_activities: 'investing_cash_flow',
  net_cash_from_financing_activities: 'financing_cash_flow',
  cash_at_end_of_period: 'end_cash_position',
  investments_in_property_plant_and_equipment: 'purchase_of_ppe',
  issuance_of_common_equity: 'common_stock_issuance',
  repurchase_of_common_equity: 'common_stock_payments',
  cash_dividends_paid: 'payment_of_dividends',
  net_change_in_cash_and_equivalents: 'changes_in_cash',
}

export const YFinanceCashFlowStatementDataSchema = CashFlowStatementDataSchema.extend({}).passthrough()
export type YFinanceCashFlowStatementData = z.infer<typeof YFinanceCashFlowStatementDataSchema>

// --- Fetcher ---

export class YFinanceCashFlowStatementFetcher extends Fetcher {
  static override requireCredentials = false

  static override transformQuery(params: Record<string, unknown>): YFinanceCashFlowStatementQueryParams {
    return YFinanceCashFlowStatementQueryParamsSchema.parse(params)
  }

  static override async extractData(
    query: YFinanceCashFlowStatementQueryParams,
    credentials: Record<string, string> | null,
  ): Promise<Record<string, unknown>[]> {
    return getFinancialStatements(query.symbol, query.period, query.limit ?? 5)
  }

  static override transformData(
    query: YFinanceCashFlowStatementQueryParams,
    data: Record<string, unknown>[],
  ): YFinanceCashFlowStatementData[] {
    return data.map(d => {
      const aliased = applyAliases(d, ALIAS_DICT)
      return YFinanceCashFlowStatementDataSchema.parse(aliased)
    })
  }
}
