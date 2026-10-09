/**
 * China A-share board — local-only compiler for index tape + Stock Connect
 * day-end disclosure.
 *
 * Indexes: CSI index-perf (YYYYMMDD) + CNI daily. Connect: HKEX Historical
 * DailyStat JS (SSE/SZSE Northbound + Southbound). No hub path in v1; no
 * Tushare; never invent 北向净流入 from concept-board money-flow.
 */

import type { ReferenceMeta } from './types.js'

export type CnFactQuality = 'A' | 'B' | 'C'
export type CnFactDomain = 'market' | 'flow'
export type CnDataType = 'official_close' | 'exchange_day_end'

export interface CnIndexCard {
  /** Stable id, e.g. `CSI:000300` or `CNI:399001`. */
  id: string
  code: string
  label: string
  source: 'CSI' | 'CNI'
  tradeDate: string
  close: number | null
  /** Percent units (0.16 = +0.16%), matching CSI changePct. */
  changePct: number | null
  /** Turnover / amount when upstream provides it (CSI: 亿元; CNI: 亿元). */
  amount: number | null
  pe: number | null
  quality: CnFactQuality
  domain: CnFactDomain
  dataType: CnDataType
}

export interface CnConnectTopName {
  rank: number
  code: string
  name: string
  /** Total turnover as published (HKEX northbound: RMB; southbound top10: HKD). */
  turnover: number | null
}

export interface CnConnectLeg {
  /** HKEX market label, e.g. `SSE Northbound`. */
  market: string
  tradeDate: string
  /** Total turnover (northbound: RMB million; southbound: HKD million). */
  turnover: number | null
  tradeCount: number | null
  etfTurnover: number | null
  /** Buy/sell only when HKEX publishes them (southbound legs). */
  buyTurnover: number | null
  sellTurnover: number | null
  top10: CnConnectTopName[]
  source: 'HKEX'
  quality: CnFactQuality
  domain: CnFactDomain
  dataType: CnDataType
  /** Currency unit of turnover fields — do not sum across legs blindly. */
  turnoverUnit: 'RMB_million' | 'HKD_million' | 'unknown'
}

export interface CnAshareConnect {
  /** SSE Northbound day-end via HKEX Historical Daily. */
  sse: CnConnectLeg | null
  /** SZSE Northbound day-end via HKEX Historical Daily. */
  szse: CnConnectLeg | null
  /** HKEX southbound legs (optional depth; still day-end disclosure). */
  hkex: {
    sseSouthbound: CnConnectLeg | null
    szseSouthbound: CnConnectLeg | null
  }
}

export interface CnAshareBoard {
  /** Trading session the board targets (YYYY-MM-DD), usually latest with data. */
  sessionDate: string | null
  indexes: CnIndexCard[]
  connect: CnAshareConnect
  errors?: {
    indexes?: string
    connect?: string
    sse?: string
    szse?: string
    hkex?: string
  }
  meta: ReferenceMeta
}

export interface CnAshareFetchOpts {
  fetch?: typeof globalThis.fetch
  now?: () => Date
  /** Calendar days to walk back for HKEX DailyStat / index lookback. */
  lookbackDays?: number
}

const UA = 'OpenAlice/1.0 (cn-ashare board; +https://openalice.ai)'

const CSI_INDEXES: Array<{ code: string; label: string }> = [
  { code: '000300', label: 'CSI 300' },
  { code: '000905', label: 'CSI 500' },
  { code: '000688', label: 'STAR 50' },
]

const CNI_INDEXES: Array<{ code: string; label: string }> = [
  { code: '399001', label: 'Shenzhen Component' },
  { code: '399006', label: 'ChiNext' },
]

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function yyyymmdd(d: Date): string {
  return isoDay(d).replace(/-/g, '')
}

function parseNum(raw: unknown): number | null {
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw
  if (typeof raw !== 'string') return null
  const cleaned = raw.replace(/,/g, '').replace(/%/g, '').trim()
  if (!cleaned || cleaned === '-' || cleaned === 'N/A') return null
  const n = Number(cleaned)
  return Number.isFinite(n) ? n : null
}

/** CSI changePct is percent units; CNI percent is like "-2.07%". */
function parseChangePct(raw: unknown): number | null {
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw
  if (typeof raw !== 'string') return null
  return parseNum(raw)
}

