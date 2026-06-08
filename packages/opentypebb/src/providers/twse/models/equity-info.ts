/**
 * TWSE Equity Info Fetcher.
 *
 * Company profiles for Taiwan securities from the free official open-data
 * APIs (no API key) — chairman / CEO, addresses, incorporation & listing
 * dates, capital structure. Board-wide snapshots — extractData fetches
 * only the board(s) the queried symbols need.
 *
 * Sources (shapes verified live 2026-06-08):
 * - https://openapi.twse.com.tw/v1/opendata/t187ap03_L
 *   TWSE listed (.TW) — Chinese keys (公司代號, 公司名稱, 董事長, …).
 *   成立日期/上市日期 are Gregorian "YYYYMMDD"; 出表日期 is ROC.
 * - https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap03_O
 *   TPEx OTC (.TWO) — English keys (SecuritiesCompanyCode, Chairman, …).
 *   String values may carry trailing full-width spaces; "－" marks null.
 *
 * 產業別 / SecuritiesIndustryCode is emitted verbatim into
 * `industry_category` — the exchanges publish no open code→name table, and
 * the two boards use different numbering, so no mapping is attempted here.
 */

import { z } from 'zod'
import { Fetcher } from '../../../core/provider/abstract/fetcher.js'
import { EmptyDataError } from '../../../core/provider/utils/errors.js'
import { EquityInfoQueryParamsSchema, EquityInfoDataSchema } from '../../../standard-models/equity-info.js'
import {
  TW_HEADERS, twseFetch, toNum, toYahooSymbol, parseSymbolList, boardsNeeded,
  type ParsedTwSymbol,
} from './common.js'

// ==================== Provider-specific schemas ====================

export const TwseEquityInfoQueryParamsSchema = EquityInfoQueryParamsSchema
export type TwseEquityInfoQueryParams = z.infer<typeof TwseEquityInfoQueryParamsSchema>

export const TwseEquityInfoDataSchema = EquityInfoDataSchema.extend({
  chairman: z.string().nullable().default(null).describe('Chairman of the board.'),
  spokesman: z.string().nullable().default(null).describe('Company spokesperson.'),
  founded_date: z.string().nullable().default(null).describe('Date of incorporation (ISO).'),
  listed_date: z.string().nullable().default(null).describe('Date of exchange listing (ISO).'),
  paid_in_capital: z.number().nullable().default(null).describe('Paid-in capital, in TWD.'),
  issued_shares: z.number().nullable().default(null).describe('Issued common shares.'),
  tax_id: z.string().nullable().default(null).describe('Unified business number (統一編號).'),
  email: z.string().nullable().default(null).describe('Investor-relations email address.'),
}).strip()
export type TwseEquityInfoData = z.infer<typeof TwseEquityInfoDataSchema>

// ==================== Raw API shapes ====================

export interface TwseProfileRow {
  公司代號: string
  公司名稱: string
  公司簡稱: string
  外國企業註冊地國: string
  產業別: string
  住址: string
  營利事業統一編號: string
  董事長: string
  總經理: string
  發言人: string
  總機電話: string
  成立日期: string
  上市日期: string
  實收資本額: string
  英文簡稱: string
  電子郵件信箱: string
  網址: string
  已發行普通股數或TDR原股發行股數: string
  [key: string]: unknown
}

export interface TpexProfileRow {
  SecuritiesCompanyCode: string
  CompanyName: string
  CompanyAbbreviation: string
  Registration: string
  SecuritiesIndustryCode: string
  Address: string
  'UnifiedBusinessNo.': string
  Chairman: string
  GeneralManager: string
  Spokesman: string
  Telephone: string
  DateOfIncorporation: string
  DateOfListing: string
  'Paidin.Capital.NTDollars': string
  /** English short name — the API's own key for it. */
  Symbol: string
  EmailAddress: string
  WebAddress: string
  IssueShares: string
  [key: string]: unknown
}

/** Board-wide snapshots — boards not needed by the query stay empty. */
export interface TwseInfoRaw {
  twse: TwseProfileRow[]
  tpex: TpexProfileRow[]
}

// ==================== Endpoints ====================

const TWSE_PROFILE_URL = 'https://openapi.twse.com.tw/v1/opendata/t187ap03_L'
const TPEX_PROFILE_URL = 'https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap03_O'

// ==================== Value cleaning ====================

/** Trim ASCII + full-width spaces; "" and "－" become null. */
function cleanStr(value: string | undefined): string | null {
  const trimmed = value?.replace(/[\s　]+$/g, '').replace(/^[\s　]+/g, '')
  if (!trimmed || trimmed === '－') return null
  return trimmed
}

