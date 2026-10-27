export interface SectorEtf {
  symbol: string
  sector: string
}

/** The fixed 11 SPDR Select Sector ETFs (GICS sector classification). */
export const GICS_SECTOR_ETFS: SectorEtf[] = [
  { symbol: 'XLK', sector: 'Technology' },
  { symbol: 'XLC', sector: 'Communication Services' },
  { symbol: 'XLY', sector: 'Consumer Discretionary' },
  { symbol: 'XLP', sector: 'Consumer Staples' },
  { symbol: 'XLE', sector: 'Energy' },
  { symbol: 'XLF', sector: 'Financials' },
  { symbol: 'XLV', sector: 'Health Care' },
  { symbol: 'XLI', sector: 'Industrials' },
  { symbol: 'XLB', sector: 'Materials' },
  { symbol: 'XLRE', sector: 'Real Estate' },
  { symbol: 'XLU', sector: 'Utilities' },
]
