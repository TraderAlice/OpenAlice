import { describe, expect, it, vi } from 'vitest'

import {
  NPM_PACKAGE_NAMES,
  preflightPublicCliAuthority,
} from './preflight-public-cli-authority.mjs'

function response(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return body
    },
  }
}

const oidcEnv = {
  OPENALICE_PUBLISH_NPM: 'true',
  ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'github-request-secret',
  ACTIONS_ID_TOKEN_REQUEST_URL: 'https://token.actions.githubusercontent.com/id?existing=1',
}

function oidcResponse(url) {
  return url.includes('actions.githubusercontent.com')
    ? response(200, { value: 'github-id-secret' })
    : response(201, { token_type: 'oidc', token: 'npm-exchanged-secret' })
}

describe('public CLI authority preflight', () => {
  it('does no external work while every publication switch is disabled', async () => {
    const fetchImpl = vi.fn()
    const verifyAur = vi.fn()
    const logger = { log: vi.fn() }

    await expect(preflightPublicCliAuthority({ env: {}, fetchImpl, verifyAur, logger }))
      .resolves.toEqual({ enabled: [], npmPackages: [] })
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(verifyAur).not.toHaveBeenCalled()
  })

  it('exchanges OIDC for every package and independently checks Tap and AUR', async () => {
    const env = {
      ...oidcEnv,
      OPENALICE_PUBLISH_HOMEBREW: 'true',
      OPENALICE_PUBLISH_AUR: 'true',
      HOMEBREW_TAP_TOKEN: 'tap-secret',
      AUR_SSH_PRIVATE_KEY: 'aur-secret',
      AUR_KNOWN_HOSTS: 'aur.example ssh-ed25519 key',
    }
    const fetchImpl = vi.fn(async (url) => {
      if (url.includes('api.github.com')) return response(200, { permissions: { push: true } })
      return oidcResponse(url)
    })
    const verifyAur = vi.fn(async () => {})

    await expect(preflightPublicCliAuthority({
      env,
      fetchImpl,
      verifyAur,
      logger: { log: vi.fn() },
    })).resolves.toEqual({
      enabled: ['npm', 'homebrew', 'aur'],
      npmPackages: NPM_PACKAGE_NAMES,
    })
    expect(fetchImpl).toHaveBeenCalledTimes(NPM_PACKAGE_NAMES.length + 2)
    expect(verifyAur).toHaveBeenCalledWith({ env })
  })

  it('reports every enabled channel that is missing authority', async () => {
    const env = {
      OPENALICE_PUBLISH_NPM: 'true',
      OPENALICE_PUBLISH_HOMEBREW: 'true',
      OPENALICE_PUBLISH_AUR: 'true',
    }

    await expect(preflightPublicCliAuthority({
      env,
      fetchImpl: vi.fn(),
      verifyAur: vi.fn(),
      logger: { log: vi.fn() },
    })).rejects.toThrow(new RegExp([
      'ACTIONS_ID_TOKEN_REQUEST_TOKEN is missing',
      'HOMEBREW_TAP_TOKEN is missing',
      'AUR_SSH_PRIVATE_KEY is missing',
    ].join('[\\s\\S]*')))
  })

  it('never falls back to an old npm token outside GitHub OIDC', async () => {
    const fetchImpl = vi.fn()
    await expect(preflightPublicCliAuthority({
      env: {
        OPENALICE_PUBLISH_NPM: 'true',
        NPM_TOKEN: 'npm-secret',
      },
      fetchImpl,
      logger: { log: vi.fn() },
    })).rejects.toThrow('ACTIONS_ID_TOKEN_REQUEST_TOKEN is missing')
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it.each([401, 403, 404, 500])('rejects missing or unauthorized trust (HTTP %s)', async (status) => {
    const fetchImpl = vi.fn(async (url) => {
      if (url.includes('actions.githubusercontent.com')) return oidcResponse(url)
      return response(status, { error: 'private server response' })
    })

    await expect(preflightPublicCliAuthority({
      env: oidcEnv,
      fetchImpl,
      logger: { log: vi.fn() },
    })).rejects.toThrow(`npm OIDC exchange for openalice request failed with HTTP ${status}`)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('uses the npm audience and fixed registry, without publishing or leaking credentials', async () => {
    const fetchImpl = vi.fn(async (url) => oidcResponse(url))
    const logger = { log: vi.fn() }
    const result = await preflightPublicCliAuthority({
      env: { ...oidcEnv, OPENALICE_NPM_REGISTRY_URL: 'https://untrusted.example' },
      fetchImpl, logger,
    })
    expect(fetchImpl.mock.calls[0][0]).toBe(
      `${oidcEnv.ACTIONS_ID_TOKEN_REQUEST_URL}&audience=npm%3Aregistry.npmjs.org`,
    )
    expect(fetchImpl.mock.calls[0][1].headers.authorization).toBe('Bearer github-request-secret')
    expect(fetchImpl.mock.calls.slice(1).map(([url]) => url)).toEqual(
      NPM_PACKAGE_NAMES.map((name) => `https://registry.npmjs.org/-/npm/v1/oidc/token/exchange/package/${name}`),
    )
    for (const [, options] of fetchImpl.mock.calls.slice(1)) {
      expect(options.method).toBe('POST')
      expect(options.headers.authorization).toBe('Bearer github-id-secret')
      expect(options.body).toBeUndefined()
    }
    for (const [, options] of fetchImpl.mock.calls) {
      expect(options.redirect).toBe('error')
      expect(options.signal).toBeInstanceOf(AbortSignal)
    }
    expect(JSON.stringify([result, logger.log.mock.calls])).not.toContain('secret')
  })

  it.each(['not-a-url', 'http://token.actions.githubusercontent.com/id', 'https://untrusted.example/id', 'https://user@token.actions.githubusercontent.com/id'])('rejects an unsafe identity endpoint: %s', async (url) => {
    const fetchImpl = vi.fn()
    await expect(preflightPublicCliAuthority({
      env: { ...oidcEnv, ACTIONS_ID_TOKEN_REQUEST_URL: url }, fetchImpl,
    })).rejects.toThrow('requires the GitHub Actions identity endpoint')
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('fails if any platform connection is missing, even when the meta package passed', async () => {
    const logger = { log: vi.fn() }
    await expect(preflightPublicCliAuthority({
      env: oidcEnv, logger,
      fetchImpl: async (url) => url.endsWith('/openalice-linux-x64') ? response(404, {}) : oidcResponse(url),
    })).rejects.toThrow('npm OIDC exchange for openalice-linux-x64 request failed with HTTP 404')
    expect(logger.log).not.toHaveBeenCalled()
  })

  it('sanitizes invalid JSON errors', async () => {
    await expect(preflightPublicCliAuthority({
      env: oidcEnv,
      fetchImpl: async () => ({ ok: true, json() { throw new Error('private response') } }),
    })).rejects.toThrow('GitHub OIDC identity returned invalid JSON')
  })

  it.each([{}, { token_type: 'oidc', token: '' }, { token_type: 'bearer', token: 'secret' }])('rejects malformed exchange responses: %j', async (body) => {
    await expect(preflightPublicCliAuthority({
      env: oidcEnv,
      fetchImpl: async (url) => url.includes('actions.githubusercontent.com') ? oidcResponse(url) : response(201, body),
    })).rejects.toThrow('did not return a publishing token')
  })

  it('sanitizes transport errors and rejects an empty identity response', async () => {
    await expect(preflightPublicCliAuthority({
      env: oidcEnv, fetchImpl: async () => { throw new Error('sensitive-credential') },
    })).rejects.toThrow('GitHub OIDC identity request failed')
    await expect(preflightPublicCliAuthority({
      env: oidcEnv, fetchImpl: async () => response(200, {}),
    })).rejects.toThrow('did not return an ID token')
  })

  it('rejects read-only Tap tokens and inaccessible AUR repos', async () => {
    const env = {
      ...oidcEnv,
      OPENALICE_PUBLISH_HOMEBREW: 'true',
      OPENALICE_PUBLISH_AUR: 'true',
      HOMEBREW_TAP_TOKEN: 'tap-secret',
      AUR_SSH_PRIVATE_KEY: 'aur-secret',
      AUR_KNOWN_HOSTS: 'aur.example ssh-ed25519 key',
    }
    const fetchImpl = vi.fn(async (url) => {
      if (url.includes('api.github.com')) return response(200, { permissions: { push: false } })
      return oidcResponse(url)
    })

    await expect(preflightPublicCliAuthority({
      env,
      fetchImpl,
      verifyAur: vi.fn(async () => { throw new Error('AUR repository is unavailable') }),
      logger: { log: vi.fn() },
    })).rejects.toThrow(new RegExp([
      'HOMEBREW_TAP_TOKEN does not have push authority',
      'AUR repository is unavailable',
    ].join('[\\s\\S]*')))
  })
})
