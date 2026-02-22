export interface CommodityPsdQuery {
  report_id?: string
  commodity?: string
  attribute?: string
  country?: string
  start_year?: number
  end_year?: number
  provider?: string
  [key: string]: unknown
}

export interface CommodityPsdData {
  region: string | null
  country: string | null
  commodity: string | null
  attribute: string | null
  marketing_year: string | null
  value: number | null
  unit: string | null
  [key: string]: unknown
}
