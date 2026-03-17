/**
 * Duck-typed interfaces for OpenBB clients.
 *
 * Both the HTTP clients (OpenBBEquityClient etc.) and SDK clients (SDKEquityClient etc.)
 * satisfy these interfaces, allowing adapters to accept either implementation.
 */

export interface EquityClientLike {
  search(params: Record<string, unknown>): Promise<Record<string, unknown>[]>
  getHistorical(params: Record<string, unknown>): Promise<Record<string, unknown>[]>
  getProfile(params: Record<string, unknown>): Promise<Record<string, unknown>[]>
  getKeyMetrics(params: Record<string, unknown>): Promise<Record<string, unknown>[]>
  getIncomeStatement(params: Record<string, unknown>): Promise<Record<string, unknown>[]>
  getBalanceSheet(params: Record<string, unknown>): Promise<Record<string, unknown>[]>
  getCashFlow(params: Record<string, unknown>): Promise<Record<string, unknown>[]>
  getFinancialRatios(params: Record<string, unknown>): Promise<Record<string, unknown>[]>
  getEstimateConsensus(params: Record<string, unknown>): Promise<Record<string, unknown>[]>
  getCalendarEarnings(params?: Record<string, unknown>): Promise<Record<string, unknown>[]>
  getInsiderTrading(params: Record<string, unknown>): Promise<Record<string, unknown>[]>
  getGainers(params?: Record<string, unknown>): Promise<Record<string, unknown>[]>
  getLosers(params?: Record<string, unknown>): Promise<Record<string, unknown>[]>
  getActive(params?: Record<string, unknown>): Promise<Record<string, unknown>[]>
}

export interface CryptoClientLike {
  search(params: Record<string, unknown>): Promise<Record<string, unknown>[]>
  getHistorical(params: Record<string, unknown>): Promise<Record<string, unknown>[]>
}

export interface CurrencyClientLike {
  search(params: Record<string, unknown>): Promise<Record<string, unknown>[]>
  getHistorical(params: Record<string, unknown>): Promise<Record<string, unknown>[]>
}

