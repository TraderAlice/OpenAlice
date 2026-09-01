export const TUSHARE_API_NAMES = [
  'stock_basic',
  'stock_company',
  'stock_st',
  'namechange',
  'suspend_d',
  'trade_cal',
  'daily',
  'adj_factor',
  'daily_basic',
  'income',
  'balancesheet',
  'cashflow',
  'fina_indicator',
  'forecast',
  'express',
  'disclosure_date',
  'index_basic',
  'index_classify',
  'index_member_all',
  'index_weight',
] as const

export type TushareApiName = (typeof TUSHARE_API_NAMES)[number]

export type TushareValue = string | number | boolean | null
export type TushareRow = Record<string, TushareValue>

export interface TushareRuntimeConfig {
  enabled: boolean
  baseUrl: string
  token?: string
}

export interface TushareResponseData {
  fields?: unknown
  items?: unknown
}

export interface TushareResponseEnvelope {
  code?: unknown
  msg?: unknown
  data?: TushareResponseData | null
}

export interface TushareDataset {
  data: TushareRow[]
  meta: {
    provider: 'tushare'
    asOf: string
    origin: 'local'
  }
}
