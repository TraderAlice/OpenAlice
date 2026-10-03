/**
 * FMP Index Constituents Model.
 * Maps to: openbb_fmp/models/index_constituents.py
 */

import { z } from 'zod'
import { Fetcher } from '../../../core/provider/abstract/fetcher.js'
import { IndexConstituentsQueryParamsSchema, IndexConstituentsDataSchema } from '../../../standard-models/index-constituents.js'
import { applyAliases } from '../../../core/provider/utils/helpers.js'
import { getDataMany } from '../utils/helpers.js'

const ALIAS_DICT: Record<string, string> = {
  headquarter: 'headQuarter',
  date_added: 'dateFirstAdded',
  industry: 'subSector',
  name: 'addedSecurity',
  removed_symbol: 'removedTicker',
  removed_name: 'removedSecurity',
}

export const FMPIndexConstituentsQueryParamsSchema = IndexConstituentsQueryParamsSchema.extend({
  symbol: z.string().trim().toLowerCase()
    .transform((value) => value === '^gspc' ? 'sp500' : value === '^dji' ? 'dowjones' : value)
    .pipe(z.enum(['dowjones', 'sp500', 'nasdaq']))
    .default('dowjones').describe('FMP index name, or ^GSPC / ^DJI.'),
  historical: z.boolean().default(false).describe('Flag to retrieve historical removals and additions.'),
})
export type FMPIndexConstituentsQueryParams = z.infer<typeof FMPIndexConstituentsQueryParamsSchema>

export const FMPIndexConstituentsDataSchema = IndexConstituentsDataSchema.extend({
  sector: z.string().nullable().default(null).describe('Sector classification.'),
  industry: z.string().nullable().default(null).describe('Industry classification.'),
  headquarter: z.string().nullable().default(null).describe('Location of headquarters.'),
  date_added: z.string().nullable().default(null).describe('Date added to the index.'),
  cik: z.string().nullable().default(null).describe('CIK number.'),
  founded: z.string().nullable().default(null).describe('When the company was founded.'),
  removed_symbol: z.string().nullable().default(null).describe('Symbol of the company removed.'),
  removed_name: z.string().nullable().default(null).describe('Name of the company removed.'),
  reason: z.string().nullable().default(null).describe('Reason for the removal.'),
  date: z.string().nullable().default(null).describe('Date of the historical constituent data.'),
}).passthrough()
export type FMPIndexConstituentsData = z.infer<typeof FMPIndexConstituentsDataSchema>

export class FMPIndexConstituentsFetcher extends Fetcher {
  static override transformQuery(params: Record<string, unknown>): FMPIndexConstituentsQueryParams {
    return FMPIndexConstituentsQueryParamsSchema.parse(params)
  }

  static override async extractData(
    query: FMPIndexConstituentsQueryParams,
    credentials: Record<string, string> | null,
  ): Promise<Record<string, unknown>[]> {
    const apiKey = credentials?.fmp_api_key ?? ''
    const prefix = query.historical ? 'historical-' : ''
    return getDataMany(
      `https://financialmodelingprep.com/stable/${prefix}${query.symbol}-constituent/?apikey=${apiKey}`,
    )
  }

  static override transformData(
    _query: FMPIndexConstituentsQueryParams,
    data: Record<string, unknown>[],
  ): FMPIndexConstituentsData[] {
    return data.map(d => {
      // Clean empty strings
      for (const key of ['removed_symbol', 'removed_name', 'reason', 'removedTicker', 'removedSecurity']) {
        if (d[key] === '' || d[key] === "''" || d[key] === 'None') d[key] = null
      }
      const aliased = applyAliases(d, ALIAS_DICT)
      return FMPIndexConstituentsDataSchema.parse(aliased)
    })
  }
}
