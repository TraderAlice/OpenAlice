export interface CommoditySpotQuery {
  start_date?: string
  end_date?: string
  provider?: string
  [key: string]: unknown
}

export interface CommoditySpotData {
  date: string
  symbol: string | null
  commodity: string | null
  price: number
  unit: string | null
  [key: string]: unknown
}
