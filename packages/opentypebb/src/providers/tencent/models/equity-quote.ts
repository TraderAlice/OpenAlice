/**
 * Tencent Equity Quote — free CN A-share Level-1 snapshots via qt.gtimg.cn.
 *
 * Batch-friendly: comma-separated symbols share one HTTP request. Suitable for
 * ordinary realtime watching (exchange L1 refreshes ~3s); not for HFT.
 */

import { z } from 'zod'
import { Fetcher } from '../../../core/provider/abstract/fetcher.js'
import { EquityQuoteQueryParamsSchema, EquityQuoteDataSchema } from '../../../standard-models/equity-quote.js'
import { EmptyDataError } from '../../../core/provider/utils/errors.js'
import {
  exchangeForCode,
  fetchTencentQuotes,
  num,
  parseTencentTimestamp,
  toTencentCode,
  type TencentCode,
  type TencentQuoteRow,
} from '../common.js'

export const TencentEquityQuoteQueryParamsSchema = EquityQuoteQueryParamsSchema
export type TencentEquityQuoteQueryParams = z.infer<typeof TencentEquityQuoteQueryParamsSchema>

export const TencentEquityQuoteDataSchema = EquityQuoteDataSchema.extend({
  market_cap: z.number().nullable().default(null).describe('Total market cap in CNY (亿元 × 1e8).'),
  pe_ratio: z.number().nullable().default(null).describe('Trailing P/E from the snapshot.'),
  turnover_rate: z.number().nullable().default(null).describe('Turnover rate (%).'),
}).passthrough()
export type TencentEquityQuoteData = z.infer<typeof TencentEquityQuoteDataSchema>

interface QuoteHit {
  requested: string
  code: TencentCode
  row: TencentQuoteRow
}

export class TencentEquityQuoteFetcher extends Fetcher {
  static override requireCredentials = false

  static override transformQuery(params: Record<string, unknown>): TencentEquityQuoteQueryParams {
    return TencentEquityQuoteQueryParamsSchema.parse(params)
  }

  static override async extractData(
    query: TencentEquityQuoteQueryParams,
    _credentials: Record<string, string> | null,
  ): Promise<QuoteHit[]> {
    const requested = query.symbol.split(',').map((s) => s.trim()).filter(Boolean)
    const mapped: Array<{ requested: string; code: TencentCode }> = []
    for (const sym of requested) {
      const code = toTencentCode(sym)
      if (code) mapped.push({ requested: sym, code })
    }
    if (!mapped.length) {
      throw new EmptyDataError(
        'No CN A-share symbols recognized for Tencent quote (need sh/sz, .SS/.SZ, eastmoney secid, or 6-digit code).',
      )
    }

    const rows = await fetchTencentQuotes(mapped.map((m) => m.code))
    const byCode = new Map(rows.map((r) => [r.code, r]))
    const hits: QuoteHit[] = []
    for (const m of mapped) {
      const row = byCode.get(m.code)
      if (row) hits.push({ requested: m.requested, code: m.code, row })
    }
    if (!hits.length) throw new EmptyDataError('Tencent returned no quote rows for the given symbol(s).')
    return hits
  }

  static override transformData(
    _query: TencentEquityQuoteQueryParams,
    data: QuoteHit[],
  ): TencentEquityQuoteData[] {
    return data.map(({ requested, code, row }) => {
      const f = row.fields
      // Field layout (stable public convention):
      // 1 name, 2 code, 3 last, 4 prev, 5 open, 6 volume(手),
      // 9 bid1, 10 bid1手, 19 ask1, 20 ask1手,
      // 30 datetime, 31 change, 32 change%, 33 high, 34 low,
      // 39 PE, 43 turnover%, 44/45 mkt cap(亿), 47/48 52w high/low
      const volLots = num(f[6])
      const bidLots = num(f[10])
      const askLots = num(f[20])
      const changePctPoints = num(f[32])
      const mktCapYi = num(f[44]) ?? num(f[45])

      return TencentEquityQuoteDataSchema.parse({
        // Keep the caller-facing identity (already uppercased by the query schema).
        symbol: requested,
        asset_type: 'stock',
        name: f[1] || null,
        exchange: exchangeForCode(code),
        last_price: num(f[3]),
        prev_close: num(f[4]),
        open: num(f[5]),
        volume: volLots != null ? Math.round(volLots * 100) : null,
        bid: num(f[9]),
        bid_size: bidLots != null ? Math.round(bidLots) : null,
        ask: num(f[19]),
        ask_size: askLots != null ? Math.round(askLots) : null,
        last_timestamp: parseTencentTimestamp(f[30]),
        change: num(f[31]),
        // Snapshot % points → normalized fraction (OpenAlice quote contract).
        change_percent: changePctPoints != null ? changePctPoints / 100 : null,
        high: num(f[33]),
        low: num(f[34]),
        close: num(f[3]),
        pe_ratio: num(f[39]),
        turnover_rate: num(f[43]),
        market_cap: mktCapYi != null ? mktCapYi * 1e8 : null,
        year_high: num(f[47]),
        year_low: num(f[48]),
      })
    })
  }
}
