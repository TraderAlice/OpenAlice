/**
 * Shared helpers + cached dataset fetchers for the TWSE / TPEx vendor.
 *
 * Two official open-data hosts, no API key:
 *   - TWSE (上市 / listed, `.TW`)  → openapi.twse.com.tw
 *   - TPEx (上櫃 / OTC,    `.TWO`) → www.tpex.org.tw/openapi
 *
 * Both expose whole-market daily snapshots, not per-symbol endpoints, so we
 * pull each dataset once, cache it in-process, and index by stock code. ROC
 * (民國) dates, empty-string numerics and trailing full-width spaces are
 * normalized here at the boundary so the model fetchers stay clean.
 *
 * Historical K-lines are deliberately NOT served here: TWSE symbols are
 * Yahoo-suffixed (`2330.TW` / `6488.TWO`), so the provider reuses yfinance's
 * historical fetcher (see index.ts) — Yahoo's public chart API already covers
 * Taiwan tickers.
 */

import { amakeRequest } from '../../core/provider/utils/helpers.js'

export const TWSE_BASE = 'https://openapi.twse.com.tw/v1'
export const TPEX_BASE = 'https://www.tpex.org.tw/openapi/v1'
const HEADERS = { 'User-Agent': 'Mozilla/5.0' }

export type Board = 'TW' | 'TWO'

// ---- value normalizers (TWSE/TPEx quirks live here) ----

/** Collapse ASCII + full-width (U+3000) whitespace; empty / dash-only → null. */
export function cleanStr(v: unknown): string | null {
  if (v == null) return null
  const s = String(v).replace(/[\s　]+/g, ' ').trim()
  if (!s || s === '-' || s === '－') return null
  return s
}

