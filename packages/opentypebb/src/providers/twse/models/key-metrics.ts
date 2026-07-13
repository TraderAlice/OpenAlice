/**
 * TWSE / TPEx Key Metrics — official valuation ratios: P/E (本益比), dividend
 * yield (殖利率), and price-to-book (股價淨值比). Listed (.TW) from TWSE
 * BWIBBU_ALL; OTC (.TWO) from TPEx peratio analysis. These three are the
 * vendor's特質化 value — the slice yfinance doesn't serve for Taiwan names.
 *
 * The standard KeyMetrics schema is thin (market_cap etc.), so the ratios are
 * carried as extended passthrough fields.
 */

import { z } from 'zod'
import { Fetcher } from '../../../core/provider/abstract/fetcher.js'
import { KeyMetricsQueryParamsSchema, KeyMetricsDataSchema } from '../../../standard-models/key-metrics.js'
import { EmptyDataError } from '../../../core/provider/utils/errors.js'
import { parseTwSymbol, listedMetrics, otcMetrics, cleanNum, rocToISO, type Board } from '../common.js'

export const TWSEKeyMetricsQueryParamsSchema = KeyMetricsQueryParamsSchema
export type TWSEKeyMetricsQueryParams = z.infer<typeof TWSEKeyMetricsQueryParamsSchema>

export const TWSEKeyMetricsDataSchema = KeyMetricsDataSchema.extend({
  pe_ratio: z.number().nullable().default(null).describe('Price-to-earnings ratio (本益比).'),
  dividend_yield: z.number().nullable().default(null).describe('Dividend yield %, official (殖利率).'),
  price_to_book: z.number().nullable().default(null).describe('Price-to-book ratio (股價淨值比).'),
}).passthrough()
export type TWSEKeyMetricsData = z.infer<typeof TWSEKeyMetricsDataSchema>

interface MetricHit {
  row: Record<string, unknown>
  symbol: string
  board: Board
}

export class TWSEKeyMetricsFetcher extends Fetcher {
  static override requireCredentials = false

  static override transformQuery(params: Record<string, unknown>): TWSEKeyMetricsQueryParams {
    return TWSEKeyMetricsQueryParamsSchema.parse(params)
  }

  static override async extractData(
    query: TWSEKeyMetricsQueryParams,
    _credentials: Record<string, string> | null,
  ): Promise<MetricHit[]> {
    const symbols = query.symbol.split(',').map((s) => s.trim()).filter(Boolean)
    const out: MetricHit[] = []
    for (const sym of symbols) {
      const p = parseTwSymbol(sym)
      if (!p) continue
      const map = p.board === 'TW' ? await listedMetrics() : await otcMetrics()
      const row = map.get(p.code)
      if (row) out.push({ row, symbol: sym, board: p.board })
    }
    if (!out.length) throw new EmptyDataError('No TWSE/TPEx key metrics for the given symbol(s).')
    return out
  }

  static override transformData(
    _query: TWSEKeyMetricsQueryParams,
    data: MetricHit[],
  ): TWSEKeyMetricsData[] {
    return data.map(({ row, symbol, board }) => {
      const tw = board === 'TW'
      return TWSEKeyMetricsDataSchema.parse({
        symbol,
        period_ending: rocToISO(row['Date']),
        currency: 'TWD',
        pe_ratio: cleanNum(tw ? row['PEratio'] : row['PriceEarningRatio']),
        dividend_yield: cleanNum(tw ? row['DividendYield'] : row['YieldRatio']),
        price_to_book: cleanNum(tw ? row['PBratio'] : row['PriceBookRatio']),
      })
    })
  }
}
