import { describe, expect, it } from 'vitest'

import {
  buildGuardianChildEnv,
  parseWindowsProxyRegistryOutput,
  resolveGuardianProxyEnv,
  windowsProxyServerToRules,
} from './system-proxy.js'

const registry = (values: Record<string, string>) => async (_command: string, args: readonly string[]): Promise<string> => {
  const valueName = args[args.length - 1]
  const value = values[valueName]
  if (value === undefined) throw new Error('value is not configured')
  return value
}

describe('Windows system proxy parsing', () => {
  it('parses named registry values without depending on registry access', () => {
    expect(parseWindowsProxyRegistryOutput([
      '    ProxyEnable    REG_DWORD    0x1',
      '    ProxyServer    REG_SZ       http=proxy.example:8080;https=secure.example:8443',
      '    AutoConfigURL  REG_SZ       https://pac.example/proxy.pac',
    ].join('\n'))).toEqual({
      proxyEnable: true,
      proxyServer: 'http=proxy.example:8080;https=secure.example:8443',
      autoConfigUrl: 'https://pac.example/proxy.pac',
    })
  })

  it('normalizes single and per-protocol HTTP proxy forms while rejecting SOCKS-only forms', () => {
    expect(windowsProxyServerToRules('proxy.example:8080')).toBe('PROXY proxy.example:8080')
    expect(windowsProxyServerToRules('http=proxy.example:8080;https=secure.example:8443'))
      .toBe('HTTPS secure.example:8443')
    expect(windowsProxyServerToRules('https=https-proxy.example:8443')).toBe('HTTPS https-proxy.example:8443')
    expect(windowsProxyServerToRules('socks=127.0.0.1:1080')).toBe('')
    expect(windowsProxyServerToRules('http=http://proxy.example:8080;https=https://proxy.example:8443'))
      .toBe('HTTPS https://proxy.example:8443')
  })
})

describe('resolveGuardianProxyEnv', () => {
  it('uses explicit app proxy before Windows registry discovery', async () => {
    let calls = 0
    const result = await resolveGuardianProxyEnv({
      OPENALICE_PROXY_URL: 'https://app.example:8443',
      NO_PROXY: 'internal.example',
    }, {
      platform: 'win32',
      runCommand: async () => {
        calls += 1
        throw new Error('must not be called')
      },
    })

    expect(calls).toBe(0)
    expect(result).toEqual({
      envPatch: {
        HTTPS_PROXY: 'https://app.example:8443',
        HTTP_PROXY: 'https://app.example:8443',
        ALL_PROXY: 'https://app.example:8443',
        NODE_USE_ENV_PROXY: '1',
        NO_PROXY: 'internal.example,127.0.0.1,localhost,::1',
      },
    })
  })

  it('keeps explicit standard proxy env authoritative and does not query Windows', async () => {
    let calls = 0
    const result = await resolveGuardianProxyEnv({
      HTTPS_PROXY: 'http://explicit.example:9000',
      NO_PROXY: 'internal.example,localhost',
    }, {
      platform: 'win32',
      runCommand: async () => {
        calls += 1
        throw new Error('must not be called')
      },
    })

    expect(calls).toBe(0)
    expect(result).toEqual({
      envPatch: {
        HTTPS_PROXY: 'http://explicit.example:9000',
        NODE_USE_ENV_PROXY: '1',
        NO_PROXY: 'internal.example,localhost,127.0.0.1,::1',
      },
    })
  })

  it('resolves an enabled Windows manual proxy and preserves NO_PROXY', async () => {
    const result = await resolveGuardianProxyEnv({ no_proxy: 'corp.example,localhost' }, {
      platform: 'win32',
      runCommand: registry({
        ProxyEnable: '    ProxyEnable    REG_DWORD    0x1',
        ProxyServer: '    ProxyServer    REG_SZ       127.0.0.1:7890',
      }),
    })

    expect(result).toEqual({
      envPatch: {
        HTTPS_PROXY: 'http://127.0.0.1:7890',
        HTTP_PROXY: 'http://127.0.0.1:7890',
        ALL_PROXY: 'http://127.0.0.1:7890',
        NODE_USE_ENV_PROXY: '1',
        NO_PROXY: 'corp.example,localhost,127.0.0.1,::1',
      },
    })
  })

  it.each([
    {
      name: 'disabled manual proxy',
      values: {
        ProxyEnable: '    ProxyEnable    REG_DWORD    0x0',
        ProxyServer: '    ProxyServer    REG_SZ       proxy.example:8080',
      },
      diagnostic: 'disabled or DIRECT',
    },
    {
      name: 'PAC-only configuration',
      values: {
        ProxyEnable: '    ProxyEnable    REG_DWORD    0x1',
        AutoConfigURL: '    AutoConfigURL  REG_SZ       https://secret.example/pac',
      },
      diagnostic: 'PAC/auto-configuration',
    },
    {
      name: 'SOCKS-only configuration',
      values: {
        ProxyEnable: '    ProxyEnable    REG_DWORD    0x1',
        ProxyServer: '    ProxyServer    REG_SZ       socks=127.0.0.1:1080',
      },
      diagnostic: 'no usable HTTP(S) endpoint',
    },
  ])('fails open for $name without leaking settings', async ({ values, diagnostic }) => {
    const result = await resolveGuardianProxyEnv({}, { platform: 'win32', runCommand: registry(values) })

    expect(result.envPatch).toEqual({})
    expect(result.diagnostic).toContain(diagnostic)
    expect(result.diagnostic).not.toContain('secret.example')
    expect(result.diagnostic).not.toContain('127.0.0.1')
  })

  it('fails open when Windows registry commands cannot be resolved', async () => {
    const result = await resolveGuardianProxyEnv({}, {
      platform: 'win32',
      runCommand: async () => { throw new Error('registry unavailable') },
    })

    expect(result).toEqual({
      envPatch: {},
      diagnostic: 'system proxy settings could not be resolved; continuing without proxy',
    })
  })

  it('does not invoke Windows discovery on non-Windows platforms', async () => {
    let calls = 0
    const result = await resolveGuardianProxyEnv({}, {
      platform: 'linux',
      runCommand: async () => {
        calls += 1
        return ''
      },
    })

    expect(calls).toBe(0)
    expect(result).toEqual({
      envPatch: {},
      diagnostic: 'system proxy auto-discovery is unavailable on this platform; continuing without proxy',
    })
  })
})

describe('buildGuardianChildEnv', () => {
  it('forms one resolved child-env boundary reused by service and restart specs', async () => {
    const result = await buildGuardianChildEnv({
      OPENALICE_HOME: 'C:/homes/alice',
      NO_PROXY: 'internal.example',
    }, {
      platform: 'win32',
      runCommand: registry({
        ProxyEnable: '    ProxyEnable    REG_DWORD    0x1',
        ProxyServer: '    ProxyServer    REG_SZ       http=proxy.example:8080;https=proxy.example:8080',
      }),
    })

    const utaSpecEnv = { ...result.env, OPENALICE_UTA_PORT: '47333' }
    const restartedUtaSpecEnv = { ...result.env, OPENALICE_UTA_PORT: '47333' }
    expect(utaSpecEnv).toEqual(restartedUtaSpecEnv)
    expect(utaSpecEnv.HTTPS_PROXY).toBe('http://proxy.example:8080')
    expect(utaSpecEnv.OPENALICE_HOME).toBe('C:/homes/alice')
    expect(utaSpecEnv.NO_PROXY).toBe('internal.example,127.0.0.1,localhost,::1')
  })
})
