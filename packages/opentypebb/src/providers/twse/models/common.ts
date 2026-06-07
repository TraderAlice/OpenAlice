/**
 * Shared helpers for the TWSE provider's data fetchers.
 *
 * Conventions across TWSE / TPEx open-data endpoints (verified live 2026-06-08):
 * - Dates use the ROC calendar packed as "YYYMMDD" (e.g. "1150605" = 2026-06-05).
 * - All numbers arrive as strings; empty string means "no data". TPEx signs
 *   changes ("+0.06"), TWSE uses plain negatives ("-0.3100").
 * - Symbols follow the Yahoo suffix convention established by EquitySearch:
 *   `2330.TW` (TWSE listed) / `6488.TWO` (TPEx OTC); bare codes match either.
 */

export type TwBoard = 'TWSE' | 'TPEX'

export interface ParsedTwSymbol {
  code: string
  /** undefined = no suffix — search both boards. */
  board: TwBoard | undefined
}

export const TW_HEADERS = { Accept: 'application/json' }

/** ROC packed date ("1150605") → ISO ("2026-06-05"). Null on empty/malformed. */
export function rocToIso(value: string | undefined): string | null {
  if (!value || !/^\d{6,7}$/.test(value)) return null
  const rocYear = Number(value.slice(0, value.length - 4))
  const month = value.slice(-4, -2)
  const day = value.slice(-2)
  return `${rocYear + 1911}-${month}-${day}`
}

/** Numeric string → number. Tolerates "+" signs and thousands separators; null on empty/non-numeric. */
export function toNum(value: string | undefined): number | null {
  if (value === undefined) return null
  const cleaned = value.replace(/,/g, '').replace(/^\+/, '').trim()
  if (cleaned === '') return null
  const n = Number(cleaned)
  return Number.isFinite(n) ? n : null
}

/** Split a Yahoo-suffixed Taiwan symbol into code + board. */
export function parseTwSymbol(symbol: string): ParsedTwSymbol {
  const upper = symbol.trim().toUpperCase()
  if (upper.endsWith('.TWO')) return { code: upper.slice(0, -4), board: 'TPEX' }
  if (upper.endsWith('.TW')) return { code: upper.slice(0, -3), board: 'TWSE' }
  return { code: upper, board: undefined }
}

/** Which board-wide snapshot lists must be fetched to resolve these symbols. */
export function boardsNeeded(symbols: ParsedTwSymbol[]): { twse: boolean; tpex: boolean } {
  let twse = false
  let tpex = false
  for (const s of symbols) {
    if (s.board === 'TWSE') twse = true
    else if (s.board === 'TPEX') tpex = true
    else { twse = true; tpex = true }
  }
  return { twse, tpex }
}

/** Yahoo-suffix a code for its board. */
export function toYahooSymbol(code: string, board: TwBoard): string {
  return `${code}.${board === 'TWSE' ? 'TW' : 'TWO'}`
}

/** Parse a comma-separated symbol query into distinct parsed symbols. */
export function parseSymbolList(symbol: string): ParsedTwSymbol[] {
  return symbol.split(',').map((s) => s.trim()).filter(Boolean).map(parseTwSymbol)
}
