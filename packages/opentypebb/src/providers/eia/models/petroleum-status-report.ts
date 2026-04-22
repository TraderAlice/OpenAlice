/**
 * EIA Petroleum Status Report Fetcher.
 * Uses EIA Open Data API v2.
 * API docs: https://www.eia.gov/opendata/
 */

import { z } from 'zod'
import { Fetcher } from '../../../core/provider/abstract/fetcher.js'
import { PetroleumStatusReportQueryParamsSchema, PetroleumStatusReportDataSchema } from '../../../standard-models/petroleum-status-report.js'
import { EmptyDataError } from '../../../core/provider/utils/errors.js'
import { amakeRequest } from '../../../core/provider/utils/helpers.js'

export const EIAPetroleumStatusReportQueryParamsSchema = PetroleumStatusReportQueryParamsSchema
export type EIAPetroleumStatusReportQueryParams = z.infer<typeof EIAPetroleumStatusReportQueryParamsSchema>

const EIA_API_URL = 'https://api.eia.gov/v2/petroleum/sum/sndw/data/'

// Map categories to EIA series IDs
const CATEGORY_SERIES: Record<string, { series: string; unit: string }> = {
  crude_oil_production: { series: 'WCRFPUS2', unit: 'Thousand Barrels per Day' },
  crude_oil_stocks: { series: 'WCESTUS1', unit: 'Thousand Barrels' },
  gasoline_stocks: { series: 'WGTSTUS1', unit: 'Thousand Barrels' },
  distillate_stocks: { series: 'WDISTUS1', unit: 'Thousand Barrels' },
  refinery_utilization: { series: 'WPULEUS3', unit: 'Percent' },
}

interface EiaResponse {
  response?: {
    data?: Array<{
      period: string
      value: number | null
      'series-description'?: string
    }>
  }
}

export class EIAPetroleumStatusReportFetcher extends Fetcher {
  static override transformQuery(params: Record<string, unknown>): EIAPetroleumStatusReportQueryParams {
    return EIAPetroleumStatusReportQueryParamsSchema.parse(params)
  }

  static override async extractData(
    query: EIAPetroleumStatusReportQueryParams,
    credentials: Record<string, string> | null,
  ): Promise<Record<string, unknown>[]> {
    const apiKey = credentials?.eia_api_key ?? credentials?.api_key ?? ''
    const catInfo = CATEGORY_SERIES[query.category]
    if (!catInfo) throw new EmptyDataError(`Unknown category: ${query.category}`)

    const params = new URLSearchParams({
      api_key: apiKey,
      frequency: 'weekly',
      'data[0]': 'value',
      'facets[series][]': catInfo.series,
      sort: 'period',
      'sort[0][column]': 'period',
      'sort[0][direction]': 'desc',
      length: '260', // ~5 years of weekly data
    })

    if (query.start_date) params.set('start', query.start_date)
    if (query.end_date) params.set('end', query.end_date)

    const url = `${EIA_API_URL}?${params.toString()}`
    const data = await amakeRequest<EiaResponse>(url)

    const results: Record<string, unknown>[] = []
    for (const obs of data.response?.data ?? []) {
      if (obs.value == null) continue
      results.push({
        date: obs.period,
        value: typeof obs.value === 'number' ? obs.value : parseFloat(String(obs.value)),
        category: query.category,
        unit: catInfo.unit,
      })
    }

    if (results.length === 0) throw new EmptyDataError('No EIA petroleum data found.')
    return results
  }

  static override transformData(
    _query: EIAPetroleumStatusReportQueryParams,
    data: Record<string, unknown>[],
  ) {
    return data
      .sort((a, b) => String(a.date).localeCompare(String(b.date)))
      .map(d => PetroleumStatusReportDataSchema.parse(d))
  }
}
