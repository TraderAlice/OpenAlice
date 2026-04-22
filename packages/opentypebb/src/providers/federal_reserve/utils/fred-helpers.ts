/**
 * FRED API shared helpers.
 *
 * Provides reusable functions for fetching data from the
 * Federal Reserve Economic Data (FRED) API.
 */

import { amakeRequest } from '../../../core/provider/utils/helpers.js'
import { EmptyDataError } from '../../../core/provider/utils/errors.js'

const FRED_BASE = 'https://api.stlouisfed.org/fred'

export interface FredObservation {
  date: string
  value: string
}

export interface FredSeriesInfo {
  id: string
  title: string
  frequency_short: string
  units_short: string
  seasonal_adjustment_short: string
  last_updated: string
  notes: string
}

/**
 * Build a FRED API URL with common parameters.
 */
function buildFredUrl(
  endpoint: string,
  params: Record<string, string | number | undefined>,
  apiKey: string,
): string {
  const url = new URL(`${FRED_BASE}/${endpoint}`)
  url.searchParams.set('file_type', 'json')
  if (apiKey) url.searchParams.set('api_key', apiKey)
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') {
      url.searchParams.set(k, String(v))
    }
  }
  return url.toString()
}

/**
 * Fetch observations for a single FRED series.
 */
export async function fetchFredSeries(
  seriesId: string,
  apiKey: string,
  opts: {
    startDate?: string | null
    endDate?: string | null
    limit?: number
    sortOrder?: 'asc' | 'desc'
    frequency?: string
    units?: string
  } = {},
): Promise<FredObservation[]> {
  const url = buildFredUrl('series/observations', {
    series_id: seriesId,
    observation_start: opts.startDate ?? undefined,
    observation_end: opts.endDate ?? undefined,
    limit: opts.limit,
    sort_order: opts.sortOrder ?? 'asc',
    frequency: opts.frequency,
    units: opts.units,
  }, apiKey)

  const data = await amakeRequest<{ observations?: FredObservation[] }>(url)
  return (data.observations ?? []).filter(o => o.value !== '.')
}

/**
 * Fetch multiple FRED series and merge by date.
 * Returns records keyed by date, with each series as a field.
 */
export async function fetchFredMultiSeries(
  seriesIds: string[],
  apiKey: string,
  opts: {
    startDate?: string | null
    endDate?: string | null
    limit?: number
    frequency?: string
  } = {},
): Promise<Record<string, Record<string, number | null>>> {
  const dataMap: Record<string, Record<string, number | null>> = {}

  for (const seriesId of seriesIds) {
    try {
      const observations = await fetchFredSeries(seriesId, apiKey, {
        startDate: opts.startDate,
        endDate: opts.endDate,
        limit: opts.limit,
        frequency: opts.frequency,
      })
      for (const obs of observations) {
        const val = parseFloat(obs.value)
        if (!dataMap[obs.date]) dataMap[obs.date] = {}
        dataMap[obs.date][seriesId] = isNaN(val) ? null : val
      }
    } catch {
      // Skip series that fail
    }
  }

  return dataMap
}

/**
 * Search FRED series by keyword.
 */
export async function fredSearchApi(
  query: string,
  apiKey: string,
  opts: { limit?: number; offset?: number } = {},
): Promise<FredSeriesInfo[]> {
  const url = buildFredUrl('series/search', {
    search_text: query,
    limit: opts.limit ?? 100,
    offset: opts.offset ?? 0,
  }, apiKey)

  const data = await amakeRequest<{ seriess?: FredSeriesInfo[] }>(url)
  return data.seriess ?? []
}

/**
 * Fetch a FRED release table.
 */
export async function fredReleaseTableApi(
  releaseId: string,
  apiKey: string,
  opts: { elementId?: number; date?: string } = {},
): Promise<Record<string, unknown>[]> {
  const url = buildFredUrl('release/tables', {
    release_id: releaseId,
    element_id: opts.elementId,
    include_observation_values: 'true',
    observation_date: opts.date,
  }, apiKey)

  const data = await amakeRequest<{ elements?: Record<string, unknown> }>(url)
  if (!data.elements) return []

  return Object.values(data.elements).map(el => el as Record<string, unknown>)
}

/**
 * Fetch FRED regional/GeoFRED data.
 */
export async function fredRegionalApi(
  seriesGroup: string,
  apiKey: string,
  opts: {
    regionType?: string
    date?: string
    startDate?: string
    seasonalAdjustment?: string
    units?: string
    frequency?: string
    transformationCode?: string
  } = {},
): Promise<Record<string, unknown>[]> {
  const url = buildFredUrl('geofred/series/data', {
    series_group: seriesGroup,
    region_type: opts.regionType ?? 'state',
    date: opts.date,
    start_date: opts.startDate,
    season: opts.seasonalAdjustment ?? 'SA',
    units: opts.units,
    frequency: opts.frequency,
    transformation: opts.transformationCode,
  }, apiKey)

  const data = await amakeRequest<{ meta?: Record<string, unknown>; data?: Record<string, unknown> }>(url)
  if (!data.data) return []

  // GeoFRED returns { data: { "2024-01-01": [{ region: ..., value: ... }, ...] } }
  const results: Record<string, unknown>[] = []
  for (const [date, regions] of Object.entries(data.data)) {
    if (Array.isArray(regions)) {
      for (const region of regions) {
        results.push({ date, ...(region as Record<string, unknown>) })
      }
    }
  }
  return results
}

/**
 * Convert a FRED multi-series result to an array of flat records.
 */
export function multiSeriesToRecords(
  dataMap: Record<string, Record<string, number | null>>,
  fieldMap?: Record<string, string>,
): Record<string, unknown>[] {
  return Object.entries(dataMap)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, values]) => {
      const record: Record<string, unknown> = { date }
      if (fieldMap) {
        for (const [seriesId, fieldName] of Object.entries(fieldMap)) {
          record[fieldName] = values[seriesId] ?? null
        }
      } else {
        Object.assign(record, values)
      }
      return record
    })
}

/**
 * Get credentials helper — extracts FRED API key.
 */
export function getFredApiKey(credentials: Record<string, string> | null): string {
  return credentials?.fred_api_key ?? credentials?.api_key ?? credentials?.federal_reserve_api_key ?? ''
}
