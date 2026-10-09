import { describe, it, expect } from 'vitest'
import { fetchCnAshareBoard } from './cn-ashare.js'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function textResponse(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { 'Content-Type': 'text/javascript' },
  })
}

const HKEX_DAILY = `tabData = [
  {
    "id": 0,
    "date": "2026-10-08",
    "market": "SSE Northbound",
    "tradingDay": 1,
    "content": [
      {
        "style": 1,
        "table": {
          "classname": "tradingTable",
          "schema": [["Total Turnover", "Total Trade Count", "DQB", "ETF Turnover"]],
          "tr": [
            { "td": [["134,535.72"]] },
            { "td": [["6,824,276"]] },
            { "td": [["999,999,999"]] },
            { "td": [["2,043.61"]] }
          ]
        }
      },
      {
        "style": 2,
        "table": {
          "classname": "top10Table",
          "schema": [["Rank", "Stock Code", "Stock Name", "Total Turnover"]],
          "tr": [
            { "td": [["1", "603259", "WUXI APPTEC", "2,729,984,203"]] }
          ]
        }
      }
    ]
  },
  {
    "id": 2,
    "date": "2026-10-08",
    "market": "SZSE Northbound",
    "tradingDay": 1,
    "content": [
      {
        "style": 1,
        "table": {
          "classname": "tradingTable",
          "schema": [["Total Turnover", "Total Trade Count", "DQB", "ETF Turnover"]],
          "tr": [
            { "td": [["98,001.00"]] },
            { "td": [["1,000"]] },
            { "td": [["Available"]] },
            { "td": [["100.5"]] }
          ]
        }
      },
      {
        "style": 2,
        "table": {
          "classname": "top10Table",
          "schema": [["Rank", "Stock Code", "Stock Name", "Total Turnover"]],
          "tr": []
        }
      }
    ]
  },
  {
    "id": 1,
    "date": "2026-10-08",
    "market": "SSE Southbound",
    "tradingDay": 1,
    "content": [
      {
        "style": 1,
        "table": {
          "classname": "tradingTable",
          "schema": [["Total Turnover", "Buy Turnover", "Sell Turnover", "Total Trade Count", "Buy Trade Count", "Sell Trade Count", "ETF Turnover"]],
          "tr": [
            { "td": [["50,388"]] },
            { "td": [["24,029"]] },
            { "td": [["26,360"]] },
            { "td": [["100"]] },
            { "td": [["40"]] },
            { "td": [["60"]] },
            { "td": [["10"]] }
          ]
        }
      }
    ]
  },
  {
    "id": 3,
    "date": "2026-10-08",
    "market": "SZSE Southbound",
    "tradingDay": 1,
    "content": [
      {
        "style": 1,
        "table": {
          "classname": "tradingTable",
          "schema": [["Total Turnover", "Buy Turnover", "Sell Turnover", "Total Trade Count", "Buy Trade Count", "Sell Trade Count", "ETF Turnover"]],
          "tr": [
            { "td": [["28,553"]] },
            { "td": [["15,587"]] },
            { "td": [["12,966"]] },
            { "td": [["80"]] },
            { "td": [["30"]] },
            { "td": [["50"]] },
            { "td": [["5"]] }
          ]
        }
      }
    ]
  }
];`

function mkFetch(handlers: Array<{ match: RegExp | string; res: () => Response }>): typeof fetch {
  return async (input) => {
    const url = String(input)
    for (const h of handlers) {
      const ok = typeof h.match === 'string' ? url.includes(h.match) : h.match.test(url)
      if (ok) return h.res()
    }
    return new Response(`unexpected ${url}`, { status: 404 })
  }
}