async function httpText(
  fetchImpl: typeof globalThis.fetch,
  url: string,
  init?: RequestInit,
): Promise<string> {
  const res = await fetchImpl(url, {
    ...init,
    headers: {
      'User-Agent': UA,
      Accept: 'application/json,text/javascript,*/*',
      ...(init?.headers ?? {}),
    },
  })
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)
  return res.text()
}

async function httpJson<T>(
  fetchImpl: typeof globalThis.fetch,
  url: string,
  init?: RequestInit,
): Promise<T> {
  const text = await httpText(fetchImpl, url, init)
  return JSON.parse(text) as T
}

function csiWindow(now: Date, lookbackDays: number): { start: string; end: string } {
  const end = new Date(now)
  const start = new Date(now)
  start.setUTCDate(start.getUTCDate() - lookbackDays)
  return { start: yyyymmdd(start), end: yyyymmdd(end) }
}

function cniWindow(now: Date, lookbackDays: number): { start: string; end: string } {
  const end = new Date(now)
  const start = new Date(now)
  start.setUTCDate(start.getUTCDate() - lookbackDays)
  return { start: isoDay(start), end: isoDay(end) }
}

interface CsiRow {
  tradeDate?: string
  indexCode?: string
  indexNameEn?: string
  indexNameCn?: string
  close?: number
  changePct?: number
  tradingValue?: number
  peg?: number
}

async function fetchCsiCard(
  fetchImpl: typeof globalThis.fetch,
  code: string,
  label: string,
  window: { start: string; end: string },
): Promise<CnIndexCard> {
  const url =
    `https://www.csindex.com.cn/csindex-home/perf/index-perf` +
    `?indexCode=${encodeURIComponent(code)}&startDate=${window.start}&endDate=${window.end}`
  const body = await httpJson<{
    success?: boolean
    code?: string
    msg?: string
    data?: CsiRow[]
  }>(fetchImpl, url, { headers: { Referer: 'https://www.csindex.com.cn/' } })
  const rows = Array.isArray(body.data) ? body.data : []
  if (!rows.length) {
    throw new Error(`CSI ${code}: empty data (${body.msg ?? body.code ?? 'no rows'})`)
  }
  const latest = [...rows].sort((a, b) => String(a.tradeDate ?? '').localeCompare(String(b.tradeDate ?? ''))).at(-1)!
  const tradeDateRaw = String(latest.tradeDate ?? '')
  const tradeDate = /^\d{8}$/.test(tradeDateRaw)
    ? `${tradeDateRaw.slice(0, 4)}-${tradeDateRaw.slice(4, 6)}-${tradeDateRaw.slice(6, 8)}`
    : tradeDateRaw
  return {
    id: `CSI:${code}`,
    code,
    label: latest.indexNameEn || latest.indexNameCn || label,
    source: 'CSI',
    tradeDate,
    close: parseNum(latest.close),
    changePct: parseChangePct(latest.changePct),
    amount: parseNum(latest.tradingValue),
    pe: parseNum(latest.peg),
    quality: 'A',
    domain: 'market',
    dataType: 'official_close',
  }
}

async function fetchCniCard(
  fetchImpl: typeof globalThis.fetch,
  code: string,
  label: string,
  window: { start: string; end: string },
): Promise<CnIndexCard> {
  const url =
    `http://hq.cnindex.com.cn/market/market/getIndexDailyDataWithDataFormat` +
    `?indexCode=${encodeURIComponent(code)}` +
    `&startDate=${window.start}&endDate=${window.end}&frequency=day`
  const body = await httpJson<{
    code?: number
    message?: string
    data?: {
      indexName?: string
      indexEName?: string
      item?: string[]
      data?: unknown[][]
    }
  }>(fetchImpl, url)
  const item = body.data?.item ?? []
  const matrix = body.data?.data ?? []
  if (!matrix.length || !item.length) {
    throw new Error(`CNI ${code}: empty data (${body.message ?? body.code ?? 'no rows'})`)
  }
  const idx = (name: string) => item.indexOf(name)
  const iTs = idx('timestamp')
  const iClose = idx('close')
  const iPct = idx('percent')
  const iAmount = idx('amount')
  const sorted = [...matrix].sort((a, b) => String(a[iTs] ?? '').localeCompare(String(b[iTs] ?? '')))
  const latest = sorted.at(-1)!
  return {
    id: `CNI:${code}`,
    code,
    label: body.data?.indexEName || body.data?.indexName || label,
    source: 'CNI',
    tradeDate: String(latest[iTs] ?? ''),
    close: parseNum(latest[iClose]),
    changePct: parseChangePct(latest[iPct]),
    amount: parseNum(latest[iAmount]),
    pe: null,
    quality: 'A',
    domain: 'market',
    dataType: 'official_close',
  }
}

