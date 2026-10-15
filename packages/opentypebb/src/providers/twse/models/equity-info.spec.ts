import { describe, it, expect } from 'vitest'
import { TWSEEquityInfoFetcher } from './equity-info.js'
const q = {} as never

describe('EquityInfo transformData', () => {
  it('listed → profile, ROC listing date, paid-in capital', () => {
    const [r] = TWSEEquityInfoFetcher.transformData(q, [
      {
        raw: {
          公司名稱: '台灣積體電路製造股份有限公司', 網址: 'https://www.tsmc.com', 住址: '新竹科學園區',
          總機電話: '03-5636688', 總經理: 'CC Wei', 產業別: '24', 上市日期: '0760907', 實收資本額: '259303804580',
        },
        symbol: '2330.TW', board: 'TW',
      },
    ])
    expect(r).toMatchObject({
      symbol: '2330.TW', name: '台灣積體電路製造股份有限公司', stock_exchange: 'TWSE',
      company_url: 'https://www.tsmc.com', listing_date: '1987-09-07', paid_in_capital: 259303804580,
    })
  })

  it('OTC → trailing full-width space in URL trimmed', () => {
    const [r] = TWSEEquityInfoFetcher.transformData(q, [
      {
        raw: {
          CompanyName: '環球晶圓股份有限公司', WebAddress: 'https://www.sas-globalwafers.com　',
          Address: '新竹', GeneralManager: 'Doris Hsu', SecuritiesIndustryCode: '33',
          DateOfListing: '20150428', 'Paidin.Capital.NTDollars': '4356000000',
        },
        symbol: '6488.TWO', board: 'TWO',
      },
    ])
    expect(r).toMatchObject({ stock_exchange: 'TPEx', company_url: 'https://www.sas-globalwafers.com', listing_date: '2015-04-28' })
  })
})
