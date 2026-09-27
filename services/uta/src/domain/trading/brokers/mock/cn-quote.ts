/**
 * Free CN A-share Level-1 snapshots via Tencent qt.gtimg.cn.
 *
 * Local paper only — delayed/public L1, not broker-matching quotes.
 */

import { limitBandFromPrevClose } from './cn-rules.js'

export type CnMarket = 'sh' | 'sz' | 'bj'

/** @deprecated Prefer CnMarket — kept as alias for existing imports. */
export type TencentMarket = CnMarket

export interface CnSymbolRef {
  /** Bare 6-digit code, e.g. 600519 */
  bare: string
  market: CnMarket
  /** Tencent wire code, e.g. sh600519 / bj920000 */
  tencentCode: string
  /** Canonical dotted id, e.g. 600519.SH */
  canonical: string
}

export type ParseCnSymbolResult =
  | { ok: true; ref: CnSymbolRef }
  | { ok: false; code: 'UNKNOWN_SYMBOL'; message: string }

export interface CnQuoteSnapshot {
  /** Bare 6-digit code, e.g. 600519 */
  code: string
  market: CnMarket
  /** Tencent wire code, e.g. sh600519 */
  tencentCode: string
  name: string
  last: number
  prevClose: number
  open: number
  bid: number
  ask: number
  volume: number
  /** Approx limit-up (10% band on prevClose; ST/boards not modeled). */
  limitUp: number
  limitDown: number
  timestamp: Date
}

const TENCENT_QUOTE_URL = 'https://qt.gtimg.cn/q='

function makeRef(bare: string, market: CnMarket): CnSymbolRef {
  return {
    bare,
    market,
    tencentCode: `${market}${bare}`,
    canonical: `${bare}.${market.toUpperCase()}`,
  }
}

/** Infer SH/SZ/BJ from a bare 6-digit code. */
export function inferCnMarket(bare: string): CnMarket | null {
  if (!/^\d{6}$/.test(bare)) return null
  // BJ: 92xxxx (new), 8xxxxx / 4xxxxx (NEEQ → BSE)
  if (bare.startsWith('92') || bare.startsWith('8') || bare.startsWith('4')) return 'bj'
  // SH: 6xxxxx stocks / STAR, 5xxxxx ETFs/funds, 900xxx B-shares
  if (bare.startsWith('5') || bare.startsWith('6') || bare.startsWith('9')) return 'sh'
  // SZ: 0/1/2/3xxxxx
  if (bare.startsWith('0') || bare.startsWith('1') || bare.startsWith('2') || bare.startsWith('3')) {
    return 'sz'
  }
  return null
}

/**
 * Normalize user/Alice CN symbols into a canonical ref.
 * Accepts: 600519, sh600519, sh-600519, 600519.SH, 1.600519, bj920000, 920000.BJ, …
 */
export function parseCnSymbol(raw: string): ParseCnSymbolResult {
  const s = raw.trim().toLowerCase().replace(/[\s_-]+/g, '')
  if (!s) {
    return { ok: false, code: 'UNKNOWN_SYMBOL', message: 'Empty symbol' }
  }

  const prefixed = s.match(/^(sh|sz|bj)(\d{6})$/)
  if (prefixed) return { ok: true, ref: makeRef(prefixed[2]!, prefixed[1] as CnMarket) }

  const dotted = s.match(/^(\d{6})\.(ss|sh|sz|bj)$/)
  if (dotted) {
    const market: CnMarket = dotted[2] === 'sz' ? 'sz' : dotted[2] === 'bj' ? 'bj' : 'sh'
    return { ok: true, ref: makeRef(dotted[1]!, market) }
  }

  // Eastmoney-style secid: 1.600519 (SH) / 0.000001 (SZ) / 2.920000 (BJ)
  const secid = s.match(/^([012])\.(\d{6})$/)
  if (secid) {
    const market: CnMarket = secid[1] === '1' ? 'sh' : secid[1] === '2' ? 'bj' : 'sz'
    return { ok: true, ref: makeRef(secid[2]!, market) }
  }

  if (/^\d{6}$/.test(s)) {
    const market = inferCnMarket(s)
    if (!market) {
      return {
        ok: false,
        code: 'UNKNOWN_SYMBOL',
        message: `Cannot infer exchange for ${s}`,
      }
    }
    return { ok: true, ref: makeRef(s, market) }
  }

  return {
    ok: false,
    code: 'UNKNOWN_SYMBOL',
    message: `Unrecognized CN symbol "${raw.trim()}"`,
  }
}

