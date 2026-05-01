/**
 * FMP Price Target Consensus Model.
 * Maps to: openbb_fmp/models/price_target_consensus.py
 */

import { z } from 'zod'
import { Fetcher } from '../../../core/provider/abstract/fetcher.js'
import { PriceTargetConsensusQueryParamsSchema, PriceTargetConsensusDataSchema } from '../../../standard-models/price-target-consensus.js'
import { applyAliases, amakeRequest } from '../../../core/provider/utils/helpers.js'
import { OpenBBError, EmptyDataError } from '../../../core/provider/utils/errors.js'
import { responseCallback } from '../utils/helpers.js'

// --- Query Params ---

export const FMPPriceTargetConsensusQueryParamsSchema = PriceTargetConsensusQueryParamsSchema

export type FMPPriceTargetConsensusQueryParams = z.infer<typeof FMPPriceTargetConsensusQueryParamsSchema>

// --- Data ---

export const FMPPriceTargetConsensusDataSchema = PriceTargetConsensusDataSchema

export type FMPPriceTargetConsensusData = z.infer<typeof FMPPriceTargetConsensusDataSchema>

// --- Fetcher ---

export class FMPPriceTargetConsensusFetcher extends Fetcher {
  static override transformQuery(params: Record<string, unknown>): FMPPriceTargetConsensusQueryParams {
    if (!params.symbol) {
      throw new OpenBBError('Symbol is a required field for FMP.')
    }
    return FMPPriceTargetConsensusQueryParamsSchema.parse(params)
  }

  static override async extractData(
    query: FMPPriceTargetConsensusQueryParams,
    credentials: Record<string, string> | null,
  ): Promise<Record<string, unknown>[]> {
    const apiKey = credentials?.fmp_api_key ?? ''
    const symbols = (query.symbol ?? '').split(',')
    const results: Record<string, unknown>[] = []

    const getOne = async (symbol: string) => {
      const url = `https://financialmodelingprep.com/stable/price-target-consensus?symbol=${symbol}&apikey=${apiKey}`
      try {
        const result = await amakeRequest<Record<string, unknown>[]>(url, { responseCallback })
        if (result && result.length > 0) {
          results.push(...result)
        } else {
          // No analyst price targets — common for ETFs, small-caps without
          // sell-side coverage, or recently IPO'd tickers. Not an error.
          console.info(`fmp/price-target-consensus: no analyst targets for ${symbol}`)
        }
      } catch (err) {
        console.warn(`fmp/price-target-consensus: request failed for ${symbol}:`, err instanceof Error ? err.message : err)
      }
    }

    await Promise.all(symbols.map(getOne))

    if (results.length === 0) {
      throw new EmptyDataError('No data returned for the given symbols.')
    }

    return results.sort((a, b) => {
      const ai = symbols.indexOf(String(a.symbol ?? ''))
      const bi = symbols.indexOf(String(b.symbol ?? ''))
      return ai - bi
    })
  }

  static override transformData(
    query: FMPPriceTargetConsensusQueryParams,
    data: Record<string, unknown>[],
  ): FMPPriceTargetConsensusData[] {
    return data.map((d) => FMPPriceTargetConsensusDataSchema.parse(d))
  }
}
