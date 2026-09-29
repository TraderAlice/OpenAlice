/**
 * Tencent (腾讯财经) Level-1 A-share snapshot helpers.
 *
 * Public CDN endpoint `qt.gtimg.cn` returns GBK text lines shaped like:
 *   v_sh600519="1~贵州茅台~600519~1251.24~…";
 * Fields are `~`-separated; indices below match the long-stable layout used by
 * most mainland watch tools. Volume from the feed is in 手 (lots of 100 shares).
 */

export const TENCENT_QUOTE_URL = 'http://qt.gtimg.cn/q='
export const TENCENT_HEADERS = {
  'User-Agent': 'Mozilla/5.0',
  Referer: 'https://gu.qq.com',
} as const

/** Parsed Tencent list code, e.g. `sh600519` / `sz000001`. */
export type TencentCode = `sh${string}` | `sz${string}`

/**
 * Map common CN A-share identities onto Tencent's `sh`/`sz` list codes.
 * Accepts: `sh600519`, `sz000001`, `600519.SS` / `.SZ`, Eastmoney secid
 * `1.600519` / `0.000001`, and bare six-digit codes (6→SH, 0/3→SZ).
 */
export function toTencentCode(raw: string): TencentCode | null {
  const s = raw.trim()
  if (!s) return null

  const lower = s.toLowerCase()
  const prefixed = lower.match(/^(sh|sz)(\d{6})$/)
  if (prefixed) return `${prefixed[1]}${prefixed[2]}` as TencentCode

  const yahoo = s.toUpperCase().match(/^(\d{6})\.(SS|SZ)$/)
  if (yahoo) return `${yahoo[2] === 'SS' ? 'sh' : 'sz'}${yahoo[1]}` as TencentCode

  const eastmoney = s.match(/^([01])\.(\d{6})$/)
  if (eastmoney) return `${eastmoney[1] === '1' ? 'sh' : 'sz'}${eastmoney[2]}` as TencentCode

  const bare = s.match(/^(\d{6})$/)
  if (bare) {
    const code = bare[1]
    if (code.startsWith('6')) return `sh${code}`
    if (code.startsWith('0') || code.startsWith('3')) return `sz${code}`
  }

  return null
}

export function exchangeForCode(code: TencentCode): 'SSE' | 'SZSE' {
  return code.startsWith('sh') ? 'SSE' : 'SZSE'
}

/** GBK body → UTF-8 string (Node TextDecoder supports `gbk`). */
export function decodeGbk(buf: ArrayBuffer): string {
  return new TextDecoder('gbk').decode(buf)
}

export function num(raw: string | undefined): number | null {
  if (raw == null || raw === '' || raw === '-') return null
  const n = Number(raw)
  return Number.isFinite(n) ? n : null
}

/** `20260923161450` (Asia/Shanghai wall clock) → ISO instant. */
export function parseTencentTimestamp(raw: string | undefined): string | null {
  if (!raw || !/^\d{14}$/.test(raw)) return null
  const y = raw.slice(0, 4)
  const mo = raw.slice(4, 6)
  const d = raw.slice(6, 8)
  const h = raw.slice(8, 10)
  const mi = raw.slice(10, 12)
  const s = raw.slice(12, 14)
  return new Date(`${y}-${mo}-${d}T${h}:${mi}:${s}+08:00`).toISOString()
}

export interface TencentQuoteRow {
  code: TencentCode
  fields: string[]
}

/**
 * Parse one or more `v_sh…="…";` lines into field arrays.
 * Empty payloads (`v_sh600519="";`) are dropped.
 */
export function parseTencentQuoteBody(text: string): TencentQuoteRow[] {
  const out: TencentQuoteRow[] = []
  const re = /v_(sh\d{6}|sz\d{6})="([^"]*)"/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const code = m[1].toLowerCase() as TencentCode
    const payload = m[2]
    if (!payload) continue
    out.push({ code, fields: payload.split('~') })
  }
  return out
}

/** Fetch a batch of Tencent list codes; one HTTP round-trip. */
export async function fetchTencentQuotes(codes: TencentCode[]): Promise<TencentQuoteRow[]> {
  if (!codes.length) return []
  const unique = [...new Set(codes)]
  const url = `${TENCENT_QUOTE_URL}${unique.join(',')}`
  const response = await fetch(url, {
    headers: { ...TENCENT_HEADERS },
    signal: AbortSignal.timeout(15_000),
  })
  if (!response.ok) {
    throw new Error(`Tencent quote HTTP ${response.status} ${response.statusText}`)
  }
  const text = decodeGbk(await response.arrayBuffer())
  return parseTencentQuoteBody(text)
}
