import { tool } from 'ai'
import { z } from 'zod'
import { DEFAULT_HUB_URL, type HubConfig } from '../domain/market-data/reference/hub.js'
import { isUTADisabled, resolveUTAUrl } from '../services/uta-supervisor/url.js'

export type NetworkCheckService = 'uta' | 'yfinance' | 'traderhub'
export type NetworkCheckState = 'ok' | 'unconfigured' | 'unreachable' | 'timeout' | 'http_error'

export interface NetworkCheckItem {
  service: NetworkCheckService
  host: string
  ok: boolean
  state: NetworkCheckState
  optional?: boolean
  status?: number
  latencyMs: number
  error?: string
}

export interface NetworkCheckResult {
  ok: boolean
  checks: NetworkCheckItem[]
}

export interface NetworkCheckOptions {
  /** UTA base URL (or getter). Pass null/empty or set utaDisabled when UTA is not configured/enabled. */
  utaUrl?: string | null | (() => string | null | undefined)
  /** Explicit lite/disabled flag for UTA (defaults to env isUTADisabled()). */
  utaDisabled?: boolean | (() => boolean)
  /** TraderHub config (defaults to enabled DEFAULT_HUB_URL). */
  hub?: HubConfig | (() => HubConfig | undefined)
  /** Yahoo Finance probe URL (defaults to https://finance.yahoo.com/robots.txt). */
  yahooUrl?: string
  /** Per-probe timeout in milliseconds (default 5000). */
  timeoutMs?: number
  /** Injectable fetch implementation for deterministic unit tests. */
  fetchImpl?: typeof globalThis.fetch
  /** Injectable clock for deterministic latency measurement in tests. */
  now?: () => number
}

const DEFAULT_TIMEOUT_MS = 5_000
const DEFAULT_YAHOO_PROBE_URL = 'https://finance.yahoo.com/robots.txt'

function safeHost(rawUrl: string): string {
  try {
    return new URL(rawUrl).host
  } catch {
    return rawUrl
  }
}

function describeTransportError(err: unknown): string {
  if (!(err instanceof Error)) return String(err)
  const parts: string[] = []
  const code = (err as Error & { code?: unknown }).code
  if (typeof code === 'string' && code && !err.message.includes(code)) {
    parts.push(code)
  }
  if (err.message) parts.push(err.message)
  const cause = (err as Error & { cause?: unknown }).cause
  if (cause instanceof Error) {
    const causeCode = (cause as Error & { code?: unknown }).code
    const causeParts = [
      typeof causeCode === 'string' && causeCode && !cause.message.includes(causeCode) ? causeCode : '',
      cause.message,
    ].filter(Boolean)
    if (causeParts.length > 0) parts.push(`cause: ${causeParts.join(': ')}`)
  }
  return parts.join(': ') || err.name
}

