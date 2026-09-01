import type { GetBarsOpts, BarsResult, OhlcvBar } from '../bars/types.js'
import type { MarketSearchResult } from '../aggregate-search.js'
import { TushareClient } from './client.js'
import type { TushareApiName, TushareDataset, TushareRow } from './types.js'

const DAY_MS = 86_400_000
const STOCK_FIELDS = [
  'ts_code', 'symbol', 'name', 'area', 'industry', 'fullname', 'enname',
  'cnspell', 'market', 'exchange', 'curr_type', 'list_status', 'list_date',
  'delist_date', 'is_hs', 'act_name', 'act_ent_type',
] as const

function tsDate(input: string): string {
  return input.slice(0, 10).replaceAll('-', '')
}

function normalizeParams(params: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(params).map(([key, value]) => {
    if ((key.endsWith('_date') || key === 'period') && typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return [key, tsDate(value)]
    }
    return [key, value]
  }))
}

function requestedAsOf(params: Record<string, unknown>, fallback: string): string {
  for (const key of ['end_date', 'trade_date', 'ann_date', 'actual_date', 'pre_date']) {
    const value = params[key]
    if (typeof value !== 'string') continue
    return isoDate(value) ?? value.slice(0, 10)
  }
  return fallback
}

function isoDate(input: unknown): string | null {
  const value = String(input ?? '')
  return /^\d{8}$/.test(value) ? `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}` : null
}

