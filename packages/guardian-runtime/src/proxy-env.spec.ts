import { describe, expect, it } from 'vitest'

import { proxyEnvFromRules } from './proxy-env.js'

describe('proxyEnvFromRules', () => {
  it('turns a Chromium PROXY rule into Node proxy env', () => {
    expect(proxyEnvFromRules('PROXY 127.0.0.1:7890; DIRECT', {})).toEqual({
      HTTPS_PROXY: 'http://127.0.0.1:7890',
      HTTP_PROXY: 'http://127.0.0.1:7890',
      ALL_PROXY: 'http://127.0.0.1:7890',
      NODE_USE_ENV_PROXY: '1',
      NO_PROXY: '127.0.0.1,localhost,::1',
    })
  })

  it('leaves DIRECT and SOCKS-only system rules untouched', () => {
    expect(proxyEnvFromRules('DIRECT', {})).toEqual({})
    expect(proxyEnvFromRules('SOCKS5 127.0.0.1:1080; DIRECT', {})).toEqual({})
  })

  it('normalizes explicit proxy env and enables Node consumption', () => {
    expect(proxyEnvFromRules('PROXY system:8080', { HTTPS_PROXY: 'http://explicit:9000' }))
      .toEqual({ HTTPS_PROXY: 'http://explicit:9000', NODE_USE_ENV_PROXY: '1', NO_PROXY: '127.0.0.1,localhost,::1' })
    expect(proxyEnvFromRules('PROXY system:8080', {
      HTTPS_PROXY: 'http://explicit:9000',
      NODE_USE_ENV_PROXY: '1',
      NO_PROXY: 'internal.example,localhost',
    })).toEqual({ HTTPS_PROXY: 'http://explicit:9000', NO_PROXY: 'internal.example,localhost,127.0.0.1,::1' })
    expect(proxyEnvFromRules('DIRECT', { https_proxy: 'http://lowercase:7890' }))
      .toEqual({ HTTPS_PROXY: 'http://lowercase:7890', NODE_USE_ENV_PROXY: '1', NO_PROXY: '127.0.0.1,localhost,::1' })
  })

  it('keeps standard proxy variables authoritative over app configuration', () => {
    expect(proxyEnvFromRules('', {
      HTTPS_PROXY: 'http://standard.example:9000',
      OPENALICE_PROXY_URL: 'http://app.example:7897',
    })).toEqual({
      HTTPS_PROXY: 'http://standard.example:9000',
      NODE_USE_ENV_PROXY: '1',
      NO_PROXY: '127.0.0.1,localhost,::1',
    })
  })

  it.each(['http://127.0.0.1:7897', 'https://proxy.example:8443'])
    ('normalizes a valid OPENALICE_PROXY_URL fallback (%s)', (proxyUrl) => {
      expect(proxyEnvFromRules('DIRECT', {
        OPENALICE_PROXY_URL: proxyUrl,
        NO_PROXY: 'internal.example,localhost',
      })).toEqual({
        HTTPS_PROXY: proxyUrl,
        HTTP_PROXY: proxyUrl,
        ALL_PROXY: proxyUrl,
        NODE_USE_ENV_PROXY: '1',
        NO_PROXY: 'internal.example,localhost,127.0.0.1,::1',
      })
    })

  it.each(['not a URL', 'ftp://proxy.example:8080', 'socks5://127.0.0.1:1080', 'https://'])
    ('rejects malformed or unsupported app proxy values (%s)', (proxyUrl) => {
      expect(proxyEnvFromRules('DIRECT', { OPENALICE_PROXY_URL: proxyUrl })).toEqual({})
    })

  it('continues with system rules when app proxy configuration is invalid', () => {
    expect(proxyEnvFromRules('PROXY fallback.example:8080', {
      OPENALICE_PROXY_URL: 'socks5://127.0.0.1:1080',
    })).toEqual({
      HTTPS_PROXY: 'http://fallback.example:8080',
      HTTP_PROXY: 'http://fallback.example:8080',
      ALL_PROXY: 'http://fallback.example:8080',
      NODE_USE_ENV_PROXY: '1',
      NO_PROXY: '127.0.0.1,localhost,::1',
    })
  })
})
