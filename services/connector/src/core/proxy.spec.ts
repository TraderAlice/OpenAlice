import http from 'node:http'
import https from 'node:https'
import { getGlobalDispatcher } from 'undici'
import { describe, expect, it } from 'vitest'
import {
  installConnectorProxyTransport,
  proxyUrlFor,
  resolveConnectorProxySettings,
} from './proxy.js'

describe('Connector proxy transport', () => {
  it('normalizes lowercase and ALL_PROXY variables for every SDK', () => {
    expect(resolveConnectorProxySettings({
      all_proxy: 'http://127.0.0.1:7890',
      no_proxy: 'localhost,.internal.example',
    })).toEqual({
      httpProxy: 'http://127.0.0.1:7890',
      httpsProxy: 'http://127.0.0.1:7890',
      noProxy: 'localhost,.internal.example',
    })
  })

  it('selects secure proxies and respects NO_PROXY hosts and ports', () => {
    const settings = {
      httpProxy: 'http://http-proxy:8080',
      httpsProxy: 'http://https-proxy:8443',
      noProxy: 'localhost,.internal.example,api.example:444',
    }
    expect(proxyUrlFor('https://api.telegram.org/', settings)).toBe('http://https-proxy:8443')
    expect(proxyUrlFor('http://discord.com/', settings)).toBe('http://http-proxy:8080')
    expect(proxyUrlFor('https://service.internal.example/', settings)).toBe('')
    expect(proxyUrlFor('https://api.example:444/', settings)).toBe('')
    expect(proxyUrlFor('https://api.example/', settings)).toBe('http://https-proxy:8443')
  })

  it('installs and restores Node and Undici process defaults', async () => {
    const previousHttpAgent = http.globalAgent
    const previousHttpsAgent = https.globalAgent
    const previousDispatcher = getGlobalDispatcher()
    const transport = installConnectorProxyTransport({ HTTPS_PROXY: 'http://127.0.0.1:7890' })
    try {
      expect(transport.active).toBe(true)
      expect(http.globalAgent).toBe(transport.nodeAgent)
      expect(https.globalAgent).toBe(transport.nodeAgent)
      expect(getGlobalDispatcher()).toBe(transport.dispatcher)
    } finally {
      await transport.close()
    }
    expect(http.globalAgent).toBe(previousHttpAgent)
    expect(https.globalAgent).toBe(previousHttpsAgent)
    expect(getGlobalDispatcher()).toBe(previousDispatcher)
  })
})
