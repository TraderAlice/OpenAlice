import { describe, expect, it } from 'vitest'
import {
  decodeGbk,
  exchangeForCode,
  num,
  parseTencentQuoteBody,
  parseTencentTimestamp,
  toTencentCode,
} from '../common.js'
import { TencentEquityQuoteFetcher } from '../models/equity-quote.js'

describe('toTencentCode', () => {
  it('accepts prefixed, Yahoo, Eastmoney, and bare A-share forms', () => {
    expect(toTencentCode('sh600519')).toBe('sh600519')
    expect(toTencentCode('SZ000001')).toBe('sz000001')
    expect(toTencentCode('600519.SS')).toBe('sh600519')
    expect(toTencentCode('000001.sz')).toBe('sz000001')
    expect(toTencentCode('1.600519')).toBe('sh600519')
    expect(toTencentCode('0.000001')).toBe('sz000001')
    expect(toTencentCode('600519')).toBe('sh600519')
    expect(toTencentCode('300750')).toBe('sz300750')
    expect(toTencentCode('000001')).toBe('sz000001')
  })

  it('rejects non A-share identities', () => {
    expect(toTencentCode('AAPL')).toBeNull()
    expect(toTencentCode('2330.TW')).toBeNull()
    expect(toTencentCode('7.600519')).toBeNull()
    expect(toTencentCode('')).toBeNull()
  })
})

describe('parse helpers', () => {
  it('parseTencentTimestamp — Shanghai wall clock → ISO', () => {
    expect(parseTencentTimestamp('20260923161450')).toBe('2026-09-23T08:14:50.000Z')
    expect(parseTencentTimestamp('bad')).toBeNull()
    expect(parseTencentTimestamp(undefined)).toBeNull()
  })

  it('num — blanks and dashes → null', () => {
    expect(num('12.5')).toBe(12.5)
    expect(num('')).toBeNull()
    expect(num('-')).toBeNull()
    expect(num(undefined)).toBeNull()
  })

  it('exchangeForCode', () => {
    expect(exchangeForCode('sh600519')).toBe('SSE')
    expect(exchangeForCode('sz000001')).toBe('SZSE')
  })

  it('decodeGbk round-trips ASCII', () => {
    const bytes = new TextEncoder().encode('v_sh600519="ok";')
    expect(decodeGbk(bytes.buffer)).toContain('ok')
  })
})

describe('parseTencentQuoteBody', () => {
  it('extracts multi-symbol rows and skips empty payloads', () => {
    const body =
      'v_sh600519="1~贵州茅台~600519~1251.24~1253.80~1255.03~30981~0~0~1251.24~1~0~0~0~0~0~0~0~0~1251.38~1~0~0~0~0~0~0~0~0~~20260923161450~-2.56~-0.20~1271.50~1250.89~x~30981~0~0~19.21~~0~0~1.64~15641.52~15641.52~0~1379.18~1128.42~0~0~0~0~0~~~0~0~0~1~A~GP-A~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~~~0~0~~CNY~0~x~0~0~";\n' +
      'v_sz000001="";\n' +
      'v_sz300750="51~宁德时代~300750~10.00~9.00~9.50~100~0~0~9.90~2~0~0~0~0~0~0~0~0~10.10~3~0~0~0~0~0~0~0~0~~20260923150000~1.00~11.11~10.50~9.40~x~100~0~0~20~~0~0~1~100.00~100.00~0~12.00~8.00~0~0~0~0~0~~~0~0~0~1~A~GP-A~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~~~0~0~~CNY~0~x~0~0~";\n'
    const rows = parseTencentQuoteBody(body)
    expect(rows.map((r) => r.code)).toEqual(['sh600519', 'sz300750'])
    expect(rows[0].fields[1]).toBe('贵州茅台')
    expect(rows[1].fields[2]).toBe('300750')
  })
})

describe('EquityQuote transformData', () => {
  it('maps Tencent fields onto the standard quote contract', () => {
    const fields = Array.from({ length: 50 }, () => '')
    fields[1] = '贵州茅台'
    fields[2] = '600519'
    fields[3] = '1251.24'
    fields[4] = '1253.80'
    fields[5] = '1255.03'
    fields[6] = '30981'
    fields[9] = '1251.24'
    fields[10] = '1'
    fields[19] = '1251.38'
    fields[20] = '2'
    fields[30] = '20260923161450'
    fields[31] = '-2.56'
    fields[32] = '-0.20'
    fields[33] = '1271.50'
    fields[34] = '1250.89'
    fields[39] = '19.21'
    fields[43] = '1.64'
    fields[44] = '15641.52'
    fields[47] = '1379.18'
    fields[48] = '1128.42'

    const [r] = TencentEquityQuoteFetcher.transformData({} as never, [
      { requested: '1.600519', code: 'sh600519', row: { code: 'sh600519', fields } },
    ])

    expect(r).toMatchObject({
      symbol: '1.600519',
      name: '贵州茅台',
      exchange: 'SSE',
      last_price: 1251.24,
      prev_close: 1253.8,
      open: 1255.03,
      volume: 3_098_100,
      bid: 1251.24,
      bid_size: 1,
      ask: 1251.38,
      ask_size: 2,
      change: -2.56,
      change_percent: -0.002,
      high: 1271.5,
      low: 1250.89,
      pe_ratio: 19.21,
      turnover_rate: 1.64,
      market_cap: 15641.52 * 1e8,
      year_high: 1379.18,
      year_low: 1128.42,
      last_timestamp: '2026-09-23T08:14:50.000Z',
    })
  })
})