interface HkexTabMarket {
  id?: number
  date?: string
  market?: string
  tradingDay?: number
  content?: Array<{
    style?: number
    table?: {
      classname?: string
      schema?: string[][]
      tr?: Array<{ td?: string[][] }>
    }
  }>
}

function extractTradingMetrics(market: HkexTabMarket): {
  turnover: number | null
  tradeCount: number | null
  etfTurnover: number | null
  buyTurnover: number | null
  sellTurnover: number | null
} {
  const trading = market.content?.find((c) => c.table?.classname === 'tradingTable')
  const headers = trading?.table?.schema?.[0] ?? []
  const cells = (trading?.table?.tr ?? []).map((row) => row.td?.[0]?.[0] ?? null)
  const byHeader = new Map<string, number | null>()
  headers.forEach((h, i) => byHeader.set(h, parseNum(cells[i])))
  return {
    turnover: byHeader.get('Total Turnover') ?? null,
    tradeCount: byHeader.get('Total Trade Count') ?? null,
    etfTurnover: byHeader.get('ETF Turnover') ?? null,
    buyTurnover: byHeader.get('Buy Turnover') ?? null,
    sellTurnover: byHeader.get('Sell Turnover') ?? null,
  }
}

function extractTop10(market: HkexTabMarket): CnConnectTopName[] {
  const top = market.content?.find((c) => c.table?.classname === 'top10Table')
  const headers = top?.table?.schema?.[0] ?? []
  const iCode = headers.indexOf('Stock Code')
  const iName = headers.indexOf('Stock Name')
  const iTurnover = headers.indexOf('Total Turnover')
  const iRank = headers.indexOf('Rank')
  return (top?.table?.tr ?? []).map((row, idx) => {
    const cells = row.td?.[0] ?? []
    return {
      rank: parseNum(cells[iRank >= 0 ? iRank : 0]) ?? idx + 1,
      code: String(cells[iCode >= 0 ? iCode : 1] ?? ''),
      name: String(cells[iName >= 0 ? iName : 2] ?? ''),
      turnover: parseNum(cells[iTurnover >= 0 ? iTurnover : cells.length - 1]),
    }
  }).filter((r) => r.code || r.name)
}

function toConnectLeg(market: HkexTabMarket): CnConnectLeg {
  const name = String(market.market ?? '')
  const northbound = /Northbound/i.test(name)
  const metrics = extractTradingMetrics(market)
  return {
    market: name,
    tradeDate: String(market.date ?? ''),
    ...metrics,
    top10: extractTop10(market),
    source: 'HKEX',
    quality: 'A',
    domain: 'flow',
    dataType: 'exchange_day_end',
    turnoverUnit: northbound ? 'RMB_million' : /Southbound/i.test(name) ? 'HKD_million' : 'unknown',
  }
}

function parseHkexDailyStatJs(text: string): HkexTabMarket[] {
  const trimmed = text.trim().replace(/^tabData\s*=\s*/, '').replace(/;\s*$/, '')
  // DailyStat files are JSON-shaped after the assignment prefix.
  const data = JSON.parse(trimmed) as HkexTabMarket[]
  if (!Array.isArray(data)) throw new Error('HKEX DailyStat: expected array')
  return data
}

