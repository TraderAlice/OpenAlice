/**
 * Unit tests for the TWSE EquityInfo fetcher's pure transform logic.
 *
 * Raw API fixtures mirror the live shapes (verified 2026-06-08):
 * - TWSE t187ap03_L: Chinese keys (公司代號, 公司名稱, …), ROC 出表日期,
 *   Gregorian 成立日期/上市日期 ("19501229"), "－ " as the null marker.
 * - TPEx mopsfin_t187ap03_O: English keys (SecuritiesCompanyCode, …),
 *   trailing full-width spaces in Symbol / WebAddress.
 */

import { describe, it, expect } from 'vitest'
import { TwseEquityInfoFetcher, type TwseInfoRaw } from '../models/equity-info.js'
import { EmptyDataError } from '../../../core/provider/utils/errors.js'

const RAW: TwseInfoRaw = {
  twse: [
    {
      出表日期: '1150606',
      公司代號: '1101',
      公司名稱: '臺灣水泥股份有限公司',
      公司簡稱: '台泥',
      外國企業註冊地國: '－ ',
      產業別: '01',
      住址: '台北市中山北路2段113號',
      營利事業統一編號: '11913502',
      董事長: '張安平',
      總經理: '程耀輝',
      發言人: '葉毓君',
      總機電話: '(02)2531-7099',
      成立日期: '19501229',
      上市日期: '19620209',
      實收資本額: '77231817420',
      英文簡稱: 'TCC',
      電子郵件信箱: 'finance@taiwancement.com',
      網址: 'https://www.tccgroupholdings.com/tw/',
      已發行普通股數或TDR原股發行股數: '7523181742',
    },
  ],
  tpex: [
    {
      Date: '1150607',
      SecuritiesCompanyCode: '1240',
      CompanyName: '茂生農經股份有限公司',
      CompanyAbbreviation: '茂生農經',
      Registration: '－ ',
      SecuritiesIndustryCode: '33',
      Address: '2F.,No.30,Sec. 1,Heping W.Rd.,Taipei City',
      'UnifiedBusinessNo.': '18795706',
      Chairman: '吳清德',
      GeneralManager: '吳清德',
      Spokesman: '林信鴻',
      Telephone: '02-23671162',
      DateOfIncorporation: '19670218',
      DateOfListing: '20180808',
      'Paidin.Capital.NTDollars': '442323730',
      Symbol: 'MORNSUN　',
      EmailAddress: 'bedford@morn-sun.com.tw',
      WebAddress: 'https://www.morn-sun.com.tw/　',
      IssueShares: '44232373',
    },
  ],
}

const fetchInfo = (symbol: string) =>
  TwseEquityInfoFetcher.transformData(
    TwseEquityInfoFetcher.transformQuery({ symbol }),
    RAW,
  )

describe('TwseEquityInfoFetcher.transformData', () => {
  it('maps a TWSE-listed company profile', () => {
    const [info] = fetchInfo('1101.TW')
    expect(info).toMatchObject({
      symbol: '1101.TW',
      name: '台泥 (TCC)',
      legal_name: '臺灣水泥股份有限公司',
      stock_exchange: 'TWSE',
      ceo: '程耀輝',
      chairman: '張安平',
      company_url: 'https://www.tccgroupholdings.com/tw/',
      business_address: '台北市中山北路2段113號',
      business_phone_no: '(02)2531-7099',
      hq_country: 'TW',
      industry_category: '01',
      founded_date: '1950-12-29',
      listed_date: '1962-02-09',
      paid_in_capital: 77231817420,
      issued_shares: 7523181742,
      tax_id: '11913502',
      email: 'finance@taiwancement.com',
    })
  })

  it('maps a TPEx company profile, stripping full-width spaces', () => {
    const [info] = fetchInfo('1240.TWO')
    expect(info).toMatchObject({
      symbol: '1240.TWO',
      name: '茂生農經 (MORNSUN)',
      legal_name: '茂生農經股份有限公司',
      stock_exchange: 'TPEX',
      ceo: '吳清德',
      company_url: 'https://www.morn-sun.com.tw/',
      founded_date: '1967-02-18',
      listed_date: '2018-08-08',
      paid_in_capital: 442323730,
      issued_shares: 44232373,
    })
  })

  it('treats "－" registration as domestic (TW)', () => {
    const [info] = fetchInfo('1101.TW')
    expect(info.inc_country).toBe('TW')
  })

  it('resolves bare codes across both boards', () => {
    expect(fetchInfo('1101')[0]?.symbol).toBe('1101.TW')
    expect(fetchInfo('1240')[0]?.symbol).toBe('1240.TWO')
  })

  it('throws EmptyDataError when no symbol matches', () => {
    expect(() => fetchInfo('0000.TW')).toThrow(EmptyDataError)
  })
})