/** Map user/Alice symbols to Tencent sh/sz/bj codes. */
export function toTencentCode(raw: string): string | null {
  const parsed = parseCnSymbol(raw)
  return parsed.ok ? parsed.ref.tencentCode : null
}

export function marketOfTencentCode(code: string): CnMarket {
  if (code.startsWith('sz')) return 'sz'
  if (code.startsWith('bj')) return 'bj'
  return 'sh'
}

export function bareCodeOfTencentCode(code: string): string {
  return code.replace(/^(sh|sz|bj)/, '')
}

function num(v: string | undefined): number {
  if (v == null || v === '') return NaN
  const n = Number(v)
  return Number.isFinite(n) ? n : NaN
}

function parseRow(bodyPart: string): CnQuoteSnapshot | null {
  // v_sh600519="1~贵州茅台~600519~…"; also bj920000
  const m = bodyPart.match(/^v_((?:sh|sz|bj)\d{6})="([^"]*)"/)
  if (!m) return null
  const tencentCode = m[1]!
  const fields = m[2]!.split('~')
  const last = num(fields[3])
  const prevClose = num(fields[4])
  if (!Number.isFinite(last) || last <= 0) return null
  const prev = Number.isFinite(prevClose) && prevClose > 0 ? prevClose : last
  const open = num(fields[5])
  const bid = num(fields[9])
  const ask = num(fields[19])
  const volumeHands = num(fields[6])
  const name = fields[1] || bareCodeOfTencentCode(tencentCode)
  const code = bareCodeOfTencentCode(tencentCode)
  const band = limitBandFromPrevClose(prev, code)

  return {
    code,
    market: marketOfTencentCode(tencentCode),
    tencentCode,
    name,
    last,
    prevClose: prev,
    open: Number.isFinite(open) ? open : last,
    bid: Number.isFinite(bid) && bid > 0 ? bid : last,
    ask: Number.isFinite(ask) && ask > 0 ? ask : last,
    volume: Number.isFinite(volumeHands) ? volumeHands * 100 : 0,
    limitUp: band.limitUp,
    limitDown: band.limitDown,
    timestamp: new Date(),
  }
}

export type CnQuoteFetcher = (tencentCodes: string[]) => Promise<CnQuoteSnapshot[]>

/** Live fetch from Tencent. Inject a stub in tests. */
export const fetchTencentQuotes: CnQuoteFetcher = async (tencentCodes) => {
  const unique = [...new Set(tencentCodes.filter(Boolean))]
  if (!unique.length) return []

  const url = `${TENCENT_QUOTE_URL}${unique.join(',')}`
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'OpenAlice-CnLocalPaper/1.0',
      Referer: 'https://finance.qq.com/',
    },
  })
  if (!res.ok) {
    throw new Error(`Tencent quote HTTP ${res.status}`)
  }
  const text = await res.text()
  const out: CnQuoteSnapshot[] = []
  for (const part of text.split(';')) {
    const trimmed = part.trim()
    if (!trimmed) continue
    const row = parseRow(trimmed)
    if (row) out.push(row)
  }
  return out
}

export async function fetchCnQuote(
  symbol: string,
  fetcher: CnQuoteFetcher = fetchTencentQuotes,
): Promise<CnQuoteSnapshot | null> {
  const parsed = parseCnSymbol(symbol)
  if (!parsed.ok) return null
  const code = parsed.ref.tencentCode
  const rows = await fetcher([code])
  return rows.find((r) => r.tencentCode === code) ?? null
}