async function fetchHkexDailyStat(
  fetchImpl: typeof globalThis.fetch,
  now: Date,
  lookbackDays: number,
): Promise<{ sessionDate: string; markets: HkexTabMarket[] }> {
  const errors: string[] = []
  for (let i = 0; i <= lookbackDays; i++) {
    const d = new Date(now)
    d.setUTCDate(d.getUTCDate() - i)
    const ymd = yyyymmdd(d)
    const url = `https://www.hkex.com.hk/eng/csm/DailyStat/data_tab_daily_${ymd}e.js`
    try {
      const text = await httpText(fetchImpl, url, {
        headers: { Referer: 'https://www.hkex.com.hk/Mutual-Market/Stock-Connect/Statistics/Historical-Daily?sc_lang=en' },
      })
      const markets = parseHkexDailyStatJs(text)
      const trading = markets.filter((m) => m.tradingDay === 1)
      if (!trading.length) {
        errors.push(`${ymd}: no tradingDay=1 markets`)
        continue
      }
      const sessionDate = String(trading[0]?.date ?? isoDay(d))
      return { sessionDate, markets: trading }
    } catch (err) {
      errors.push(`${ymd}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  throw new Error(`HKEX DailyStat unavailable (tried ${lookbackDays + 1} days): ${errors.slice(0, 3).join('; ')}`)
}

export async function fetchCnAshareBoard(opts: CnAshareFetchOpts = {}): Promise<CnAshareBoard> {
  const fetchImpl = opts.fetch ?? globalThis.fetch
  const now = (opts.now ?? (() => new Date()))()
  const lookbackDays = opts.lookbackDays ?? 14

  const csiWin = csiWindow(now, lookbackDays)
  const cniWin = cniWindow(now, lookbackDays)

  const indexJobs = [
    ...CSI_INDEXES.map((x) => () => fetchCsiCard(fetchImpl, x.code, x.label, csiWin)),
    ...CNI_INDEXES.map((x) => () => fetchCniCard(fetchImpl, x.code, x.label, cniWin)),
  ]

  const [indexSettled, connectSettled] = await Promise.all([
    Promise.allSettled(indexJobs.map((fn) => fn())),
    Promise.allSettled([fetchHkexDailyStat(fetchImpl, now, lookbackDays)]),
  ])

  const indexes: CnIndexCard[] = []
  const indexFailMessages: string[] = []
  for (const r of indexSettled) {
    if (r.status === 'fulfilled') indexes.push(r.value)
    else indexFailMessages.push(r.reason instanceof Error ? r.reason.message : String(r.reason))
  }

  const errors: NonNullable<CnAshareBoard['errors']> = {}
  if (indexFailMessages.length) {
    errors.indexes = indexFailMessages.join('; ')
  }

  let connect: CnAshareConnect = {
    sse: null,
    szse: null,
    hkex: { sseSouthbound: null, szseSouthbound: null },
  }
  let sessionDate: string | null = null

  const connectResult = connectSettled[0]
  if (connectResult.status === 'fulfilled') {
    const { sessionDate: sd, markets } = connectResult.value
    sessionDate = sd
    const byName = new Map(markets.map((m) => [String(m.market ?? ''), m]))
    const pick = (name: string): CnConnectLeg | null => {
      const m = byName.get(name)
      return m ? toConnectLeg(m) : null
    }
    connect = {
      sse: pick('SSE Northbound'),
      szse: pick('SZSE Northbound'),
      hkex: {
        sseSouthbound: pick('SSE Southbound'),
        szseSouthbound: pick('SZSE Southbound'),
      },
    }
    if (!connect.sse) errors.sse = 'SSE Northbound missing from HKEX DailyStat'
    if (!connect.szse) errors.szse = 'SZSE Northbound missing from HKEX DailyStat'
    if (!connect.hkex.sseSouthbound && !connect.hkex.szseSouthbound) {
      errors.hkex = 'Southbound legs missing from HKEX DailyStat'
    }
  } else {
    errors.connect = connectResult.reason instanceof Error
      ? connectResult.reason.message
      : String(connectResult.reason)
  }

  if (!indexes.length && connectResult.status === 'rejected') {
    throw new Error(
      `cn-ashare board failed: indexes (${errors.indexes ?? 'none'}); connect (${errors.connect ?? 'none'})`,
    )
  }

  if (!sessionDate) {
    const dates = indexes.map((i) => i.tradeDate).filter(Boolean).sort()
    sessionDate = dates.at(-1) ?? null
  }

  const providers = new Set<string>()
  if (indexes.some((i) => i.source === 'CSI')) providers.add('csi')
  if (indexes.some((i) => i.source === 'CNI')) providers.add('cni')
  if (connect.sse || connect.szse || connect.hkex.sseSouthbound || connect.hkex.szseSouthbound) {
    providers.add('hkex')
  }

  return {
    sessionDate,
    indexes,
    connect,
    ...(Object.keys(errors).length ? { errors } : {}),
    meta: {
      provider: [...providers].join('+') || 'cn-ashare',
      asOf: new Date().toISOString(),
      origin: 'local',
    },
  }
}