/** Parse a TWSE/TPEx numeric string (commas, spaces, blank, dash) → number | null. */
export function cleanNum(v: unknown): number | null {
  if (v == null) return null
  const s = String(v).replace(/[,\s　]/g, '')
  if (!s || s === '-' || s === '－') return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

/**
 * Convert a TWSE/TPEx date to ISO `YYYY-MM-DD`.
 * Accepts ROC `YYYMMDD` (民國年, e.g. `1150626` = 2026-06-26) and Gregorian
 * `YYYYMMDD` (e.g. `20180808`). A 4-digit leading year > 1911 is treated as
 * Gregorian; otherwise the leading 3 digits are a ROC year (+1911).
 */
export function rocToISO(v: unknown): string | null {
  const digits = cleanStr(v)?.replace(/\D/g, '')
  if (!digits || digits.length < 6) return null
  let year: number
  let rest: string
  if (digits.length === 8) {
    // 4-digit head: Gregorian year (>= 1911) vs zero-padded ROC year (+1911).
    const head = Number(digits.slice(0, 4))
    year = head >= 1911 ? head : head + 1911
    rest = digits.slice(4)
  } else if (digits.length === 7) {
    year = Number(digits.slice(0, 3)) + 1911 // ROC YYYMMDD (民國年 3 位)
    rest = digits.slice(3)
  } else if (digits.length === 6) {
    year = Number(digits.slice(0, 2)) + 1911 // ROC YYMMDD (民國年 2 位)
    rest = digits.slice(2)
  } else {
    return null
  }
  const mm = rest.slice(0, 2)
  const dd = rest.slice(2, 4)
  const mmN = Number(mm)
  const ddN = Number(dd)
  if (mm.length < 2 || dd.length < 2 || mmN < 1 || mmN > 12 || ddN < 1 || ddN > 31) return null
  return `${year}-${mm}-${dd}`
}

/** Split a Yahoo-suffixed Taiwan ticker (`2330.TW` / `6488.TWO`) → code + board. */
export function parseTwSymbol(symbol: string): { code: string; board: Board } | null {
  const m = symbol.trim().toUpperCase().match(/^(\d{3,6}[A-Z]?)\.(TWO|TW)$/)
  if (!m) return null
  return { code: m[1], board: m[2] as Board }
}

// ---- in-process TTL cache (provider runtime; opentypebb has no src/ cache helper) ----

function cached<T>(ttlMs: number, fn: () => Promise<T>): () => Promise<T> {
  let value: T | undefined
  let at = 0
  let inflight: Promise<T> | null = null
  return async () => {
    if (value !== undefined && Date.now() - at < ttlMs) return value
    if (inflight) return inflight
    inflight = fn()
      .then((v) => {
        value = v
        at = Date.now()
        inflight = null
        return v
      })
      .catch((e) => {
        inflight = null
        if (value !== undefined) return value // stale-on-error
        throw e
      })
    return inflight
  }
}

const TTL_DIRECTORY = 12 * 60 * 60 * 1000 // company list / metrics: daily-ish
const TTL_QUOTES = 30 * 60 * 1000 // EOD daily snapshot: stable within a session

async function getJson(base: string, path: string): Promise<Record<string, unknown>[]> {
  return amakeRequest<Record<string, unknown>[]>(`${base}/${path}`, { headers: HEADERS })
}

// ---- unified company directory (powers EquitySearch + EquityInfo) ----

export interface TwCompany {
  code: string
  name: string | null
  abbr: string | null
  enName: string | null
  industry: string | null
  board: Board
  raw: Record<string, unknown>
}

export const listedCompanies = cached(TTL_DIRECTORY, async (): Promise<TwCompany[]> => {
  const rows = await getJson(TWSE_BASE, 'opendata/t187ap03_L')
  return rows
    .map((r): TwCompany => ({
      code: String(r['公司代號'] ?? '').trim(),
      name: cleanStr(r['公司名稱']),
      abbr: cleanStr(r['公司簡稱']),
      enName: cleanStr(r['英文簡稱']),
      industry: cleanStr(r['產業別']),
      board: 'TW',
      raw: r,
    }))
    .filter((c) => c.code)
})

export const otcCompanies = cached(TTL_DIRECTORY, async (): Promise<TwCompany[]> => {
  const rows = await getJson(TPEX_BASE, 'mopsfin_t187ap03_O')
  return rows
    .map((r): TwCompany => ({
      code: String(r['SecuritiesCompanyCode'] ?? '').trim(),
      name: cleanStr(r['CompanyName']),
      abbr: cleanStr(r['CompanyAbbreviation']),
      enName: cleanStr(r['Symbol']),
      industry: cleanStr(r['SecuritiesIndustryCode']),
      board: 'TWO',
      raw: r,
    }))
    .filter((c) => c.code)
})

/** Whole TW + TWO directory, cached, for heuristic search + profile lookup. */
export async function allCompanies(): Promise<TwCompany[]> {
  const [tw, two] = await Promise.all([listedCompanies(), otcCompanies()])
  return [...tw, ...two]
}

export async function companyByCode(code: string, board: Board): Promise<TwCompany | undefined> {
  const list = board === 'TW' ? await listedCompanies() : await otcCompanies()
  return list.find((c) => c.code === code)
}

// ---- daily quotes (whole-market snapshot, indexed by code) ----

export const listedQuotes = cached(TTL_QUOTES, async (): Promise<Map<string, Record<string, unknown>>> => {
  const rows = await getJson(TWSE_BASE, 'exchangeReport/STOCK_DAY_ALL')
  const m = new Map<string, Record<string, unknown>>()
  for (const r of rows) m.set(String(r['Code'] ?? '').trim(), r)
  return m
})

export const otcQuotes = cached(TTL_QUOTES, async (): Promise<Map<string, Record<string, unknown>>> => {
  const rows = await getJson(TPEX_BASE, 'tpex_mainboard_daily_close_quotes')
  const m = new Map<string, Record<string, unknown>>()
  for (const r of rows) m.set(String(r['SecuritiesCompanyCode'] ?? '').trim(), r)
  return m
})

// ---- valuation metrics (P/E · yield · P/B, indexed by code) ----

export const listedMetrics = cached(TTL_DIRECTORY, async (): Promise<Map<string, Record<string, unknown>>> => {
  const rows = await getJson(TWSE_BASE, 'exchangeReport/BWIBBU_ALL')
  const m = new Map<string, Record<string, unknown>>()
  for (const r of rows) m.set(String(r['Code'] ?? '').trim(), r)
  return m
})

export const otcMetrics = cached(TTL_DIRECTORY, async (): Promise<Map<string, Record<string, unknown>>> => {
  const rows = await getJson(TPEX_BASE, 'tpex_mainboard_peratio_analysis')
  const m = new Map<string, Record<string, unknown>>()
  for (const r of rows) m.set(String(r['SecuritiesCompanyCode'] ?? '').trim(), r)
  return m
})
