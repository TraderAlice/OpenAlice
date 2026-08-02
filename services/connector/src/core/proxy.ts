import http, {
  type Agent as NodeHttpAgent,
  type ClientRequest,
} from 'node:http'
import https from 'node:https'
import { Agent as AgentBase, type AgentConnectOpts } from 'agent-base'
import { HttpProxyAgent } from 'http-proxy-agent'
import { HttpsProxyAgent } from 'https-proxy-agent'
import {
  Agent as UndiciAgent,
  Pool,
  ProxyAgent as UndiciProxyAgent,
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

export interface ConnectorProxyTransport {
  readonly active: boolean
  readonly nodeAgent?: NodeHttpAgent
  readonly dispatcher?: Dispatcher
  close(): Promise<void>
}

export const DIRECT_CONNECTOR_PROXY_TRANSPORT: ConnectorProxyTransport = {
  active: false,
  close: async () => undefined,
}

/**
 * Normalize the conventional upper/lower-case proxy variables once for every
 * connector SDK. ALL_PROXY is a fallback because Node/Undici consumers do not
 * consistently implement it themselves.
 */
export function resolveConnectorProxySettings(
  env: EnvLike = process.env,
): ConnectorProxySettings {
  const allProxy = envValue(env, 'ALL_PROXY')
  const httpProxy = envValue(env, 'HTTP_PROXY') ?? allProxy
  const httpsProxy = envValue(env, 'HTTPS_PROXY') ?? httpProxy
  const noProxy = envValue(env, 'NO_PROXY')
  return {
    ...(httpProxy ? { httpProxy } : {}),
    ...(httpsProxy ? { httpsProxy } : {}),
    ...(noProxy ? { noProxy } : {}),
  }
}

/**
 * Install process-wide proxy defaults for Node HTTP(S), WebSocket SDKs, and
 * Undici, while also returning explicit agents for SDKs that replace globals
 * (grammY/node-fetch and discord.js REST both do this).
 */
export function installConnectorProxyTransport(
  env: EnvLike = process.env,
): ConnectorProxyTransport {
  const settings = resolveConnectorProxySettings(env)
  if (!settings.httpProxy && !settings.httpsProxy) return DIRECT_CONNECTOR_PROXY_TRANSPORT

  const nodeAgent = new ConnectorNodeProxyAgent(settings)
  const previousHttpAgent = http.globalAgent
  const previousHttpsAgent = https.globalAgent
  const previousDispatcher = getGlobalDispatcher()
  const dispatcher = createUndiciDispatcher(settings)

  http.globalAgent = nodeAgent
  https.globalAgent = nodeAgent
  if (dispatcher) setGlobalDispatcher(dispatcher)

  let closed = false
  return {
    active: true,
    nodeAgent,
    dispatcher,
    close: async () => {
      if (closed) return
      closed = true
      if (http.globalAgent === nodeAgent) http.globalAgent = previousHttpAgent
      if (https.globalAgent === nodeAgent) https.globalAgent = previousHttpsAgent
      if (dispatcher && getGlobalDispatcher() === dispatcher) setGlobalDispatcher(previousDispatcher)
      nodeAgent.destroy()
      await dispatcher?.close()
    },
  }
}

/**
 * A statically bundled HTTP(S)-proxy router. `proxy-agent` loads protocol
 * implementations dynamically, which does not survive Connector Service's
 * single-file tsup bundle; keeping the two supported constructors explicit
 * makes packaged behavior match source behavior.
 */
class ConnectorNodeProxyAgent extends AgentBase {
  private readonly agents = new Map<string, NodeHttpAgent>()
  private readonly directHttp = new http.Agent()
  private readonly directHttps = new https.Agent()

  constructor(private readonly settings: ConnectorProxySettings) {
    super()
  }

  async connect(request: ClientRequest, options: AgentConnectOpts): Promise<NodeHttpAgent> {
    const isWebSocket = request.getHeader('upgrade') === 'websocket'
    const protocol = options.secureEndpoint
      ? (isWebSocket ? 'wss:' : 'https:')
      : (isWebSocket ? 'ws:' : 'http:')
    const host = request.getHeader('host')
    if (typeof host !== 'string') throw new Error('Connector proxy request host is missing')
    const requestUrl = new URL(request.path, `${protocol}//${host}`).href
    const proxy = proxyUrlFor(requestUrl, this.settings)
    if (!proxy) return options.secureEndpoint ? this.directHttps : this.directHttp

    const proxyProtocol = new URL(proxy).protocol
    if (proxyProtocol !== 'http:' && proxyProtocol !== 'https:') {
      throw new Error(`Connector proxy protocol is not supported: ${proxyProtocol}`)
    }
    const cacheKey = `${options.secureEndpoint || isWebSocket ? 'tunnel' : 'forward'}:${proxy}`
    const cached = this.agents.get(cacheKey)
    if (cached) return cached
    const agent = options.secureEndpoint || isWebSocket
      ? new HttpsProxyAgent(proxy)
      : new HttpProxyAgent(proxy)
    this.agents.set(cacheKey, agent)
    return agent
  }

  override destroy(): void {
    for (const agent of this.agents.values()) agent.destroy()
    this.directHttp.destroy()
    this.directHttps.destroy()
    super.destroy()
  }
}

export function proxyUrlFor(
  rawUrl: string,
  settings: ConnectorProxySettings,
): string {
  const url = new URL(rawUrl)
  if (bypassesProxy(url, settings.noProxy)) return ''
  const secure = url.protocol === 'https:' || url.protocol === 'wss:'
  return (secure ? settings.httpsProxy ?? settings.httpProxy : settings.httpProxy ?? settings.httpsProxy) ?? ''
}

function createUndiciDispatcher(settings: ConnectorProxySettings): UndiciAgent | undefined {
  // Undici's ProxyAgent accepts HTTP(S) proxy endpoints. Route per origin so
  // the same NO_PROXY contract also applies to Discord REST.
  if (!supportedUndiciProxy(settings.httpsProxy) && !supportedUndiciProxy(settings.httpProxy)) {
    return undefined
  }
  return new UndiciAgent({
    factory: (origin, options) => {
      const proxy = supportedUndiciProxy(proxyUrlFor(String(origin), settings))
      return proxy
        ? new UndiciProxyAgent({ uri: proxy })
        : new Pool(origin, options)
    },
  })
}

function supportedUndiciProxy(value: string | undefined): string | undefined {
  if (!value) return undefined
  try {
    const protocol = new URL(value).protocol
    return protocol === 'http:' || protocol === 'https:' ? value : undefined
  } catch {
    return undefined
  }
}

function bypassesProxy(url: URL, rawNoProxy: string | undefined): boolean {
  if (!rawNoProxy) return false
  const entries = rawNoProxy.split(/[\s,]+/).map((entry) => entry.trim()).filter(Boolean)
  if (entries.includes('*')) return true

  const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase()
  const port = Number(url.port) || defaultPort(url.protocol)
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

function defaultPort(protocol: string): number {
  return protocol === 'https:' || protocol === 'wss:' ? 443 : 80
}

function envValue(env: EnvLike, key: string): string | undefined {
  const value = env[key]?.trim() || env[key.toLowerCase()]?.trim()
  return value || undefined
}
