/**
 * Deribit Futures Curve Model.
 * Maps to: openbb_deribit/models/futures_curve.py
 */

import { z } from 'zod'
import { Fetcher } from '../../../core/provider/abstract/fetcher.js'
import { FuturesCurveDataSchema } from '../../../standard-models/futures-curve.js'
import { EmptyDataError } from '../../../core/provider/utils/errors.js'
import { getFuturesCurveSymbols, getTickerData, DERIBIT_FUTURES_CURVE_SYMBOLS } from '../utils/helpers.js'

export const DeribitFuturesCurveQueryParamsSchema = z.object({
  symbol: z.string().default('BTC').transform(v => v.toUpperCase()).describe('Symbol: BTC, ETH, or PAXG.'),
  date: z.string().nullable().default(null).describe('Not used for Deribit. Use hours_ago instead.'),
}).passthrough()

export type DeribitFuturesCurveQueryParams = z.infer<typeof DeribitFuturesCurveQueryParamsSchema>

export const DeribitFuturesCurveDataSchema = FuturesCurveDataSchema
export type DeribitFuturesCurveData = z.infer<typeof DeribitFuturesCurveDataSchema>

export class DeribitFuturesCurveFetcher extends Fetcher {
  static override requireCredentials = false

  static override transformQuery(params: Record<string, unknown>): DeribitFuturesCurveQueryParams {
    return DeribitFuturesCurveQueryParamsSchema.parse(params)
  }

  static override async extractData(
    query: DeribitFuturesCurveQueryParams,
    _credentials: Record<string, string> | null,
  ): Promise<Record<string, unknown>[]> {
    const symbol = query.symbol
    if (!DERIBIT_FUTURES_CURVE_SYMBOLS.includes(symbol)) {
      throw new Error(`Invalid symbol: ${symbol}. Valid: ${DERIBIT_FUTURES_CURVE_SYMBOLS.join(', ')}`)
    }

    const instrumentNames = await getFuturesCurveSymbols(symbol)
    if (instrumentNames.length === 0) throw new EmptyDataError('No instruments found.')

    const results: Record<string, unknown>[] = []
    const tasks = instrumentNames.map(async (name) => {
      try {
        const ticker = await getTickerData(name)
        return { instrument_name: name, ...ticker }
      } catch {
        return null
      }
    })
    const tickerResults = await Promise.all(tasks)
    for (const t of tickerResults) {
      if (t) results.push(t)
    }

    if (results.length === 0) throw new EmptyDataError('No ticker data found.')
    return results
  }

  static override transformData(
    _query: DeribitFuturesCurveQueryParams,
    data: Record<string, unknown>[],
  ): DeribitFuturesCurveData[] {
    const today = new Date().toISOString().slice(0, 10)

    return data.map(d => {
      const name = d.instrument_name as string
      const parts = name.split('-')
      const raw = parts[1] ?? 'PERPETUAL'

      // PERPETUAL stays semantic (it has no expiry — substituting today's
      // date would fabricate one); dated contracts parse from Deribit's
      // DMMMYY format ("28MAR25", "4JUL25") to ISO so consumers can sort
      // and do date math on them.
      const expiration = raw === 'PERPETUAL' ? 'PERPETUAL' : deribitExpiryToIso(raw)

      const price = (d.last_price as number) ?? (d.mark_price as number) ?? 0

      return FuturesCurveDataSchema.parse({
        date: today,
        expiration,
        price,
      })
    }).sort((a, b) => a.expiration.localeCompare(b.expiration))
  }
}

const DERIBIT_MONTHS: Record<string, string> = {
  JAN: '01', FEB: '02', MAR: '03', APR: '04', MAY: '05', JUN: '06',
  JUL: '07', AUG: '08', SEP: '09', OCT: '10', NOV: '11', DEC: '12',
}

/** "28MAR25" / "4JUL25" → "2025-03-28" / "2025-07-04". Unknown shapes pass
 *  through unchanged (loud in data rather than silently dropped). */
export function deribitExpiryToIso(raw: string): string {
  const m = /^(\d{1,2})([A-Z]{3})(\d{2})$/.exec(raw)
  if (!m) return raw
  const month = DERIBIT_MONTHS[m[2]]
  if (!month) return raw
  return `20${m[3]}-${month}-${m[1].padStart(2, '0')}`
}
