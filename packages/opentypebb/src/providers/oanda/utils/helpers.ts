/**
 * OANDA v20 helper utilities — request plumbing shared by the OANDA
 * provider fetchers (account resolution, endpoint URLs, granularity
 * mapping, candle normalization).
 */

import { amakeRequest } from '../../../core/provider/utils/helpers.js'
import { OpenBBError } from '../../../core/provider/utils/errors.js'

/** OANDA REST host for practice (paper) accounts. */
export const OANDA_BASE_URL = 'https://api-fxpractice.oanda.com'

/** OpenAlice interval → OANDA v20 granularity (approximations documented). */
export const INTERVAL_GRANULARITY: Record<string, string> = {
  '1m': 'M1',
  '2m': 'M2',
  '5m': 'M5',
  '15m': 'M15',
  '30m': 'M30',
  '60m': 'H1',
  '90m': 'H2', // OANDA has no 90m bar — H2 is the closest available
  '1h': 'H1',
  '4h': 'H4',
  '1d': 'D',
  '5d': 'W', // OANDA has no 5-day bar — W is the closest available
  '1W': 'W',
  '1M': 'M',
  '1Q': 'M', // OANDA has no quarterly bar — M is the closest available
}

/** Nominal bar length in milliseconds per OANDA granularity (count estimation). */
export const GRANULARITY_MS: Record<string, number> = {
  M1: 60_000,
  M2: 120_000,
  M5: 300_000,
  M15: 900_000,
  M30: 1_800_000,
  H1: 3_600_000,
  H2: 7_200_000,
  H4: 14_400_000,
  H8: 28_800_000,
  H12: 43_200_000,
  D: 86_400_000,
  W: 604_800_000,
  M: 2_592_000_000,
}

/**
 * Normalize a user-supplied FX symbol to OANDA's canonical name:
 * uppercase, underscore-separated 6-letter pairs ("EURGBP" → "EUR_GBP",
 * "eur-gbp" → "EUR_GBP"). Non-pair symbols (metals, CFDs, indices) pass
 * through unchanged apart from uppercasing.
 */
export function normalizeOandaSymbol(symbol: string): string {
  let s = symbol.trim().toUpperCase()
  if (/^[A-Z]{6}$/.test(s)) {
    s = `${s.slice(0, 3)}_${s.slice(3)}`
  } else if (s.includes('-')) {
    s = s.replace(/-/g, '_')
  }
  return s
}

/** Bearer token from the provider credentials surface. */
export function oandaToken(credentials: Record<string, string> | null): string {
  const token = credentials?.oanda_api_key
  if (!token) {
    throw new OpenBBError(
      "Missing credential 'oanda_api_key'. Get a free OANDA practice token at oanda.com → Manage API Access.",
    )
  }
  return token
}

export interface OandaAccountInfo {
  id: string
  currency: string
  name?: string
}

/**
 * Resolve the account id bound to the API token. OANDA's v20 endpoints are
 * account-scoped, but the token alone is enough to enumerate the accounts
 * it can see; the first usable account wins.
 */
export async function getOandaAccount(credentials: Record<string, string> | null): Promise<OandaAccountInfo> {
  const token = oandaToken(credentials)
  const res = await amakeRequest<{ accounts?: Array<{ id?: string; currency?: string; name?: string }> }>(
    `${OANDA_BASE_URL}/v3/accounts`,
    { headers: { Authorization: `Bearer ${token}` }, timeoutMs: 15_000 },
  )
  const account = res.accounts?.find((a) => a.id) ?? res.accounts?.[0]
  if (!account?.id) {
    throw new OpenBBError('OANDA: no trading account found for this API token.')
  }
  return { id: account.id, currency: account.currency ?? 'USD', name: account.name }
}

interface OandaCandle {
  complete?: boolean
  volume?: number
  time?: string
  mid?: { o?: string | number; h?: string | number; l?: string | number; c?: string | number }
}

/** Fetch candles from OANDA for one instrument. */
export async function getOandaCandles(
  credentials: Record<string, string> | null,
  instrument: string,
  granularity: string,
  count: number,
): Promise<OandaCandle[]> {
  const token = oandaToken(credentials)
  const account = await getOandaAccount(credentials)
  const url =
    `${OANDA_BASE_URL}/v3/accounts/${account.id}/instruments/${encodeURIComponent(instrument)}/candles` +
    `?granularity=${encodeURIComponent(granularity)}&price=M&count=${Math.min(Math.max(Math.trunc(count), 1), 5000)}`
  const res = await amakeRequest<{ candles?: OandaCandle[] }>(url, {
    headers: { Authorization: `Bearer ${token}` },
    timeoutMs: 15_000,
  })
  return res.candles ?? []
}

interface OandaInstrument {
  name?: string
  displayName?: string
  type?: string
  currency?: string
}

/** Fetch the account's tradable instruments, optionally filtered by type. */
export async function getOandaInstruments(
  credentials: Record<string, string> | null,
): Promise<OandaInstrument[]> {
  const token = oandaToken(credentials)
  const account = await getOandaAccount(credentials)
  const url = `${OANDA_BASE_URL}/v3/accounts/${account.id}/instruments`
  const res = await amakeRequest<{ instruments?: OandaInstrument[] }>(url, {
    headers: { Authorization: `Bearer ${token}` },
    timeoutMs: 15_000,
  })
  return res.instruments ?? []
}

/** Estimate how many candles the requested date window needs (cap 5000). */
export function estimateCandleCount(
  granularity: string,
  startDate?: string | null,
  endDate?: string | null,
): number {
  const barMs = GRANULARITY_MS[granularity]
  if (!barMs) return 250
  const end = endDate ? Date.parse(endDate) : Date.now()
  const start = startDate ? Date.parse(startDate) : end
  if (Number.isNaN(start) || Number.isNaN(end) || end <= start) return 250
  const spanMs = end - start
  const count = Math.ceil(spanMs / barMs) + 10
  return Math.min(Math.max(count, 1), 5000)
}

/** Coerce OANDA's string-typed prices to numbers. */
function toNumber(v: string | number | undefined): number | null {
  if (v === undefined || v === null) return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}

/** Map an OANDA candle to the standard CurrencyHistoricalData shape. */
export function candleToHistorical(c: OandaCandle): {
  date: string
  open: number | null
  high: number | null
  low: number | null
  close: number | null
  volume: number | null
  vwap: number | null
} {
  const mid = c.mid ?? {}
  return {
    date: c.time ?? '',
    open: toNumber(mid.o),
    high: toNumber(mid.h),
    low: toNumber(mid.l),
    close: toNumber(mid.c),
    volume: c.volume ?? null,
    vwap: null,
  }
}