function isTimeoutError(err: unknown, aborted: boolean): boolean {
  return aborted || (err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError'))
}

async function probeEndpoint(params: {
  service: NetworkCheckService
  url: string
  optional?: boolean
  timeoutMs: number
  fetchImpl: typeof globalThis.fetch
  now: () => number
  headers?: Record<string, string>
}): Promise<NetworkCheckItem> {
  const { service, url, optional, timeoutMs, fetchImpl, now, headers } = params
  const host = safeHost(url)
  const started = now()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const res = await fetchImpl(url, {
      method: 'GET',
      headers,
      signal: controller.signal,
    })
    const latencyMs = Math.max(0, Math.round(now() - started))
    // Avoid leaking response streams/sockets across probes.
    void res.body?.cancel?.().catch(() => {})
    if (res.ok) {
      return {
        service,
        host,
        ok: true,
        state: 'ok',
        ...(optional ? { optional: true } : {}),
        status: res.status,
        latencyMs,
      }
    }
    return {
      service,
      host,
      ok: false,
      state: 'http_error',
      ...(optional ? { optional: true } : {}),
      status: res.status,
      latencyMs,
      error: `${host} returned HTTP ${res.status}`,
    }
  } catch (err) {
    const latencyMs = Math.max(0, Math.round(now() - started))
    if (isTimeoutError(err, controller.signal.aborted)) {
      return {
        service,
        host,
        ok: false,
        state: 'timeout',
        ...(optional ? { optional: true } : {}),
        latencyMs,
        error: `timed out after ${timeoutMs}ms reaching ${host}`,
      }
    }
    return {
      service,
      host,
      ok: false,
      state: 'unreachable',
      ...(optional ? { optional: true } : {}),
      latencyMs,
      error: `unreachable (${host}): ${describeTransportError(err)}`,
    }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Concurrently probe connectivity to UTA, Yahoo Finance, and TraderHub.
 * Never throws on unreachable or unconfigured services; reports each host's
 * status, latency, and attributed error clearly.
 */
export async function runNetworkChecks(opts: NetworkCheckOptions = {}): Promise<NetworkCheckResult> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch
  const now = opts.now ?? Date.now

  const resolvedUtaDisabled = typeof opts.utaDisabled === 'function'
    ? opts.utaDisabled()
    : (opts.utaDisabled ?? (opts.utaUrl === undefined ? isUTADisabled() : false))
  const rawUtaUrl = typeof opts.utaUrl === 'function'
    ? opts.utaUrl()
    : (opts.utaUrl === undefined ? resolveUTAUrl() : opts.utaUrl)
  const utaBase = typeof rawUtaUrl === 'string' ? rawUtaUrl.trim().replace(/\/+$/, '') : ''

  const resolvedHub = typeof opts.hub === 'function'
    ? opts.hub()
    : (opts.hub ?? { enabled: true, baseUrl: DEFAULT_HUB_URL })
  const hubBase = resolvedHub?.baseUrl?.trim().replace(/\/+$/, '') ?? ''

  const yahooUrl = opts.yahooUrl ?? DEFAULT_YAHOO_PROBE_URL

  const utaCheck: Promise<NetworkCheckItem> = resolvedUtaDisabled || !utaBase
    ? Promise.resolve({
        service: 'uta',
        host: utaBase ? safeHost(utaBase) : 'unconfigured',
        ok: false,
        state: 'unconfigured',
        optional: true,
        latencyMs: 0,
        error: resolvedUtaDisabled
          ? 'unconfigured (UTA disabled in lite mode)'
          : 'unconfigured (UTA URL is not set)',
      })
    : probeEndpoint({
        service: 'uta',
        url: `${utaBase}/__uta/health`,
        optional: true,
        timeoutMs,
        fetchImpl,
        now,
        headers: { Accept: 'application/json' },
      })

  const yahooCheck = probeEndpoint({
    service: 'yfinance',
    url: yahooUrl,
    timeoutMs,
    fetchImpl,
    now,
  })

  const hubCheck: Promise<NetworkCheckItem> = !resolvedHub?.enabled || !hubBase
    ? Promise.resolve({
        service: 'traderhub',
        host: hubBase ? safeHost(hubBase) : 'unconfigured',
        ok: false,
        state: 'unconfigured',
        optional: true,
        latencyMs: 0,
        error: 'unconfigured (TraderHub is disabled)',
      })
    : probeEndpoint({
        service: 'traderhub',
        url: `${hubBase}/api/reference/macro`,
        timeoutMs,
        fetchImpl,
        now,
        headers: { Accept: 'application/json' },
      })

  const checks = await Promise.all([utaCheck, yahooCheck, hubCheck])
  // Unconfigured optional services (e.g. UTA in lite mode) do not fail overall health.
  const ok = checks.every((c) => c.ok || c.state === 'unconfigured')
  return { ok, checks }
}

export function createNetworkCheckTools(opts: NetworkCheckOptions = {}) {
  return {
    network_check: tool({
      description: 'Probe network connectivity to UTA (optional), Yahoo Finance (finance.yahoo.com), and TraderHub concurrently, returning per-host status, latency, and attributed errors.',
      inputSchema: z.object({
        timeoutMs: z.number().int().min(500).max(30_000).optional().describe('Per-service probe timeout in milliseconds (default 5000)'),
      }),
      execute: async ({ timeoutMs }) =>
        runNetworkChecks({
          ...opts,
          ...(timeoutMs !== undefined ? { timeoutMs } : {}),
        }),
    }),
  }
}
