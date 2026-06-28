/**
 * TWSE / TPEx Equity Info — official company profile from the basic-data
 * registers (listed: t187ap03_L; OTC: mopsfin_t187ap03_O). Maps the Chinese
 * register fields onto the standard EquityInfo shape; listing date + paid-in
 * capital are carried as extended passthrough fields.
 */

import { z } from 'zod'
import { Fetcher } from '../../../core/provider/abstract/fetcher.js'
import { EquityInfoQueryParamsSchema, EquityInfoDataSchema } from '../../../standard-models/equity-info.js'
import { EmptyDataError } from '../../../core/provider/utils/errors.js'
import { parseTwSymbol, companyByCode, cleanStr, cleanNum, rocToISO, type Board } from '../common.js'

export const TWSEEquityInfoQueryParamsSchema = EquityInfoQueryParamsSchema
export type TWSEEquityInfoQueryParams = z.infer<typeof TWSEEquityInfoQueryParamsSchema>

export const TWSEEquityInfoDataSchema = EquityInfoDataSchema.extend({
  listing_date: z.string().nullable().default(null).describe('Date first listed on TWSE/TPEx.'),
  paid_in_capital: z.number().nullable().default(null).describe('Paid-in capital, NT$.'),
}).passthrough()
export type TWSEEquityInfoData = z.infer<typeof TWSEEquityInfoDataSchema>

interface InfoHit {
  raw: Record<string, unknown>
  symbol: string
  board: Board
}

export class TWSEEquityInfoFetcher extends Fetcher {
  static override requireCredentials = false

  static override transformQuery(params: Record<string, unknown>): TWSEEquityInfoQueryParams {
    return TWSEEquityInfoQueryParamsSchema.parse(params)
  }

  static override async extractData(
    query: TWSEEquityInfoQueryParams,
    _credentials: Record<string, string> | null,
  ): Promise<InfoHit[]> {
    const symbols = query.symbol.split(',').map((s) => s.trim()).filter(Boolean)
    const out: InfoHit[] = []
    for (const sym of symbols) {
      const p = parseTwSymbol(sym)
      if (!p) continue
      const c = await companyByCode(p.code, p.board)
      if (c) out.push({ raw: c.raw, symbol: sym, board: p.board })
    }
    if (!out.length) throw new EmptyDataError('No TWSE/TPEx company profile for the given symbol(s).')
    return out
  }

  static override transformData(
    _query: TWSEEquityInfoQueryParams,
    data: InfoHit[],
  ): TWSEEquityInfoData[] {
    return data.map(({ raw, symbol, board }) => {
      const tw = board === 'TW'
      return TWSEEquityInfoDataSchema.parse({
        symbol,
        name: cleanStr(tw ? raw['公司名稱'] : raw['CompanyName']),
        legal_name: cleanStr(tw ? raw['公司名稱'] : raw['CompanyName']),
        stock_exchange: tw ? 'TWSE' : 'TPEx',
        company_url: cleanStr(tw ? raw['網址'] : raw['WebAddress']),
        business_address: cleanStr(tw ? raw['住址'] : raw['Address']),
        business_phone_no: cleanStr(tw ? raw['總機電話'] : raw['Telephone']),
        ceo: cleanStr(tw ? raw['總經理'] : raw['GeneralManager']),
        industry_category: cleanStr(tw ? raw['產業別'] : raw['SecuritiesIndustryCode']),
        listing_date: rocToISO(tw ? raw['上市日期'] : raw['DateOfListing']),
        paid_in_capital: cleanNum(tw ? raw['實收資本額'] : raw['Paidin.Capital.NTDollars']),
      })
    })
  }
}
