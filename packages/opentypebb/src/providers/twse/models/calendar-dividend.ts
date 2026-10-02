/** Cash-dividend events in TWSE's current listed-securities announcement snapshot.
 * Pure rights issues are intentionally excluded; TPEx/history are not covered.
 */
import { z } from 'zod'
import { Fetcher } from '../../../core/provider/abstract/fetcher.js'
import { amakeRequest } from '../../../core/provider/utils/helpers.js'
import { CalendarDividendQueryParamsSchema, CalendarDividendDataSchema } from '../../../standard-models/calendar-dividend.js'
import { TWSE_BASE, cleanNum, cleanStr, parseTwSymbol, rocToISO } from '../common.js'

export const TWSECalendarDividendQueryParamsSchema = CalendarDividendQueryParamsSchema.extend({
  start_date: z.string().date().nullable().default(null),
  end_date: z.string().date().nullable().default(null),
}).refine((query) => !query.start_date || !query.end_date || query.start_date <= query.end_date, {
  message: 'start_date must be on or before end_date',
})
type Query = z.infer<typeof TWSECalendarDividendQueryParamsSchema>

export class TWSECalendarDividendFetcher extends Fetcher {
  static override requireCredentials = false

  static override transformQuery(params: Record<string, unknown>): Query {
    return TWSECalendarDividendQueryParamsSchema.parse(params)
  }

  static override async extractData(_query: Query, _credentials: Record<string, string> | null): Promise<Record<string, unknown>[]> {
    return amakeRequest(`${TWSE_BASE}/exchangeReport/TWT48U_ALL`, { headers: { 'User-Agent': 'Mozilla/5.0' } })
  }

  static override transformData(query: Query, rows: Record<string, unknown>[]) {
    return rows.flatMap((row) => {
      if (!['息', '權息'].includes(cleanStr(row.Exdividend) ?? '')) return []
      const date = rocToISO(row.Date)
      const code = cleanStr(row.Code)
      if (!date || !z.string().date().safeParse(date).success || !code || !parseTwSymbol(`${code}.TW`)) return []
      if (query.start_date && date < query.start_date || query.end_date && date > query.end_date) return []
      return [CalendarDividendDataSchema.parse({
        ex_dividend_date: date,
        symbol: `${code.toUpperCase()}.TW`,
        name: cleanStr(row.Name),
        amount: cleanNum(row.CashDividend),
      })]
    }).sort((a, b) => a.ex_dividend_date.localeCompare(b.ex_dividend_date) || a.symbol.localeCompare(b.symbol))
  }
}
