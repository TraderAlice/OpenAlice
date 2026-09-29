/**
 * Bridge process outbound-proxy env vars onto the Alpaca SDK's axios client.
 *
 * `@alpacahq/alpaca-trade-api` calls bare `axios(req)`. Axios 0.21 auto-reads
 * HTTP(S)_PROXY and, with common local mixed-port proxies (v2rayN/xray on
 * 10808), produces `400 The plain HTTP request was sent to HTTPS port`.
 *
 * Mirror the CCXT pattern (issue #384): when a proxy is configured, attach an
 * explicit `HttpsProxyAgent` and set `proxy: false` so axios stops its broken
 * env auto-config. When no proxy env is set, leave agents cleared and keep
 * `proxy: false` so a stale global default cannot re-enable the bad path.
 * No-op-stable across repeated init()/reconnect() for the same env snapshot.
 */

import { createRequire } from 'node:module'
import { HttpsProxyAgent } from 'https-proxy-agent'

export type EnvLike = Readonly<Record<string, string | undefined>>

export type AlpacaAxiosProxyMode = 'direct' | 'http-proxy' | 'socks-unbridged'

export interface AlpacaAxiosProxyApplication {
  mode: AlpacaAxiosProxyMode
  /** Redacted for logs — never includes userinfo. */
  proxyUrl?: string
}

type AxiosDefaultsMutable = {
  proxy?: false | object
  httpAgent?: unknown
  httpsAgent?: unknown
}

type AlpacaAxiosModule = {
  defaults: AxiosDefaultsMutable
}

/** Last applied raw proxy env string (empty string = explicit direct). */
let appliedRaw: string | undefined

/**
 * Resolve one outbound proxy URL with the same precedence as CcxtBroker:
 * HTTPS_PROXY > HTTP_PROXY > ALL_PROXY (case-insensitive).
 */
export function resolveAlpacaOutboundProxyRaw(env: EnvLike = process.env): string | undefined {
  const proxy = env['HTTPS_PROXY'] || env['https_proxy']
    || env['HTTP_PROXY'] || env['http_proxy']
    || env['ALL_PROXY'] || env['all_proxy']
  const trimmed = proxy?.trim()
  return trimmed || undefined
}

/** True when the URL is an HTTP(S) forward proxy we can bridge with HttpsProxyAgent. */
export function isHttpForwardProxyUrl(raw: string): boolean {
  try {
    const protocol = new URL(raw).protocol
    return protocol === 'http:' || protocol === 'https:'
  } catch {
    return false
  }
}

/** Strip credentials from a proxy URL for diagnostics. */
export function redactProxyUrl(raw: string): string {
  try {
    return raw.replace(/\/\/[^@/]*@/, '//***@')
  } catch {
    return '<proxy>'
  }
}

function loadAlpacaAxios(): AlpacaAxiosModule {
  const require = createRequire(import.meta.url)
  const alpacaEntry = require.resolve('@alpacahq/alpaca-trade-api')
  return require(require.resolve('axios', { paths: [alpacaEntry] })) as AlpacaAxiosModule
}

/**
 * Patch the axios module instance used by `@alpacahq/alpaca-trade-api`.
 * Idempotent for the same env snapshot; re-applies when the proxy env changes
 * (e.g. Guardian child restart with a different system proxy).
 */
export function applyAlpacaAxiosEnvProxy(env: EnvLike = process.env): AlpacaAxiosProxyApplication {
  const raw = resolveAlpacaOutboundProxyRaw(env) ?? ''
  if (appliedRaw === raw) {
    if (!raw) return { mode: 'direct' }
    if (/^socks/i.test(raw) || !isHttpForwardProxyUrl(raw)) {
      return { mode: 'socks-unbridged', proxyUrl: redactProxyUrl(raw) }
    }
    return { mode: 'http-proxy', proxyUrl: redactProxyUrl(raw) }
  }

  const axios = loadAlpacaAxios()
  const defaults = axios.defaults as AxiosDefaultsMutable
  // Always disable axios env-proxy auto-config — that path is what 400s on
  // mixed-port local proxies even when the proxy itself is healthy (curl -x works).
  defaults.proxy = false

  if (!raw) {
    delete defaults.httpAgent
    delete defaults.httpsAgent
    appliedRaw = ''
    return { mode: 'direct' }
  }

  if (/^socks/i.test(raw) || !isHttpForwardProxyUrl(raw)) {
    delete defaults.httpAgent
    delete defaults.httpsAgent
    appliedRaw = raw
    return { mode: 'socks-unbridged', proxyUrl: redactProxyUrl(raw) }
  }

  const agent = new HttpsProxyAgent(raw)
  defaults.httpAgent = agent
  defaults.httpsAgent = agent
  appliedRaw = raw
  return { mode: 'http-proxy', proxyUrl: redactProxyUrl(raw) }
}

/** Test-only: clear the idempotency memo so specs can re-apply. */
export function resetAlpacaAxiosEnvProxyForTests(): void {
  appliedRaw = undefined
}
