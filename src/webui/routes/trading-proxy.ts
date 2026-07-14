/**
 * BFF proxy for `/api/trading/*` — Alice → UTA.
 *
 * UI talks to Alice on a single origin (decision #2 of UTA-split v1); this
 * route forwards every trading request unchanged to the UTA service. v1
 * has no auth between the two — UTA is bound to 127.0.0.1 only, so the
 * trust boundary is the host, not the request.
 *
 * Stream-friendly: forwards request body, returns UTA's Response as-is so
 * `Content-Type` / chunked transfer / SSE headers pass through. A short
 * connect timeout (1s) fails fast when UTA is down, so the agent loop
 * doesn't hang on a dead backend.
 */

import { Hono } from 'hono'
import { probeOptionalCarrier } from '../../services/optional-carrier/health.js'
import { describeTradingMode, type TradingModePolicy } from '../../services/trading-mode.js'
import { decodeUTAHealth } from '../../services/uta-supervisor/health.js'

// Total request timeout. UTA is on the loopback interface so connect is
// instant — this guards against handlers that legitimately take seconds
// (broker queries, contract searches) hanging Alice forever. 30s is
// well above the typical broker-API SLA without being a footgun.
const PROXY_TIMEOUT_MS = 30_000
const STATUS_TIMEOUT_MS = 1_000

/** Methods Hono's `app.all` actually dispatches. Empty body methods get a
 *  null body forwarded. */
const PASSTHROUGH_HEADERS: readonly string[] = [
  // Forward common identifying headers; strip hop-by-hop / Host so the UTA
  // sees its own host.
  'accept', 'accept-language', 'content-type', 'content-length',
  'user-agent', 'cache-control', 'pragma', 'x-request-id',
]

export function createTradingProxyRoutes(opts: {
  utaBaseUrl?: string
  disabledReason?: 'lite_mode'
  getPolicy?: () => TradingModePolicy
}): Hono {
  const app = new Hono()
  const base = opts.utaBaseUrl?.replace(/\/$/, '')
  const disabledReason = opts.disabledReason
  const getPolicy = opts.getPolicy ?? (() => ({
    mode: disabledReason === 'lite_mode' ? 'lite' : 'pro',
    source: disabledReason === 'lite_mode' ? 'env' : 'auto',
    envLocked: disabledReason === 'lite_mode',
    hasUTAConfig: false,
  }))

  app.get('/status', async (c) => {
    const policy = getPolicy()
    if (policy.mode === 'lite') {
      return c.json({
        available: false,
        state: 'unavailable',
        reason: 'lite_mode',
        mode: policy.mode,
        modeSource: policy.source,
        envLocked: policy.envLocked,
        hasUTAConfig: policy.hasUTAConfig,
        hint: describeTradingMode('lite'),
      })
    }
    if (!base) {
      return c.json({
        available: false,
        state: 'unavailable',
        reason: 'not_configured',
        mode: policy.mode,
        modeSource: policy.source,
        envLocked: policy.envLocked,
        hasUTAConfig: policy.hasUTAConfig,
        hint: 'Trading service is not configured.',
      })
    }

    const probe = await probeOptionalCarrier({
      id: 'uta',
      enabled: true,
      baseUrl: base,
      healthPath: '/__uta/health',
      timeoutMs: STATUS_TIMEOUT_MS,
      decode: decodeUTAHealth,
    })
    if (probe.phase === 'healthy') {
      const health = probe.body!
      return c.json({
        available: true,
        state: 'available',
        mode: policy.mode,
        modeSource: policy.source,
        envLocked: policy.envLocked,
        hasUTAConfig: policy.hasUTAConfig,
        hint: describeTradingMode(policy.mode),
        startedAt: health.startedAt,
        utas: health.utas,
      })
    }
    return c.json({
      available: false,
      state: 'unavailable',
      reason: probe.reason,
      detail: probe.detail,
      mode: policy.mode,
      modeSource: policy.source,
      envLocked: policy.envLocked,
      hasUTAConfig: policy.hasUTAConfig,
      hint: probe.reason === 'http_error' || probe.reason === 'invalid_response'
        ? 'Trading service is not healthy.'
        : 'Trading service is not reachable.',
    })
  })

  app.all('*', async (c) => {
    const policy = getPolicy()
    if (policy.mode === 'lite') {
      return c.json({
        error: 'UTA disabled',
        detail: 'Trading mode is lite',
        hint: describeTradingMode('lite'),
      }, 503)
    }
    if (policy.mode === 'readonly' && isVenueMutation(c.req.method, c.req.path)) {
      return c.json({
        error: 'Trading mode is readonly',
        detail: 'Venue-mutating broker writes are disabled in readonly mode',
        hint: describeTradingMode('readonly'),
      }, 403)
    }
    if (!base) {
      return c.json({
        error: 'UTA unavailable',
        detail: 'UTA URL is not configured',
        hint: 'Trading service is not reachable. Alice is running in lite mode.',
      }, 503)
    }
    const incoming = c.req.raw
    // Reconstruct target URL: Hono's `c.req.path` is the *full* path
    // including the mount prefix (`/api/trading/uta`, not `/uta`), so
    // we forward it as-is.
    const target = `${base}${c.req.path}${url(incoming).search}`

    const forwardHeaders = new Headers()
    for (const name of PASSTHROUGH_HEADERS) {
      const v = incoming.headers.get(name)
      if (v !== null) forwardHeaders.set(name, v)
    }

    const controller = new AbortController()
    const connectTimer = setTimeout(() => controller.abort(), PROXY_TIMEOUT_MS)

    let upstream: Response
    try {
      upstream = await fetch(target, {
        method: incoming.method,
        headers: forwardHeaders,
        body: hasBody(incoming.method) ? incoming.body : null,
        // duplex required when streaming request body — Node fetch needs it
        // when body is a ReadableStream.
        ...(hasBody(incoming.method) ? { duplex: 'half' } : {}),
        signal: controller.signal,
        redirect: 'manual',
      } as RequestInit)
    } catch (err) {
      clearTimeout(connectTimer)
      const msg = err instanceof Error ? err.message : String(err)
      return c.json({
        error: 'UTA unavailable',
        detail: msg,
        hint: 'Trading service is not reachable. Alice is running in lite mode.',
      }, 502)
    } finally {
      clearTimeout(connectTimer)
    }

    // Re-wrap with a fresh Headers object so downstream middleware (CORS,
    // etc.) can still mutate them. `fetch()` returns a Response whose
    // headers carry an immutable guard per the WHATWG spec — handing it
    // back as-is makes any later `headers.set(...)` throw.
    const headers = new Headers()
    upstream.headers.forEach((value, name) => { headers.set(name, value) })
    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers,
    })
  })

  return app
}

function isVenueMutation(method: string, path: string): boolean {
  const m = method.toUpperCase()
  if (m === 'GET' || m === 'HEAD') return false
  const normalized = path.toLowerCase()
  return (
    normalized.includes('/wallet/push') ||
    normalized.includes('/wallet/place-order') ||
    normalized.includes('/wallet/close-position') ||
    normalized.includes('/wallet/cancel-order') ||
    normalized.includes('/simulate-price') ||
    normalized.startsWith('/api/simulator') ||
    normalized.startsWith('/simulator')
  )
}

function url(req: Request): URL {
  try { return new URL(req.url) } catch { return new URL('http://localhost/') }
}

function hasBody(method: string): boolean {
  const m = method.toUpperCase()
  return m !== 'GET' && m !== 'HEAD'
}
