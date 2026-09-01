import { tool } from 'ai'
import { z } from 'zod'
import type { TushareService } from '@/domain/market-data/tushare/service.js'

const date = z.string().regex(/^\d{4}-?\d{2}-?\d{2}$/, 'Expected YYYY-MM-DD or YYYYMMDD')
const code = z.string().describe('Tushare ts_code, e.g. 600519.SH or 000001.SZ')

function compact<T extends Record<string, unknown>>(value: T): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined && item !== ''))
}

export function createChinaTools(tushare: TushareService) {
  return {
    chinaTradeCalendar: tool({
      description: 'Read the official China exchange trading calendar from Tushare, including open/closed days and the previous open day.',
      inputSchema: z.object({
        exchange: z.enum(['SSE', 'SZSE', 'BSE', '']).optional(),
        start_date: date.optional(), end_date: date.optional(), is_open: z.enum(['0', '1']).optional(),
      }).meta({ examples: [{ exchange: 'SSE', start_date: '2026-01-01', end_date: '2026-01-31' }] }),
      execute: async (params) => tushare.tradeCalendar(compact(params)),
    }),
    chinaDailyBasic: tool({
      description: 'Read A-share daily valuation and trading indicators: turnover, volume ratio, PE/PB/PS, dividend yield, shares and market value.',
      inputSchema: z.object({
        ts_code: code.optional(), trade_date: date.optional(), start_date: date.optional(), end_date: date.optional(),
        limit: z.number().int().positive().max(6000).optional(),
      }).meta({ examples: [{ ts_code: '600519.SH', trade_date: '2026-08-31' }] }),
      execute: async (params) => tushare.dailyBasic(compact(params)),
    }),
    chinaSecurityStatus: tool({
      description: 'Read A-share special-treatment names, historical name changes, or daily suspension/resumption records.',
      inputSchema: z.object({
        type: z.enum(['st', 'namechange', 'suspension']), ts_code: code.optional(), trade_date: date.optional(),
        start_date: date.optional(), end_date: date.optional(),
      }).meta({ examples: [{ type: 'st', ts_code: '000001.SZ' }] }),
      execute: async ({ type, ...params }) => {
        const query = compact(params)
        if (type === 'st') return tushare.stockSt(query)
        if (type === 'namechange') return tushare.nameChange(query)
        return tushare.suspensions(query)
      },
    }),
    chinaForecast: tool({
      description: 'Read A-share performance forecasts with announcement dates preserved for point-in-time research.',
      inputSchema: z.object({ ts_code: code.optional(), ann_date: date.optional(), period: date.optional(), type: z.string().optional() })
        .meta({ examples: [{ ts_code: '600519.SH' }] }),
      execute: async (params) => tushare.forecast(compact(params)),
    }),
    chinaExpress: tool({
      description: 'Read A-share preliminary earnings reports (业绩快报), including announcement and reporting-period dates.',
      inputSchema: z.object({
        ts_code: code.optional(), ann_date: date.optional(), start_date: date.optional(), end_date: date.optional(), period: date.optional(),
      }).meta({ examples: [{ ts_code: '600519.SH' }] }),
      execute: async (params) => tushare.express(compact(params)),
    }),
    chinaDisclosures: tool({
      description: 'Read scheduled and actual A-share financial-report disclosure dates.',
      inputSchema: z.object({ ts_code: code.optional(), end_date: date.optional(), pre_date: date.optional(), actual_date: date.optional() })
        .meta({ examples: [{ ts_code: '600519.SH' }] }),
      execute: async (params) => tushare.disclosures(compact(params)),
    }),
    chinaIndustry: tool({
      description: 'Read Shenwan and other China index/industry classifications available from Tushare.',
      inputSchema: z.object({
        index_code: z.string().optional(), level: z.enum(['L1', 'L2', 'L3']).optional(), parent_code: z.string().optional(),
        src: z.string().optional().describe('Classification source, e.g. SW2021'),
      }).meta({ examples: [{ level: 'L1', src: 'SW2021' }] }),
      execute: async (params) => tushare.industry(compact(params)),
    }),
    chinaIndexCatalog: tool({
      description: 'Discover Tushare China index identifiers by market, publisher, or category.',
      inputSchema: z.object({
        ts_code: z.string().optional(), name: z.string().optional(), market: z.string().optional(),
        publisher: z.string().optional(), category: z.string().optional(),
      }).meta({ examples: [{ market: 'SSE' }] }),
      execute: async (params) => tushare.indexBasic(compact(params)),
    }),
    chinaIndexMembers: tool({
      description: 'Read current or historical members of a China index or industry classification.',
      inputSchema: z.object({
        l1_code: z.string().optional(), l2_code: z.string().optional(), l3_code: z.string().optional(),
        ts_code: code.optional(), is_new: z.enum(['Y', 'N']).optional(),
      }).meta({ examples: [{ l1_code: '801010.SI', is_new: 'Y' }] }),
      execute: async (params) => tushare.indexMembers(compact(params)),
    }),
    chinaIndexWeights: tool({
      description: 'Read constituent weights for a China index over a bounded trade-date window.',
      inputSchema: z.object({ index_code: z.string(), trade_date: date.optional(), start_date: date.optional(), end_date: date.optional() })
        .meta({ examples: [{ index_code: '000300.SH', trade_date: '2026-08-31' }] }),
      execute: async (params) => tushare.indexWeights(compact(params)),
    }),
  }
}