/** Gregorian packed date ("19501229") → ISO ("1950-12-29"). */
function ymdToIso(value: string | undefined): string | null {
  if (!value || !/^\d{8}$/.test(value)) return null
  return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6)}`
}

/** "台泥" + "TCC" → "台泥 (TCC)" — same convention as EquitySearch. */
function displayName(short: string | null, english: string | null): string | null {
  if (!short) return english
  return english ? `${short} (${english})` : short
}

// ==================== Row mapping ====================

function mapTwseRow(row: TwseProfileRow): TwseEquityInfoData {
  // 外國企業註冊地國 is "－" for domestic companies.
  const registration = cleanStr(row.外國企業註冊地國)
  return TwseEquityInfoDataSchema.parse({
    symbol: toYahooSymbol(row.公司代號, 'TWSE'),
    name: displayName(cleanStr(row.公司簡稱), cleanStr(row.英文簡稱)),
    legal_name: cleanStr(row.公司名稱),
    stock_exchange: 'TWSE',
    ceo: cleanStr(row.總經理),
    chairman: cleanStr(row.董事長),
    spokesman: cleanStr(row.發言人),
    company_url: cleanStr(row.網址),
    business_address: cleanStr(row.住址),
    business_phone_no: cleanStr(row.總機電話),
    hq_country: 'TW',
    inc_country: registration ?? 'TW',
    industry_category: cleanStr(row.產業別),
    founded_date: ymdToIso(row.成立日期),
    listed_date: ymdToIso(row.上市日期),
    paid_in_capital: toNum(row.實收資本額),
    issued_shares: toNum(row.已發行普通股數或TDR原股發行股數),
    tax_id: cleanStr(row.營利事業統一編號),
    email: cleanStr(row.電子郵件信箱),
  })
}

function mapTpexRow(row: TpexProfileRow): TwseEquityInfoData {
  const registration = cleanStr(row.Registration)
  return TwseEquityInfoDataSchema.parse({
    symbol: toYahooSymbol(row.SecuritiesCompanyCode, 'TPEX'),
    name: displayName(cleanStr(row.CompanyAbbreviation), cleanStr(row.Symbol)),
    legal_name: cleanStr(row.CompanyName),
    stock_exchange: 'TPEX',
    ceo: cleanStr(row.GeneralManager),
    chairman: cleanStr(row.Chairman),
    spokesman: cleanStr(row.Spokesman),
    company_url: cleanStr(row.WebAddress),
    business_address: cleanStr(row.Address),
    business_phone_no: cleanStr(row.Telephone),
    hq_country: 'TW',
    inc_country: registration ?? 'TW',
    industry_category: cleanStr(row.SecuritiesIndustryCode),
    founded_date: ymdToIso(row.DateOfIncorporation),
    listed_date: ymdToIso(row.DateOfListing),
    paid_in_capital: toNum(row['Paidin.Capital.NTDollars']),
    issued_shares: toNum(row.IssueShares),
    tax_id: cleanStr(row['UnifiedBusinessNo.']),
    email: cleanStr(row.EmailAddress),
  })
}

/** Resolve one queried symbol against the fetched boards — TWSE wins for bare codes. */
function resolveSymbol(parsed: ParsedTwSymbol, raw: TwseInfoRaw): TwseEquityInfoData | null {
  if (parsed.board !== 'TPEX') {
    const hit = raw.twse.find((r) => r.公司代號 === parsed.code)
    if (hit) return mapTwseRow(hit)
  }
  if (parsed.board !== 'TWSE') {
    const hit = raw.tpex.find((r) => r.SecuritiesCompanyCode === parsed.code)
    if (hit) return mapTpexRow(hit)
  }
  return null
}

// ==================== Fetcher ====================

export class TwseEquityInfoFetcher extends Fetcher {
  static override requireCredentials = false

  static override transformQuery(params: Record<string, unknown>): TwseEquityInfoQueryParams {
    return TwseEquityInfoQueryParamsSchema.parse(params)
  }

  static override async extractData(
    query: TwseEquityInfoQueryParams,
    _credentials: Record<string, string> | null,
  ): Promise<TwseInfoRaw> {
    const needed = boardsNeeded(parseSymbolList(query.symbol))
    const [twse, tpex] = await Promise.all([
      needed.twse
        ? twseFetch<TwseProfileRow[]>(TWSE_PROFILE_URL, { headers: TW_HEADERS })
        : Promise.resolve([] as TwseProfileRow[]),
      needed.tpex
        ? twseFetch<TpexProfileRow[]>(TPEX_PROFILE_URL, { headers: TW_HEADERS })
        : Promise.resolve([] as TpexProfileRow[]),
    ])
    return { twse, tpex }
  }

  static override transformData(
    query: TwseEquityInfoQueryParams,
    data: TwseInfoRaw,
  ): TwseEquityInfoData[] {
    const results = parseSymbolList(query.symbol)
      .map((parsed) => resolveSymbol(parsed, data))
      .filter((i): i is TwseEquityInfoData => i !== null)
    if (results.length === 0) {
      throw new EmptyDataError(`No Taiwan company profiles found for: ${query.symbol}`)
    }
    return results
  }
}