function numberValue(value: unknown): number | null {
  if (value == null || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function dataset(data: TushareRow[], asOf: string): TushareDataset {
  return { data, meta: { provider: 'tushare', asOf, origin: 'local' } }
}

function financialAsOf(rows: TushareRow[], asOf: string, period: 'annual' | 'quarter', limit: number): TushareRow[] {
  const cutoff = tsDate(asOf)
  const eligible = rows.filter((row) => {
    const announced = String(row.ann_date ?? row.f_ann_date ?? '')
    const end = String(row.end_date ?? '')
    return (!announced || announced <= cutoff) && (period !== 'annual' || end.endsWith('1231'))
  })
  eligible.sort((a, b) => {
    const periodOrder = String(b.end_date ?? '').localeCompare(String(a.end_date ?? ''))
    if (periodOrder) return periodOrder
    return String(b.ann_date ?? b.f_ann_date ?? '').localeCompare(String(a.ann_date ?? a.f_ann_date ?? ''))
  })
  const seen = new Set<string>()
  return eligible.filter((row) => {
    const key = String(row.end_date ?? '')
    if (key && seen.has(key)) return false
    if (key) seen.add(key)
    return true
  }).slice(0, limit)
}

export class TushareService {
  constructor(
    readonly client: TushareClient,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private today(): string {
    return this.now().toISOString().slice(0, 10)
  }

  private async read(
    apiName: TushareApiName,
    params: Record<string, unknown> = {},
    fields?: readonly string[],
    ttlMs?: number,
    asOf = this.today(),
  ): Promise<TushareDataset> {
    const normalized = normalizeParams(params)
    return dataset(
      await this.client.query(apiName, normalized, fields, ttlMs),
      asOf === this.today() ? requestedAsOf(normalized, asOf) : asOf,
    )
  }

  stockBasic(params: Record<string, unknown> = {}) { return this.read('stock_basic', params, STOCK_FIELDS, 6 * 60 * 60_000) }
  stockCompany(params: Record<string, unknown> = {}) { return this.read('stock_company', params, undefined, 6 * 60 * 60_000) }
  stockSt(params: Record<string, unknown> = {}) { return this.read('stock_st', params, undefined, 15 * 60_000) }
  nameChange(params: Record<string, unknown> = {}) { return this.read('namechange', params, undefined, 60 * 60_000) }
  suspensions(params: Record<string, unknown> = {}) { return this.read('suspend_d', params, undefined, 5 * 60_000) }
  tradeCalendar(params: Record<string, unknown> = {}) { return this.read('trade_cal', params, undefined, 12 * 60 * 60_000) }
  dailyBasic(params: Record<string, unknown> = {}) { return this.read('daily_basic', params, undefined, 15 * 60_000) }
  forecast(params: Record<string, unknown> = {}) { return this.read('forecast', params, undefined, 30 * 60_000) }
  express(params: Record<string, unknown> = {}) { return this.read('express', params, undefined, 30 * 60_000) }
  disclosures(params: Record<string, unknown> = {}) { return this.read('disclosure_date', params, undefined, 60 * 60_000) }
  indexBasic(params: Record<string, unknown> = {}) { return this.read('index_basic', params, undefined, 6 * 60 * 60_000) }
  industry(params: Record<string, unknown> = {}) { return this.read('index_classify', params, undefined, 6 * 60 * 60_000) }
  indexMembers(params: Record<string, unknown> = {}) { return this.read('index_member_all', params, undefined, 6 * 60 * 60_000) }
  indexWeights(params: Record<string, unknown> = {}) { return this.read('index_weight', params, undefined, 6 * 60 * 60_000) }

  async searchStocks(query: string, limit = 20): Promise<MarketSearchResult[]> {
    const q = query.trim().toLowerCase()
    if (!q) return []
    const requests = ['L', 'D', 'P'].map((list_status) =>
      this.client.query('stock_basic', { list_status }, STOCK_FIELDS, 6 * 60 * 60_000),
    )
    requests.push(this.client.query('stock_st', {}, ['ts_code', 'name', 'type'], 15 * 60_000))
    const settled = await Promise.allSettled(requests)
    const rows = settled.flatMap((result) => result.status === 'fulfilled' ? result.value : [])
    return rows
      .filter((row) => [row.ts_code, row.symbol, row.name, row.fullname, row.cnspell]
        .some((value) => String(value ?? '').toLowerCase().includes(q)))
      .slice(0, Math.max(1, Math.min(100, limit)))
      .map((row) => ({
        ...row,
        symbol: String(row.ts_code),
        name: String(row.name ?? row.fullname ?? ''),
        assetClass: 'equity' as const,
        sourceId: 'tushare',
      }))
  }

  async getProfile(symbol: string): Promise<{ profile: TushareRow | null; company: TushareRow | null }> {
    const [basic, company] = await Promise.all([
      this.client.query('stock_basic', { ts_code: symbol }, STOCK_FIELDS, 60 * 60_000),
      this.client.query('stock_company', { ts_code: symbol }, undefined, 60 * 60_000),
    ])
    return { profile: basic[0] ?? null, company: company[0] ?? null }
  }

  async getFinancials(
    symbol: string,
    type: 'income' | 'balance' | 'cash',
    options: { period?: 'annual' | 'quarter'; limit?: number; asOf?: string } = {},
  ): Promise<TushareDataset> {
    const apiName = type === 'income' ? 'income' : type === 'balance' ? 'balancesheet' : 'cashflow'
    const asOf = options.asOf ?? this.today()
    const limit = Math.max(1, Math.min(100, options.limit ?? 5))
    const rows = await this.client.query(apiName, { ts_code: symbol, limit: Math.max(40, limit * 8) }, undefined, 15 * 60_000)
    return dataset(financialAsOf(rows, asOf, options.period ?? 'annual', limit), asOf)
  }

  async getRatios(
    symbol: string,
    options: { period?: 'annual' | 'quarter'; limit?: number; asOf?: string } = {},
  ): Promise<TushareDataset> {
    const asOf = options.asOf ?? this.today()
    const limit = Math.max(1, Math.min(100, options.limit ?? 5))
    const rows = await this.client.query('fina_indicator', { ts_code: symbol, limit: Math.max(40, limit * 8) }, undefined, 15 * 60_000)
    return dataset(financialAsOf(rows, asOf, options.period ?? 'annual', limit), asOf)
  }

  async getBars(symbol: string, opts: GetBarsOpts): Promise<BarsResult> {
    if (!['1d', '1D', 'day', 'daily'].includes(opts.interval)) {
      throw new Error('Tushare P0 supports daily bars only (interval: 1d)')
    }
    const anchor = (opts.end ?? opts.asOf ?? this.today()).slice(0, 10)
    let start = opts.start?.slice(0, 10)
    if (!start) {
      const count = Math.max(1, opts.count ?? 250)
      start = new Date(new Date(`${anchor}T00:00:00Z`).getTime() - (count * 3 + 30) * DAY_MS)
        .toISOString().slice(0, 10)
    }
    const params = { ts_code: symbol, start_date: tsDate(start), end_date: tsDate(anchor) }
    const [dailyRows, factorRows] = await Promise.all([
      this.client.query('daily', params, undefined, 5 * 60_000),
      this.client.query('adj_factor', params, ['ts_code', 'trade_date', 'adj_factor'], 5 * 60_000),
    ])
    const factors = new Map(factorRows.map((row) => [String(row.trade_date), numberValue(row.adj_factor)]))
    const anchorFactor = factorRows
      .filter((row) => String(row.trade_date) <= tsDate(anchor))
      .sort((a, b) => String(b.trade_date).localeCompare(String(a.trade_date)))
      .map((row) => numberValue(row.adj_factor))
      .find((value): value is number => value != null)
    if (dailyRows.length > 0 && !anchorFactor) throw new Error(`Tushare returned no adjustment factor for ${symbol} at ${anchor}`)

    const bars: OhlcvBar[] = dailyRows.flatMap((row) => {
      const date = isoDate(row.trade_date)
      const factor = factors.get(String(row.trade_date))
      const open = numberValue(row.open)
      const high = numberValue(row.high)
      const low = numberValue(row.low)
      const close = numberValue(row.close)
      if (!date || factor == null || anchorFactor == null || open == null || high == null || low == null || close == null) return []
      const multiplier = factor / anchorFactor
      const volume = numberValue(row.vol)
      const amount = numberValue(row.amount)
      return [{
        date,
        open: open * multiplier,
        high: high * multiplier,
        low: low * multiplier,
        close: close * multiplier,
        volume: volume == null ? null : volume * 100,
        amount: amount == null ? null : amount * 1000,
      }]
    }).sort((a, b) => a.date.localeCompare(b.date))
    const bounded = opts.count && bars.length > opts.count ? bars.slice(-opts.count) : bars
    return {
      bars: bounded,
      meta: {
        symbol,
        from: bounded[0]?.date ?? '',
        to: bounded[bounded.length - 1]?.date ?? '',
        bars: bounded.length,
        source: 'vendor',
        sourceId: 'tushare',
        barId: `tushare|${symbol}`,
        provider: 'tushare',
        barCapability: 'delayed',
        asOf: anchor,
        adjustment: 'qfq',
        adjustmentAnchor: anchor,
        priceUnit: 'CNY',
        volumeUnit: 'shares',
        amountUnit: 'CNY',
      },
    }
  }
}
