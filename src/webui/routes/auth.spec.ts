/**
 * Auth route tests — focused on the session-cookie `Secure` flag and
 * X-Forwarded-* trust gating in /api/auth/login.
 *
 * The rule under test: forwarded headers are honored only when the
 * socket peer is a configured trusted proxy. Otherwise any client could
 * send `X-Forwarded-Proto: https` over plain HTTP and coerce a `Secure`
 * cookie the browser would then drop (login appears broken).
 *
 * `verifyToken` is mocked so these tests don't write data/config/auth.json
 * (token-store.spec.ts owns that file; parallel workers would race).
 * Sessions go to a private temp file via the OPENALICE_SESSIONS_FILE seam.
 */

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Hono } from 'hono'

vi.mock('@/services/auth/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/auth/index.js')>()
  return {
    ...actual,
    verifyToken: vi.fn(async (token: string) => token === 'test-admin-token'),
  }
})

import { createAuthRoutes, type AuthRouteOptions } from './auth.js'
import { _reset, revokeAllSessions } from '@/services/auth/session-store.js'

let tmpDir: string

beforeAll(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'oa-auth-routes-'))
  process.env['OPENALICE_SESSIONS_FILE'] = join(tmpDir, 'sessions.json')
})

afterAll(async () => {
  delete process.env['OPENALICE_SESSIONS_FILE']
  await rm(tmpDir, { recursive: true, force: true })
})

beforeEach(async () => {
  await _reset()
  await revokeAllSessions()
})

function makeApp(opts: AuthRouteOptions = {}) {
  const app = new Hono()
  app.route('/api/auth', createAuthRoutes(opts))
  return app
}

function envWithIp(ip: string) {
  return { incoming: { socket: { remoteAddress: ip } } }
}

async function login(
  app: Hono,
  ip: string,
  headers: Record<string, string> = {},
): Promise<Response> {
  return app.request('/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify({ token: 'test-admin-token' }),
  }, envWithIp(ip))
}

describe('login cookie Secure flag — X-Forwarded-Proto trust gating', () => {
  it('XFP https from a non-proxy peer is ignored → cookie NOT Secure', async () => {
    const app = makeApp({ trustedProxies: [] })
    const res = await login(app, '203.0.113.5', { 'x-forwarded-proto': 'https' })
    expect(res.status).toBe(200)
    const cookie = res.headers.get('set-cookie') ?? ''
    expect(cookie).toContain('alice_session=')
    expect(cookie).not.toMatch(/;\s*Secure/i)
  })

  it('XFP https from the trusted proxy → cookie Secure', async () => {
    const app = makeApp({ trustedProxies: ['10.0.0.5'] })
    const res = await login(app, '10.0.0.5', { 'x-forwarded-proto': 'https' })
    expect(res.status).toBe(200)
    expect(res.headers.get('set-cookie') ?? '').toMatch(/;\s*Secure/i)
  })

  it('trusted proxy peer matches IPv4-mapped IPv6 socket address', async () => {
    const app = makeApp({ trustedProxies: ['10.0.0.5'] })
    const res = await login(app, '::ffff:10.0.0.5', { 'x-forwarded-proto': 'https' })
    expect(res.headers.get('set-cookie') ?? '').toMatch(/;\s*Secure/i)
  })

  it('XFP https from an untrusted peer while a proxy IS configured → NOT Secure', async () => {
    const app = makeApp({ trustedProxies: ['10.0.0.5'] })
    const res = await login(app, '203.0.113.5', { 'x-forwarded-proto': 'https' })
    expect(res.headers.get('set-cookie') ?? '').not.toMatch(/;\s*Secure/i)
  })

  it('trusted proxy without XFP (plain-HTTP upstream) → NOT Secure', async () => {
    const app = makeApp({ trustedProxies: ['10.0.0.5'] })
    const res = await login(app, '10.0.0.5')
    expect(res.headers.get('set-cookie') ?? '').not.toMatch(/;\s*Secure/i)
  })

  it('forceSecureCookie: true overrides detection', async () => {
    const app = makeApp({ forceSecureCookie: true })
    const res = await login(app, '203.0.113.5')
    expect(res.headers.get('set-cookie') ?? '').toMatch(/;\s*Secure/i)
  })

  it('wrong token still 401s (mock sanity check)', async () => {
    const app = makeApp()
    const res = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: 'wrong' }),
    }, envWithIp('203.0.113.5'))
    expect(res.status).toBe(401)
    expect(res.headers.get('set-cookie')).toBeNull()
  })
})

describe('auth status localhost boundary', () => {
  it('accepts a local page through a loopback socket', async () => {
    const app = makeApp()
    const res = await app.request('/api/auth/status', {
      headers: { origin: 'http://127.0.0.1:40123' },
    }, envWithIp('127.0.0.1'))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ authed: true, passthrough: 'localhost' })
  })

  it('does not report localhost auth to a public browser origin', async () => {
    const app = makeApp()
    const res = await app.request('/api/auth/status', {
      headers: { origin: 'https://evil.example' },
    }, envWithIp('127.0.0.1'))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ authed: false })
  })
})