describe('cn-ashare board', () => {
  it('compiles CSI/CNI indexes and HKEX Connect legs with provenance', async () => {
    const fetchImpl = mkFetch([
      {
        match: /csindex-home\/perf\/index-perf.*000300/,
        res: () => jsonResponse({
          success: true,
          data: [{
            tradeDate: '20261008',
            indexCode: '000300',
            indexNameEn: 'CSI 300',
            close: 4310.12,
            changePct: 0.16,
            tradingValue: 4961.79,
            peg: 13.11,
          }],
        }),
      },
      {
        match: /csindex-home\/perf\/index-perf/,
        res: () => jsonResponse({
          success: true,
          data: [{
            tradeDate: '20261008',
            indexCode: '000905',
            indexNameEn: 'CSI 500',
            close: 7000,
            changePct: -0.5,
            tradingValue: 1000,
            peg: 20,
          }],
        }),
      },
      {
        match: /cnindex\.com\.cn.*399001/,
        res: () => jsonResponse({
          code: 200,
          data: {
            indexEName: 'Shenzhen Index',
            item: ['timestamp', 'close', 'percent', 'amount'],
            data: [['2026-10-08', 12620.9, '-2.07%', 4411.05]],
          },
        }),
      },
      {
        match: /cnindex\.com\.cn/,
        res: () => jsonResponse({
          code: 200,
          data: {
            indexEName: 'ChiNext',
            item: ['timestamp', 'close', 'percent', 'amount'],
            data: [['2026-10-08', 2800, '1.2%', 2000]],
          },
        }),
      },
      {
        match: /DailyStat\/data_tab_daily_/,
        res: () => textResponse(HKEX_DAILY),
      },
    ])

    const board = await fetchCnAshareBoard({
      fetch: fetchImpl,
      now: () => new Date('2026-10-09T08:00:00.000Z'),
      lookbackDays: 3,
    })

    expect(board.meta.origin).toBe('local')
    expect(board.meta.provider).toMatch(/csi/)
    expect(board.meta.provider).toMatch(/cni/)
    expect(board.meta.provider).toMatch(/hkex/)
    expect(board.sessionDate).toBe('2026-10-08')
    expect(board.indexes.some((i) => i.id === 'CSI:000300')).toBe(true)
    const csi300 = board.indexes.find((i) => i.id === 'CSI:000300')!
    expect(csi300.close).toBe(4310.12)
    expect(csi300.changePct).toBe(0.16)
    expect(csi300.quality).toBe('A')
    expect(csi300.dataType).toBe('official_close')

    expect(board.connect.sse?.turnover).toBe(134535.72)
    expect(board.connect.sse?.tradeCount).toBe(6824276)
    expect(board.connect.sse?.top10[0]?.code).toBe('603259')
    expect(board.connect.sse?.turnoverUnit).toBe('RMB_million')
    expect(board.connect.sse?.dataType).toBe('exchange_day_end')
    expect(board.connect.szse?.turnover).toBe(98001)
    expect(board.connect.hkex.sseSouthbound?.buyTurnover).toBe(24029)
    expect(board.connect.hkex.szseSouthbound?.turnoverUnit).toBe('HKD_million')
  })

  it('survives partial index failure when Connect succeeds', async () => {
    const fetchImpl = mkFetch([
      {
        match: /csindex-home\/perf\/index-perf/,
        res: () => jsonResponse({ success: true, data: [] }),
      },
      {
        match: /cnindex\.com\.cn/,
        res: () => { throw new Error('CNI down') },
      },
      {
        match: /DailyStat\/data_tab_daily_/,
        res: () => textResponse(HKEX_DAILY),
      },
    ])
    const board = await fetchCnAshareBoard({
      fetch: fetchImpl,
      now: () => new Date('2026-10-09T08:00:00.000Z'),
      lookbackDays: 2,
    })
    expect(board.indexes).toEqual([])
    expect(board.errors?.indexes).toBeTruthy()
    expect(board.connect.sse?.market).toBe('SSE Northbound')
  })

  it('throws when both indexes and Connect fail', async () => {
    const fetchImpl = mkFetch([
      { match: /csindex|cnindex|DailyStat/, res: () => new Response('nope', { status: 503 }) },
    ])
    await expect(fetchCnAshareBoard({
      fetch: fetchImpl,
      now: () => new Date('2026-10-09T08:00:00.000Z'),
      lookbackDays: 1,
    })).rejects.toThrow(/cn-ashare board failed/)
  })
})
