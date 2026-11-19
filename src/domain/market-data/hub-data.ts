/**
 * Hub-first wrappers at the client-method seam.
 *
 * Client methods ARE the endpoint catalog: wrapping here means tools, the
 * CLI, and the reference boards all inherit hub coverage with zero changes.
 *
 * v1 covers the FMP calendars (parameterized windows; the boards only
 * cache the default window). FRED/EIA/BLS ride the credential sentinel
 * instead (see credential-map.ts) — their fetchers swap origins, which
 * covers every method of those families at once.
 */

import type { EquityClientLike } from './client/types.js'
import type { HubConfig } from './reference/hub.js'

const CALENDAR_DATASETS: Record<string, string> = {
  getCalendarEarnings: 'earnings-calendar',
  getCalendarIpo: 'ipos-calendar',
  getCalendarDividend: 'dividends-calendar',
}

/** Params the hub dataset understands — anything else bypasses the hub. */
const KNOWN_PARAMS = new Set(['provider', 'start_date', 'end_date'])

const TIMEOUT_MS = 5_000
const BREAKER_MS = 60_000

function safeHost(rawUrl: string): string {
  try {
    return new URL(rawUrl).host
  } catch {
    return rawUrl
  }
}

function describeError(err: unknown): string {
  if (!(err instanceof Error)) return String(err)
  const code = (err as Error & { code?: unknown }).code
  const base = err.message || err.name
  return typeof code === 'string' && code && !base.includes(code) ? `${code}: ${base}` : base
}

export function withHubCalendars(client: EquityClientLike, hub: HubConfig | undefined): EquityClientLike {
  if (!hub?.enabled || !hub.baseUrl) return client
  const base = hub.baseUrl.replace(/\/+$/, '')
  const host = safeHost(base)
  let downUntil = 0

  const wrap = (method: keyof EquityClientLike, dataset: string) =>
    async (params?: Record<string, unknown>): Promise<unknown[]> => {
      const local = () => (client[method] as (p?: Record<string, unknown>) => Promise<unknown[]>)(params)
      const p = params ?? {}
      const from = p.start_date
      const to = p.end_date
      const hasUnknownParams = Object.keys(p).some((k) => !KNOWN_PARAMS.has(k))
      if (hasUnknownParams || typeof from !== 'string' || typeof to !== 'string' || Date.now() < downUntil) {
        return local()
      }
      try {
        const res = await fetch(`${base}/api/data/${dataset}?from=${from}&to=${to}`, {
          signal: AbortSignal.timeout(TIMEOUT_MS),
          headers: { Accept: 'application/json' },
        })
        if (!res.ok) throw new Error(`hub (${host}) returned ${res.status}`)
        const rows: unknown = await res.json()
        if (!Array.isArray(rows)) throw new Error(`hub (${host}) returned a non-array shape`)
        return rows
      } catch (err) {
        downUntil = Date.now() + BREAKER_MS
        console.warn(`[hub-data] ${host} (${dataset}) failed: ${describeError(err)}; falling back to local`)
        return local()
      }
    }

  return new Proxy(client, {
    get(target, prop, receiver) {
      if (typeof prop === 'string' && prop in CALENDAR_DATASETS) {
        return wrap(prop as keyof EquityClientLike, CALENDAR_DATASETS[prop])
      }
      // Bind to the target, not the proxy — class internals (private
      // fields) must see their real `this`.
      const value = Reflect.get(target, prop, target)
      return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(target) : value
    },
  })
}
