/**
 * HTTP helpers and utility functions.
 * Maps to: openbb_core/provider/utils/helpers.py
 */

import { OpenBBError, NetworkUnreachableError } from './errors.js'

/**
 * Identify a fetch failure before an HTTP response was received. This
 * includes network failures and connections closed by the remote service.
 *
 * Node 18+ wraps low-level network errors in TypeError("fetch failed")
 * with the underlying cause attached as `.cause`. Common cause codes
 * we want to flag specifically: ENOTFOUND (DNS), ECONNREFUSED, ETIMEDOUT,
 * EHOSTUNREACH, ENETUNREACH, EAI_AGAIN, plus TLS handshake failures
 * (UNABLE_TO_VERIFY_LEAF_SIGNATURE, SELF_SIGNED_CERT_IN_CHAIN, etc.).
 */
function isFetchNetworkFailure(error: unknown): boolean {
  if (!(error instanceof TypeError)) return false
  if (!/fetch failed/i.test(error.message)) return false
  return true
}

function describeFetchCause(error: unknown): string {
  if (!(error instanceof Error)) return String(error)
  const cause = (error as Error & { cause?: unknown }).cause
  if (cause instanceof Error) {
    const code = (cause as Error & { code?: string }).code
    return code ? `${code}: ${cause.message}` : cause.message
  }
  return error.message
}

/** Query-param names that carry secrets and must not appear in error logs. */
const SECRET_QUERY_KEYS = new Set([
  'apikey', 'api_key', 'api-key',
  'token', 'access_token', 'accesstoken',
  'key', 'secret', 'password',
])

/**
 * Return `url` with any secret-bearing query-string values replaced by `***`.
 * Used before embedding URLs into error messages / logs so credentials never leak.
 * Falls back to the original string if parsing fails.
 */
function redactUrl(url: string): string {
  try {
    const u = new URL(url)
    for (const [k] of u.searchParams) {
      if (SECRET_QUERY_KEYS.has(k.toLowerCase())) {
        u.searchParams.set(k, '***')
      }
    }
    return u.toString()
  } catch {
    return url
  }
}

/** Extract a short description from a caught value, for chaining into error text. */
function describeCause(err: unknown): string {
  if (err instanceof Error) {
    const parts = [err.name !== 'Error' ? err.name : '', err.message].filter(Boolean)
    return parts.join(': ')
  }
  if (typeof err === 'string') return err
  try { return JSON.stringify(err) } catch { return String(err) }
}

/**
 * Make an async HTTP request and return the parsed JSON response.
 * Maps to: amake_request() in helpers.py
 *
 * @param url - The URL to request.
 * @param options - Optional fetch options.
 * @param responseCallback - Optional callback to process the response before parsing.
 * @param timeoutMs - Request timeout in milliseconds (default: 30000).
 * @returns Parsed JSON response.
 */
export async function amakeRequest<T = unknown>(
  url: string,
  options: {
    method?: string
    headers?: Record<string, string>
    body?: string
    timeoutMs?: number
    responseCallback?: (response: Response) => Promise<Response>
  } = {},
): Promise<T> {
  const { method = 'GET', headers, body, timeoutMs = 30_000, responseCallback } = options
  const safeUrl = redactUrl(url)

  let response: Response
  try {
    response = await fetch(url, {
      method,
      headers,
      body,
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'TimeoutError') {
      throw new OpenBBError(`Request timed out after ${timeoutMs}ms: ${safeUrl}`)
    }
    if (isFetchNetworkFailure(error)) {
      const host = (() => { try { return new URL(url).host } catch { return safeUrl } })()
      throw new NetworkUnreachableError(host, describeFetchCause(error), error)
    }
    throw new OpenBBError(`Request failed (${describeCause(error)}): ${safeUrl}`, error)
  }

  if (responseCallback) {
    response = await responseCallback(response)
  }

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new OpenBBError(
      `HTTP ${response.status} ${response.statusText}: ${safeUrl}${text ? ` - ${text}` : ''}`,
    )
  }

  try {
    return (await response.json()) as T
  } catch (error) {
    throw new OpenBBError(`Failed to parse JSON response (${describeCause(error)}): ${safeUrl}`, error)
  }
}

/**
 * Apply alias dictionary to a data record.
 * Maps to: Data.__alias_dict__ + _use_alias model_validator in data.py
 *
 * The alias dict maps {targetFieldName: sourceFieldName}.
 * This renames source keys to target keys in the data.
 *
 * @param data - The raw data object.
 * @param aliasDict - Mapping of {targetName: sourceName}.
 * @returns Data with renamed keys.
 */
export function applyAliases(
  data: Record<string, unknown>,
  aliasDict: Record<string, string>,
): Record<string, unknown> {
  if (!aliasDict || Object.keys(aliasDict).length === 0) return data

  const result: Record<string, unknown> = { ...data }

  // aliasDict maps {newName: originalName}
  for (const [newName, originalName] of Object.entries(aliasDict)) {
    if (originalName in result) {
      result[newName] = result[originalName]
      if (newName !== originalName) {
        delete result[originalName]
      }
    }
  }

  return result
}

/**
 * Replace empty strings and "NA" with null in a data record.
 * Common pattern in FMP/YFinance providers.
 */
export function replaceEmptyStrings(
  data: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(data)) {
    result[key] = value === '' || value === 'NA' ? null : value
  }
  return result
}

/**
 * Make an HTTP GET request using Node's native https module.
 * Bypasses the undici global dispatcher (and its proxy agent).
 * Useful for APIs that are incompatible with HTTP proxy tunneling
 * (e.g. OECD SDMX, ECB, IMF) but are accessible via OS network stack (TUN).
 */
export async function nativeFetch(
  url: string,
  options: { headers?: Record<string, string>; timeoutMs?: number } = {},
): Promise<{ status: number; text: string }> {
  const { headers, timeoutMs = 30_000 } = options
  const mod = url.startsWith('https') ? await import('https') : await import('http')

  return new Promise((resolve, reject) => {
    const req = mod.get(url, { headers, timeout: timeoutMs }, (res) => {
      let body = ''
      res.on('data', (chunk: Buffer) => { body += chunk.toString() })
      res.on('end', () => resolve({ status: res.statusCode ?? 0, text: body }))
    })
    req.on('error', reject)
    req.on('timeout', () => { req.destroy(); reject(new OpenBBError(`Request timed out: ${url}`)) })
  })
}

/**
 * Build a query string from params, omitting null/undefined values.
 */
export function buildQueryString(params: Record<string, unknown>): string {
  const searchParams = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value !== null && value !== undefined) {
      searchParams.set(key, String(value))
    }
  }
  return searchParams.toString()
}
