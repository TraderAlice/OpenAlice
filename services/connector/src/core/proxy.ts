import http, { type Agent as NodeHttpAgent } from 'node:http'
import https from 'node:https'

import { HttpProxyAgent } from 'http-proxy-agent'
import { HttpsProxyAgent } from 'https-proxy-agent'
import {
  EnvHttpProxyAgent,
  getGlobalDispatcher,
  setGlobalDispatcher,
  type Dispatcher,
} from 'undici'

type EnvLike = Readonly<Record<string, string | undefined>>

export interface ConnectorProxySettings {
  httpProxy?: string
  httpsProxy?: string
  noProxy?: string
}

/**
 * Shared network context for Connector adapters.
 *
 * Most modern SDKs use Undici, but grammY deliberately supplies node-fetch
 * with its own Node agent. Keep both transports in one service-owned object so
 * adding a Connector does not require rediscovering proxy behavior per SDK.
 */
export interface ConnectorProxyTransport {
  readonly active: boolean
  readonly dispatcher?: Dispatcher
  readonly nodeFetchAgent?: (url: URL) => NodeHttpAgent
  close(): Promise<void>
}

export const DIRECT_CONNECTOR_PROXY_TRANSPORT: ConnectorProxyTransport = {
  active: false,
  close: async () => undefined,
}

/** Normalize conventional upper/lower-case variables and ALL_PROXY fallback. */
export function resolveConnectorProxySettings(
  env: EnvLike = process.env,
): ConnectorProxySettings {
  const allProxy = supportedProxyUrl(envValue(env, 'ALL_PROXY'))
  const httpProxy = supportedProxyUrl(envValue(env, 'HTTP_PROXY')) ?? allProxy
  const httpsProxy = supportedProxyUrl(envValue(env, 'HTTPS_PROXY')) ?? httpProxy
  const noProxy = envValue(env, 'NO_PROXY')
  return {
    ...(httpProxy ? { httpProxy } : {}),
    ...(httpsProxy ? { httpsProxy } : {}),
    ...(noProxy ? { noProxy } : {}),
  }
}

/**
 * Install the Connector process' Undici default and return an explicit
 * node-fetch agent selector for SDKs that bypass that default.
 *
 * This does not replace Node's global http/https agents. Only the dedicated
 * Connector process and adapters composed with this transport are affected.
 */
export function installConnectorProxyTransport(
  env: EnvLike = process.env,
): ConnectorProxyTransport {
  const settings = resolveConnectorProxySettings(env)
  if (!settings.httpProxy && !settings.httpsProxy) return DIRECT_CONNECTOR_PROXY_TRANSPORT

  const dispatcher = new EnvHttpProxyAgent(settings)
  const previousDispatcher = getGlobalDispatcher()
  setGlobalDispatcher(dispatcher)

  const directHttp = new http.Agent({ keepAlive: true })
  const directHttps = new https.Agent({ keepAlive: true })
  const agents = new Map<string, NodeHttpAgent>()

  const nodeFetchAgent = (url: URL): NodeHttpAgent => {
    const proxyUrl = proxyUrlFor(url.href, settings)
    if (!proxyUrl) return url.protocol === 'https:' ? directHttps : directHttp

    const key = `${url.protocol}:${proxyUrl}`
    const existing = agents.get(key)
    if (existing) return existing
    const agent = url.protocol === 'https:'
      ? new HttpsProxyAgent(proxyUrl)
      : new HttpProxyAgent(proxyUrl)
    agents.set(key, agent)
    return agent
  }

  let closed = false
  return {
    active: true,
    dispatcher,
    nodeFetchAgent,
    close: async () => {
      if (closed) return
      closed = true
      if (getGlobalDispatcher() === dispatcher) setGlobalDispatcher(previousDispatcher)
      for (const agent of agents.values()) agent.destroy()
      directHttp.destroy()
      directHttps.destroy()
      await dispatcher.close()
    },
  }
}

export function proxyUrlFor(
  rawUrl: string,
  settings: ConnectorProxySettings,
): string {
  const url = new URL(rawUrl)
  if (bypassesProxy(url, settings.noProxy)) return ''
  return (url.protocol === 'https:'
    ? settings.httpsProxy ?? settings.httpProxy
    : settings.httpProxy ?? settings.httpsProxy) ?? ''
}

function bypassesProxy(url: URL, rawNoProxy: string | undefined): boolean {
  if (!rawNoProxy) return false
  const entries = rawNoProxy.split(/[\s,]+/).map((entry) => entry.trim()).filter(Boolean)
  if (entries.includes('*')) return true

  const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase()
  const port = Number(url.port) || (url.protocol === 'https:' ? 443 : 80)
  return entries.some((entry) => {
    const parsed = parseNoProxyEntry(entry)
    if (!parsed || (parsed.port !== undefined && parsed.port !== port)) return false
    return hostname === parsed.hostname || hostname.endsWith(`.${parsed.hostname}`)
  })
}

function parseNoProxyEntry(entry: string): { hostname: string; port?: number } | undefined {
  let value = entry.toLowerCase()
  let port: number | undefined
  if (value.startsWith('[')) {
    const match = /^\[([^\]]+)\](?::(\d+))?$/.exec(value)
    if (!match?.[1]) return undefined
    value = match[1]
    if (match[2]) port = Number(match[2])
  } else {
    const match = /^(.*):(\d+)$/.exec(value)
    if (match?.[1] && !match[1].includes(':')) {
      value = match[1]
      port = Number(match[2])
    }
  }
  const hostname = value.replace(/^\*?\./, '')
  return hostname ? { hostname, ...(port !== undefined ? { port } : {}) } : undefined
}

function envValue(env: EnvLike, key: string): string | undefined {
  const value = env[key]?.trim() || env[key.toLowerCase()]?.trim()
  return value || undefined
}

function supportedProxyUrl(value: string | undefined): string | undefined {
  if (!value) return undefined
  try {
    const protocol = new URL(value).protocol
    return protocol === 'http:' || protocol === 'https:' ? value : undefined
  } catch {
    return undefined
  }
}
