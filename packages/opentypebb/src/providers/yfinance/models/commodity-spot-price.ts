/**
 * YFinance Commodity Spot Price Fetcher.
 * Uses Yahoo Finance futures symbols (GC=F for gold, CL=F for crude, etc.)
 */

import { z } from 'zod'
import { Fetcher } from '../../../core/provider/abstract/fetcher.js'
import { CommoditySpotPriceQueryParamsSchema, CommoditySpotPriceDataSchema } from '../../../standard-models/commodity-spot-price.js'
import { getHistoricalData, emptyHistoricalError } from '../utils/helpers.js'

export const YFinanceCommoditySpotPriceQueryParamsSchema = CommoditySpotPriceQueryParamsSchema
export type YFinanceCommoditySpotPriceQueryParams = z.infer<typeof YFinanceCommoditySpotPriceQueryParamsSchema>

// Well-known commodity futures symbols
const COMMODITY_MAP: Record<string, string> = {
  gold: 'GC=F',
  silver: 'SI=F',
  platinum: 'PL=F',
  palladium: 'PA=F',
  copper: 'HG=F',
  crude_oil: 'CL=F',
  wti: 'CL=F',
  brent: 'BZ=F',
  natural_gas: 'NG=F',
  heating_oil: 'HO=F',
  gasoline: 'RB=F',
  corn: 'ZC=F',
  wheat: 'ZW=F',
  soybeans: 'ZS=F',
  oats: 'ZO=F',
  rice: 'ZR=F',
  orange_juice: 'OJ=F',
  feeder_cattle: 'GF=F',
  sugar: 'SB=F',
  coffee: 'KC=F',
  cocoa: 'CC=F',
  cotton: 'CT=F',
  lumber: 'LBR=F',
  live_cattle: 'LE=F',
  lean_hogs: 'HE=F',
}

function resolveSymbol(sym: string): string {
  const lower = sym.toLowerCase().trim()
  return COMMODITY_MAP[lower] ?? sym.trim()
}

export class YFinanceCommoditySpotPriceFetcher extends Fetcher {
  static override requireCredentials = false

  static override transformQuery(params: Record<string, unknown>): YFinanceCommoditySpotPriceQueryParams {
    const now = new Date()
    if (!params.start_date) {
      const oneYearAgo = new Date(now)
      oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1)
      params.start_date = oneYearAgo.toISOString().slice(0, 10)
    }
    if (!params.end_date) {
      params.end_date = now.toISOString().slice(0, 10)
    }
    return YFinanceCommoditySpotPriceQueryParamsSchema.parse(params)
  }

  static override async extractData(
    query: YFinanceCommoditySpotPriceQueryParams,
    _credentials: Record<string, string> | null,
  ): Promise<Record<string, unknown>[]> {
    const symbols = query.symbol.split(',').map(s => resolveSymbol(s)).filter(Boolean)

    const allData: Record<string, unknown>[] = []
    const results = await Promise.allSettled(
      symbols.map(async (sym) => {
        const data = await getHistoricalData(sym, {
          preserveIncomplete: true,
          startDate: query.start_date ?? undefined,
          endDate: query.end_date ?? undefined,
          interval: '1d',
        })
        return data.map((d: Record<string, unknown>) => ({ ...d, symbol: sym }))
      }),
    )

    for (const result of results) {
      if (result.status === 'fulfilled') {
        allData.push(...result.value)
      }
    }

    if (allData.length === 0) {
      throw emptyHistoricalError(results, 'No commodity history returned')
    }
    return allData
  }

  static override transformData(
    _query: YFinanceCommoditySpotPriceQueryParams,
    data: Record<string, unknown>[],
  ) {
    return data
      .sort((a, b) => String(a.date).localeCompare(String(b.date)))
      .map(d => CommoditySpotPriceDataSchema.parse(d))
  }
}
