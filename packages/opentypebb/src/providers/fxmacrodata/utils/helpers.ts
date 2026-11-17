/**
 * FXMacroData helpers.
 *
 * The API is keyed by currency rather than country: a series is addressed as
 * (currency, indicator), e.g. USD + inflation. Without a key only USD is
 * served, delayed 15 minutes and limited to the last 90 days; the key is sent
 * in the X-API-Key header, never in the URL.
 */

import { amakeRequest, buildQueryString } from '../../../core/provider/utils/helpers.js'
import { OpenBBError, UnauthorizedError } from '../../../core/provider/utils/errors.js'

export const FXMD_BASE_URL = 'https://api.fxmacrodata.com/v1'

/** Largest page the paginated endpoints accept. */
export const FXMD_PAGE_LIMIT = 100
/** Hard stop for pagination so a bad response cannot loop forever. */
const MAX_PAGES = 50

interface CurrencyInfo {
  country: string
  /** ISO 3166-1 alpha-2 code; null where the currency area is not a single country. */
  iso: string | null
}

export const FXMD_CURRENCIES: Record<string, CurrencyInfo> = {
  AUD: { country: 'Australia', iso: 'AU' },
  BRL: { country: 'Brazil', iso: 'BR' },
  CAD: { country: 'Canada', iso: 'CA' },
  CHF: { country: 'Switzerland', iso: 'CH' },
  CNH: { country: 'China', iso: 'CN' },
  CNY: { country: 'China', iso: 'CN' },
  DKK: { country: 'Denmark', iso: 'DK' },
  EUR: { country: 'Euro Area', iso: null },
  GBP: { country: 'United Kingdom', iso: 'GB' },
  HUF: { country: 'Hungary', iso: 'HU' },
  ILS: { country: 'Israel', iso: 'IL' },
  JPY: { country: 'Japan', iso: 'JP' },
  KRW: { country: 'South Korea', iso: 'KR' },
  MYR: { country: 'Malaysia', iso: 'MY' },
  NGN: { country: 'Nigeria', iso: 'NG' },
  NOK: { country: 'Norway', iso: 'NO' },
  NZD: { country: 'New Zealand', iso: 'NZ' },
  PEN: { country: 'Peru', iso: 'PE' },
  SEK: { country: 'Sweden', iso: 'SE' },
  THB: { country: 'Thailand', iso: 'TH' },
  TWD: { country: 'Taiwan', iso: 'TW' },
  USD: { country: 'United States', iso: 'US' },
}

// country name (snake_case, as OpenBB passes it) → currency. China maps to the
// onshore CNY; CNH is only reachable by its currency code.
const COUNTRY_TO_CURRENCY: Record<string, string> = {
  euro_zone: 'EUR',
  eurozone: 'EUR',
}
for (const [ccy, info] of Object.entries(FXMD_CURRENCIES)) {
  if (ccy === 'CNH') continue
  COUNTRY_TO_CURRENCY[info.country.toLowerCase().replace(/\s+/g, '_')] = ccy
}

/** Resolve a currency code or country name ("united_states", "Japan") to a supported currency. */
export function resolveCurrency(input: string | null | undefined, fallback = 'USD'): string {
  const raw = (input ?? '').trim()
  if (!raw) return fallback
  const upper = raw.toUpperCase()
  if (FXMD_CURRENCIES[upper]) return upper
  const ccy = COUNTRY_TO_CURRENCY[raw.toLowerCase().replace(/[\s-]+/g, '_')]
  if (ccy) return ccy
  throw new OpenBBError(
    `FXMacroData does not cover '${raw}'. Use a currency code (${Object.keys(FXMD_CURRENCIES).join(', ')}) or the matching country name.`,
  )
}

/** Split a comma-separated list and resolve each entry. */
export function resolveCurrencies(input: string | null | undefined, fallback = 'USD'): string[] {
  const parts = (input ?? '').split(',').map(s => s.trim()).filter(Boolean)
  if (parts.length === 0) return [fallback]
  return [...new Set(parts.map(p => resolveCurrency(p, fallback)))]
}

/** Unix seconds → ISO 8601 UTC, or null. */
export function epochToIso(value: unknown): string | null {
  return typeof value === 'number' && Number.isFinite(value)
    ? new Date(value * 1000).toISOString()
    : null
}

export function getApiKey(credentials: Record<string, string> | null): string {
  return (credentials?.fxmacrodata_api_key ?? '').trim()
}

/** GET an API path. 401/403 become an UnauthorizedError carrying the API's own explanation. */
export async function fxmdGet<T>(
  path: string,
  params: Record<string, unknown>,
  apiKey: string,
): Promise<T> {
  const qs = buildQueryString(params)
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (apiKey) headers['X-API-Key'] = apiKey

  return amakeRequest<T>(`${FXMD_BASE_URL}${path}${qs ? `?${qs}` : ''}`, {
    headers,
    responseCallback: async (response) => {
      if (response.status === 401 || response.status === 403) {
        const body = await response.json().catch(() => null) as { detail?: unknown } | null
        const detail = typeof body?.detail === 'string' ? body.detail : `HTTP ${response.status}`
        const hint = apiKey ? '' : ' Set the fxmacrodata key in Settings → Market Data; without one only USD is available.'
        throw new UnauthorizedError(`FXMacroData ${path}: ${detail}${hint}`)
      }
      return response
    },
  })
}

interface PagedResponse {
  data?: Record<string, unknown>[]
  pagination?: { has_more?: boolean }
}

/**
 * Walk an offset-paginated endpoint and return every row plus the first page's
 * envelope (series metadata such as name and unit lives there).
 */
export async function fxmdGetAllPages<T extends PagedResponse>(
  path: string,
  params: Record<string, unknown>,
  apiKey: string,
): Promise<{ first: T | null; rows: Record<string, unknown>[] }> {
  let first: T | null = null
  const rows: Record<string, unknown>[] = []
  for (let page = 0; page < MAX_PAGES; page++) {
    const res = await fxmdGet<T>(path, { ...params, limit: FXMD_PAGE_LIMIT, offset: page * FXMD_PAGE_LIMIT }, apiKey)
    first ??= res
    const data = Array.isArray(res.data) ? res.data : []
    rows.push(...data)
    if (!res.pagination?.has_more || data.length === 0) break
  }
  return { first, rows }
}
