/**
 * Eastmoney (东方财富) Equity Historical Fetcher.
 *
 * CN A-share K-line via Eastmoney's public push2his endpoint. `symbol` is the
 * Eastmoney secid (`1.600519` SSE / `0.000001` SZSE) produced by this provider's
 * EquitySearch — discovery and quote share one namespace, no Yahoo mapping.
 * fqt=1 → front-adjusted (前复权), the CN-native quality yfinance lacks.
 *
 * ⚠️ Eastmoney klines are CSV in OCHL order: "date,open,CLOSE,HIGH,low,volume,amount"
 * (fields f51..f57). Mapping below is deliberate — do NOT assume OHLC.
 */

import { z } from 'zod'
import { Fetcher } from '../../../core/provider/abstract/fetcher.js'
import { amakeRequest } from '../../../core/provider/utils/helpers.js'
import { EquityHistoricalQueryParamsSchema, EquityHistoricalDataSchema } from '../../../standard-models/equity-historical.js'

const KLINE_URL = 'https://push2his.eastmoney.com/api/qt/stock/kline/get'
const HEADERS = { 'User-Agent': 'Mozilla/5.0', Referer: 'https://quote.eastmoney.com/' }

/** Our BarInterval → Eastmoney klt code. */
const KLT: Record<string, string> = {
  '1m': '1', '5m': '5', '15m': '15', '30m': '30', '1h': '60', '1d': '101', '1w': '102',
}

export const EastmoneyEquityHistoricalQueryParamsSchema = EquityHistoricalQueryParamsSchema.extend({
  interval: z.string().default('1d').describe('Bar interval (1m/5m/15m/30m/1h/1d/1w).'),
})
export type EastmoneyEquityHistoricalQueryParams = z.infer<typeof EastmoneyEquityHistoricalQueryParamsSchema>

export class EastmoneyEquityHistoricalFetcher extends Fetcher {
  static override requireCredentials = false

  static override transformQuery(params: Record<string, unknown>): EastmoneyEquityHistoricalQueryParams {
    return EastmoneyEquityHistoricalQueryParamsSchema.parse(params)
  }

  static override async extractData(
    query: EastmoneyEquityHistoricalQueryParams,
    _credentials: Record<string, string> | null,
  ): Promise<string[]> {
    const secid = query.symbol // already "{MktNum}.{Code}"; toUpperCase is a no-op on digits
    const klt = KLT[query.interval] ?? '101'
    const beg = query.start_date ? query.start_date.replace(/-/g, '') : '0'
    const end = query.end_date ? query.end_date.replace(/-/g, '') : '20500101'
    const url =
      `${KLINE_URL}?secid=${encodeURIComponent(secid)}&klt=${klt}&fqt=1&beg=${beg}&end=${end}` +
      `&fields1=f1,f2,f3,f4,f5&fields2=f51,f52,f53,f54,f55,f56,f57`
    const raw = await amakeRequest<{ data?: { klines?: string[] } }>(url, { headers: HEADERS })
    return raw.data?.klines ?? []
  }

  static override transformData(
    _query: EastmoneyEquityHistoricalQueryParams,
    klines: string[],
  ): EquityHistoricalData[] {
    return klines.map((line) => {
      // OCHL: date, open, close, high, low, volume, amount
      const [date, open, close, high, low, volume] = line.split(',')
      return EquityHistoricalDataSchema.parse({
        date,
        open: Number(open),
        high: Number(high),
        low: Number(low),
        close: Number(close),
        volume: Number(volume),
      })
    })
  }
}

type EquityHistoricalData = z.infer<typeof EquityHistoricalDataSchema>
