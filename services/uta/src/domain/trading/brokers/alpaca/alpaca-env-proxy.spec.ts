import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRequire } from 'node:module'
import { HttpsProxyAgent } from 'https-proxy-agent'
import {
  applyAlpacaAxiosEnvProxy,
  isHttpForwardProxyUrl,
  redactProxyUrl,
  resetAlpacaAxiosEnvProxyForTests,
  resolveAlpacaOutboundProxyRaw,
} from './alpaca-env-proxy.js'

function loadAlpacaAxios(): { defaults: { proxy?: unknown; httpAgent?: unknown; httpsAgent?: unknown } } {
  const require = createRequire(import.meta.url)
  const alpacaEntry = require.resolve('@alpacahq/alpaca-trade-api')
  return require(require.resolve('axios', { paths: [alpacaEntry] }))
}

describe('alpaca-env-proxy', () => {
  const saved = { ...process.env }

  beforeEach(() => {
    for (const k of ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy']) {
      delete process.env[k]
    }
    resetAlpacaAxiosEnvProxyForTests()
    const axios = loadAlpacaAxios()
    delete axios.defaults.httpAgent
    delete axios.defaults.httpsAgent
    axios.defaults.proxy = undefined
  })

  afterEach(() => {
    process.env = { ...saved }
    resetAlpacaAxiosEnvProxyForTests()
  })

  it('resolveAlpacaOutboundProxyRaw prefers HTTPS_PROXY over HTTP_PROXY and ALL_PROXY', () => {
    process.env.ALL_PROXY = 'http://127.0.0.1:1'
    process.env.HTTP_PROXY = 'http://127.0.0.1:2'
    process.env.HTTPS_PROXY = 'http://127.0.0.1:3'
    expect(resolveAlpacaOutboundProxyRaw()).toBe('http://127.0.0.1:3')
  })

  it('resolveAlpacaOutboundProxyRaw falls back through HTTP_PROXY to ALL_PROXY', () => {
    process.env.ALL_PROXY = 'http://127.0.0.1:1'
    expect(resolveAlpacaOutboundProxyRaw()).toBe('http://127.0.0.1:1')
    process.env.HTTP_PROXY = 'http://127.0.0.1:2'
    expect(resolveAlpacaOutboundProxyRaw()).toBe('http://127.0.0.1:2')
  })

  it('redacts userinfo in proxy URLs', () => {
    expect(redactProxyUrl('http://user:pass@127.0.0.1:10808')).toBe('http://***@127.0.0.1:10808')
  })

  it('isHttpForwardProxyUrl accepts only http(s)', () => {
    expect(isHttpForwardProxyUrl('http://127.0.0.1:10808')).toBe(true)
    expect(isHttpForwardProxyUrl('https://proxy.example:8443')).toBe(true)
    expect(isHttpForwardProxyUrl('socks5://127.0.0.1:1080')).toBe(false)
    expect(isHttpForwardProxyUrl('not a url')).toBe(false)
  })

  it('applyAlpacaAxiosEnvProxy is a no-op agent-wise when no proxy env is set (direct)', () => {
    const result = applyAlpacaAxiosEnvProxy()
    expect(result).toEqual({ mode: 'direct' })
    const axios = loadAlpacaAxios()
    expect(axios.defaults.proxy).toBe(false)
    expect(axios.defaults.httpAgent).toBeUndefined()
    expect(axios.defaults.httpsAgent).toBeUndefined()
  })

  it('applyAlpacaAxiosEnvProxy attaches one HttpsProxyAgent and disables axios env proxy', () => {
    process.env.HTTP_PROXY = 'http://127.0.0.1:10808'
    process.env.HTTPS_PROXY = 'http://127.0.0.1:10808'
    const result = applyAlpacaAxiosEnvProxy()
    expect(result.mode).toBe('http-proxy')
    expect(result.proxyUrl).toBe('http://127.0.0.1:10808')
    const axios = loadAlpacaAxios()
    expect(axios.defaults.proxy).toBe(false)
    expect(axios.defaults.httpsAgent).toBeInstanceOf(HttpsProxyAgent)
    expect(axios.defaults.httpAgent).toBe(axios.defaults.httpsAgent)
  })

  it('applyAlpacaAxiosEnvProxy prefers HTTPS_PROXY when both are set to different targets', () => {
    process.env.HTTP_PROXY = 'http://127.0.0.1:10808'
    process.env.HTTPS_PROXY = 'http://127.0.0.1:7890'
    const result = applyAlpacaAxiosEnvProxy()
    expect(result).toEqual({ mode: 'http-proxy', proxyUrl: 'http://127.0.0.1:7890' })
  })

  it('applyAlpacaAxiosEnvProxy leaves agents cleared for SOCKS env (unbridged)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    process.env.ALL_PROXY = 'socks5://127.0.0.1:1080'
    const result = applyAlpacaAxiosEnvProxy()
    expect(result.mode).toBe('socks-unbridged')
    const axios = loadAlpacaAxios()
    expect(axios.defaults.proxy).toBe(false)
    expect(axios.defaults.httpsAgent).toBeUndefined()
    warn.mockRestore()
  })

  it('applyAlpacaAxiosEnvProxy is idempotent for the same env snapshot', () => {
    process.env.HTTPS_PROXY = 'http://127.0.0.1:10808'
    applyAlpacaAxiosEnvProxy()
    const axios = loadAlpacaAxios()
    const first = axios.defaults.httpsAgent
    applyAlpacaAxiosEnvProxy()
    expect(axios.defaults.httpsAgent).toBe(first)
  })

  it('applyAlpacaAxiosEnvProxy rebinds when the proxy env changes', () => {
    process.env.HTTPS_PROXY = 'http://127.0.0.1:10808'
    applyAlpacaAxiosEnvProxy()
    const axios = loadAlpacaAxios()
    const first = axios.defaults.httpsAgent
    process.env.HTTPS_PROXY = 'http://127.0.0.1:7890'
    applyAlpacaAxiosEnvProxy()
    expect(axios.defaults.httpsAgent).not.toBe(first)
    expect(axios.defaults.httpsAgent).toBeInstanceOf(HttpsProxyAgent)
  })

  it('applyAlpacaAxiosEnvProxy clears agents when proxy env is removed', () => {
    process.env.HTTPS_PROXY = 'http://127.0.0.1:10808'
    applyAlpacaAxiosEnvProxy()
    delete process.env.HTTPS_PROXY
    expect(applyAlpacaAxiosEnvProxy()).toEqual({ mode: 'direct' })
    const axios = loadAlpacaAxios()
    expect(axios.defaults.httpsAgent).toBeUndefined()
    expect(axios.defaults.httpAgent).toBeUndefined()
    expect(axios.defaults.proxy).toBe(false)
  })
})
