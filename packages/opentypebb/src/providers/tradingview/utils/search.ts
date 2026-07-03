import { amakeRequest, buildQueryString } from '../../../core/provider/utils/helpers.js'

const SEARCH_URL = 'https://symbol-search.tradingview.com/symbol_search/v3'

export const SEARCH_HEADERS = {
  Origin: 'https://www.tradingview.com',
  'User-Agent': 'Mozilla/5.0',
}

interface TradingViewSearchResponse {
  symbols?: Array<Record<string, unknown>>
}

export function fullSymbol(row: Record<string, unknown>): string {
  const symbol = String(row['symbol'] ?? '').toUpperCase()
  const prefix = typeof row['prefix'] === 'string' ? row['prefix'].toUpperCase() : ''
  const exchange = typeof row['exchange'] === 'string' ? row['exchange'].split(' ')[0].toUpperCase() : ''
  const source = prefix || exchange
  return source ? `${source}:${symbol}` : symbol
}

export function baseSymbolAlias(row: Record<string, unknown>): string[] {
  return typeof row['symbol'] === 'string' ? [row['symbol'].toUpperCase()] : []
}

export async function searchTradingViewSymbols(
  query: string | null | undefined,
  searchType: 'stock' | 'crypto' | 'forex',
): Promise<Record<string, unknown>[]> {
  if (!query) return []
  const normalized = query.toUpperCase().replace(/\s+/g, '+')
  const parts = normalized.split(':')
  const [exchange, text] = parts.length === 2 ? parts : ['', normalized]
  const qs = buildQueryString({
    text,
    search_type: searchType,
    exchange: exchange || undefined,
  })
  const data = await amakeRequest<TradingViewSearchResponse>(`${SEARCH_URL}?${qs}`, { headers: SEARCH_HEADERS })
  return data.symbols ?? []
}
