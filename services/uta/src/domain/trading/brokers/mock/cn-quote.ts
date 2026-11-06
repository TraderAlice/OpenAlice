/**
 * Free CN A-share Level-1 snapshots via Tencent qt.gtimg.cn.
 *
 * Local paper only — delayed/public L1, not broker-matching quotes.
 */

export type TencentMarket = 'sh' | 'sz'

export interface CnQuoteSnapshot {
  /** Bare 6-digit code, e.g. 600519 */
  code: string
  market: TencentMarket
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

/** Map user/Alice symbols to Tencent sh/sz codes. */
export function toTencentCode(raw: string): string | null {
  const s = raw.trim().toLowerCase().replace(/\s+/g, '')
  if (!s) return null

  const prefixed = s.match(/^(sh|sz)(\d{6})$/)
  if (prefixed) return `${prefixed[1]}${prefixed[2]}`

  const dotted = s.match(/^(\d{6})\.(ss|sh|sz)$/)
  if (dotted) {
    const m = dotted[2] === 'sz' ? 'sz' : 'sh'
    return `${m}${dotted[1]}`
  }

  // Eastmoney secid: 1.600519 / 0.000001
  const secid = s.match(/^([01])\.(\d{6})$/)
  if (secid) return `${secid[1] === '1' ? 'sh' : 'sz'}${secid[2]}`

  if (/^\d{6}$/.test(s)) {
    if (s.startsWith('6') || s.startsWith('9')) return `sh${s}`
    if (s.startsWith('0') || s.startsWith('3') || s.startsWith('2')) return `sz${s}`
    return null
  }

  return null
}

export function marketOfTencentCode(code: string): TencentMarket {
  return code.startsWith('sz') ? 'sz' : 'sh'
}

export function bareCodeOfTencentCode(code: string): string {
  return code.replace(/^(sh|sz)/, '')
}

function num(v: string | undefined): number {
  if (v == null || v === '') return NaN
  const n = Number(v)
  return Number.isFinite(n) ? n : NaN
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

function parseRow(bodyPart: string): CnQuoteSnapshot | null {
  // v_sh600519="1~贵州茅台~600519~…";
  const m = bodyPart.match(/^v_((?:sh|sz)\d{6})="([^"]*)"/)
  if (!m) return null
  const tencentCode = m[1]
  const fields = m[2].split('~')
  const last = num(fields[3])
  const prevClose = num(fields[4])
  if (!Number.isFinite(last) || last <= 0) return null
  const prev = Number.isFinite(prevClose) && prevClose > 0 ? prevClose : last
  const open = num(fields[5])
  const bid = num(fields[9])
  const ask = num(fields[19])
  const volumeHands = num(fields[6])
  const name = fields[1] || bareCodeOfTencentCode(tencentCode)

  return {
    code: bareCodeOfTencentCode(tencentCode),
    market: marketOfTencentCode(tencentCode),
    tencentCode,
    name,
    last,
    prevClose: prev,
    open: Number.isFinite(open) ? open : last,
    bid: Number.isFinite(bid) && bid > 0 ? bid : last,
    ask: Number.isFinite(ask) && ask > 0 ? ask : last,
    volume: Number.isFinite(volumeHands) ? volumeHands * 100 : 0,
    limitUp: round2(prev * 1.1),
    limitDown: round2(prev * 0.9),
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
  const code = toTencentCode(symbol)
  if (!code) return null
  const rows = await fetcher([code])
  return rows.find((r) => r.tencentCode === code) ?? null
}
