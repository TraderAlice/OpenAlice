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

describe('public CLI authority preflight', () => {
  it('does no external work while every publication switch is disabled', async () => {
    const fetchImpl = vi.fn()
    const verifyAur = vi.fn()
    const logger = { log: vi.fn() }

    await expect(preflightPublicCliAuthority({ env: {}, fetchImpl, verifyAur, logger }))
      .resolves.toEqual({ enabled: [], npmUsername: null })
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(verifyAur).not.toHaveBeenCalled()
  })

  it('verifies the npm identity owns all names and the Tap token can push', async () => {
    const env = {
      OPENALICE_PUBLISH_NPM: 'true',
      OPENALICE_PUBLISH_HOMEBREW: 'true',
      OPENALICE_PUBLISH_AUR: 'true',
      NPM_TOKEN: 'npm-secret',
      HOMEBREW_TAP_TOKEN: 'tap-secret',
      AUR_SSH_PRIVATE_KEY: 'aur-secret',
      AUR_KNOWN_HOSTS: 'aur.example ssh-ed25519 key',
    }
    const fetchImpl = vi.fn(async (url) => {
      if (url.endsWith('/-/whoami')) return response(200, { username: 'alice-release' })
      if (url.includes('api.github.com')) return response(200, { permissions: { push: true } })
      return response(200, { maintainers: [{ name: 'alice-release' }] })
    })
    const verifyAur = vi.fn(async () => {})

    await expect(preflightPublicCliAuthority({
      env,
      fetchImpl,
      verifyAur,
      logger: { log: vi.fn() },
    })).resolves.toEqual({
      enabled: ['npm', 'homebrew', 'aur'],
      npmUsername: 'alice-release',
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
      'NPM_TOKEN is missing',
      'HOMEBREW_TAP_TOKEN is missing',
      'AUR_SSH_PRIVATE_KEY is missing',
    ].join('[\\s\\S]*')))
  })

  it('rejects an authenticated npm token that does not own the reserved names', async () => {
    const fetchImpl = vi.fn(async (url) => {
      if (url.endsWith('/-/whoami')) return response(200, { username: 'alice-release' })
      return response(200, { maintainers: [{ name: 'someone-else' }] })
    })

    await expect(preflightPublicCliAuthority({
      env: {
        OPENALICE_PUBLISH_NPM: 'true',
        NPM_TOKEN: 'npm-secret',
      },
      fetchImpl,
      logger: { log: vi.fn() },
    })).rejects.toThrow('npm token identity alice-release is not a maintainer of openalice')
  })

  it('rejects unreserved npm names, read-only Tap tokens, and inaccessible AUR repos', async () => {
    const env = {
      OPENALICE_PUBLISH_NPM: 'true',
      OPENALICE_PUBLISH_HOMEBREW: 'true',
      OPENALICE_PUBLISH_AUR: 'true',
      NPM_TOKEN: 'npm-secret',
      HOMEBREW_TAP_TOKEN: 'tap-secret',
      AUR_SSH_PRIVATE_KEY: 'aur-secret',
      AUR_KNOWN_HOSTS: 'aur.example ssh-ed25519 key',
    }
    const fetchImpl = vi.fn(async (url) => {
      if (url.endsWith('/-/whoami')) return response(200, { username: 'alice-release' })
      if (url.includes('api.github.com')) return response(200, { permissions: { push: false } })
      return response(404, {})
    })

    await expect(preflightPublicCliAuthority({
      env,
      fetchImpl,
      verifyAur: vi.fn(async () => { throw new Error('AUR repository is unavailable') }),
      logger: { log: vi.fn() },
    })).rejects.toThrow(new RegExp([
      'npm package name openalice is not reserved',
      'HOMEBREW_TAP_TOKEN does not have push authority',
      'AUR repository is unavailable',
    ].join('[\\s\\S]*')))
  })
})
