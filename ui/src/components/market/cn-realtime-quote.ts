/**
 * Resolve whether a Market symbol should use the free Tencent A-share Level-1
 * snapshot path (3s poll) instead of the default equity quote vendor.
 *
 * Keep this UI-side mapping aligned with `toTencentCode` in
 * `packages/opentypebb/src/providers/tencent/common.ts`.
 */

export interface CnRealtimeQuoteRoute {
  /** Symbol passed to `/equity/price/quote` (any form Tencent accepts). */
  symbol: string
  provider: 'tencent'
  /** Recommended poll interval for ordinary L1 watching. */
  pollMs: number
}

const DEFAULT_POLL_MS = 3_000

function looksLikeAShare(symbol: string): boolean {
  const s = symbol.trim()
  if (/^(sh|sz)\d{6}$/i.test(s)) return true
  if (/^\d{6}\.(SS|SZ)$/i.test(s)) return true
  if (/^[01]\.\d{6}$/.test(s)) return true
  if (/^\d{6}$/.test(s)) {
    return s.startsWith('6') || s.startsWith('0') || s.startsWith('3')
  }
  return false
}

/**
 * Prefer an Eastmoney bar source when present (secid → still valid for Tencent),
 * otherwise detect Yahoo / bare A-share tickers.
 */
export function resolveCnRealtimeQuote(
  symbol: string,
  source?: string,
): CnRealtimeQuoteRoute | null {
  const eastmoney = source?.match(/^eastmoney\|([01]\.\d{6})$/)
  if (eastmoney) {
    return { symbol: eastmoney[1], provider: 'tencent', pollMs: DEFAULT_POLL_MS }
  }
  if (looksLikeAShare(symbol)) {
    return { symbol: symbol.trim(), provider: 'tencent', pollMs: DEFAULT_POLL_MS }
  }
  return null
}
