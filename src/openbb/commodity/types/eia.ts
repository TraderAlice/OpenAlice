export interface EiaReportQuery {
  start_date?: string
  end_date?: string
  provider?: string
  [key: string]: unknown
}

export interface EiaReportData {
  date: string
  table: string | null
  symbol: string
  order: number | null
  title: string | null
  value: number
  unit: string | null
  [key: string]: unknown
}
