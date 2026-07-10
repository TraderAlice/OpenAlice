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

  it('never overwrites explicit proxy env but enables Node consumption', () => {
    expect(proxyEnvFromRules('PROXY system:8080', { HTTPS_PROXY: 'http://explicit:9000' }))
      .toEqual({ NODE_USE_ENV_PROXY: '1', NO_PROXY: '127.0.0.1,localhost,::1' })
    expect(proxyEnvFromRules('PROXY system:8080', {
      HTTPS_PROXY: 'http://explicit:9000',
      NODE_USE_ENV_PROXY: '1',
      NO_PROXY: 'internal.example,localhost',
    })).toEqual({ NO_PROXY: 'internal.example,localhost,127.0.0.1,::1' })
  })
})
