/**
 * Auth middleware unit tests.
 *
 * Targets the in-process logic of `createAuthMiddleware` against the
 * playbook-defined cases in safe/playbooks/01-03. Uses Hono's test
 * client (no real HTTP server). The Node socket-level remoteAddress
 * is fed via a mocked `c.env.incoming.socket.remoteAddress`.
 */

import { describe, it, expect, beforeEach, beforeAll, afterAll } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Hono } from 'hono'
import {
  createAuthMiddleware,
  isLoopbackIp,
  isTrustedLocalOrigin,
  SESSION_COOKIE_NAME,
} from './auth.js'
import {
  createSession,
  revokeAllSessions,
  _reset,
} from '@/services/auth/session-store.js'

// These tests create real sessions through the store. Redirect it at a
// private temp file (OPENALICE_SESSIONS_FILE seam) so we neither clobber the
// operator's real data/config/sessions.json nor race session-store.spec.ts
// over the shared file under parallel runs.
let tmpDir: string

beforeAll(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'oa-auth-mw-'))
  process.env['OPENALICE_SESSIONS_FILE'] = join(tmpDir, 'sessions.json')
})

afterAll(async () => {
  delete process.env['OPENALICE_SESSIONS_FILE']
  await rm(tmpDir, { recursive: true, force: true })
})

function makeApp(opts: Parameters<typeof createAuthMiddleware>[0]) {
  const app = new Hono()
  app.use('*', createAuthMiddleware(opts))
  app.get('/api/trading/uta', (c) => c.json({ utas: [] }))
  app.post('/api/trading/uta/x/wallet/push', (c) => c.json({ ok: true }))
  app.get('/api/version', (c) => c.json({ ok: true }))
  app.post('/api/auth/login', (c) => c.json({ ok: true }))
  return app
}

function envWithIp(ip: string | undefined) {
  return { incoming: { socket: { remoteAddress: ip } } }
}

beforeEach(async () => {
  await _reset()
  await revokeAllSessions()
})

describe('isLoopbackIp', () => {
  it('accepts 127.0.0.1', () => expect(isLoopbackIp('127.0.0.1')).toBe(true))
  it('accepts ::1', () => expect(isLoopbackIp('::1')).toBe(true))
  it('accepts IPv4-mapped IPv6 loopback', () => {
    expect(isLoopbackIp('::ffff:127.0.0.1')).toBe(true)
    expect(isLoopbackIp('::ffff:127.0.0.5')).toBe(true)
  })
  it('accepts the entire 127.0.0.0/8 range', () => {
    expect(isLoopbackIp('127.0.0.5')).toBe(true)
    expect(isLoopbackIp('127.1.2.3')).toBe(true)
  })
  it('rejects public IPs', () => {
    expect(isLoopbackIp('203.0.113.5')).toBe(false)
    expect(isLoopbackIp('8.8.8.8')).toBe(false)
  })
  it('rejects RFC1918 private but non-loopback', () => {
    expect(isLoopbackIp('192.168.1.5')).toBe(false)
    expect(isLoopbackIp('10.0.0.5')).toBe(false)
  })
  it('strips IPv6 zone suffix', () => {
    expect(isLoopbackIp('::1%lo0')).toBe(true)
  })
  it('rejects empty / undefined', () => {
    expect(isLoopbackIp('')).toBe(false)
  })
})

describe('isTrustedLocalOrigin', () => {
  it('accepts local browser origins on any port', () => {
    expect(isTrustedLocalOrigin('http://127.0.0.1:47331')).toBe(true)
    expect(isTrustedLocalOrigin('http://localhost:5173')).toBe(true)
    expect(isTrustedLocalOrigin('https://[::1]:47331')).toBe(true)
    expect(isTrustedLocalOrigin('app://openalice')).toBe(true)
  })

  it('rejects public and malformed origins', () => {
    expect(isTrustedLocalOrigin('https://example.com')).toBe(false)
    expect(isTrustedLocalOrigin('null')).toBe(false)
  })
})

describe('auth middleware — playbook 01 (auth bypass)', () => {
  it('01.1: GET /api/trading/uta without cookie from non-localhost → 401', async () => {
    const app = makeApp({ trustedProxies: [], csrfTrustedOrigins: [] })
    const res = await app.request('/api/trading/uta', undefined, envWithIp('203.0.113.5'))
    expect(res.status).toBe(401)
  })

  it('01.2: POST mutation without cookie from non-localhost → 401', async () => {
    const app = makeApp({ trustedProxies: [], csrfTrustedOrigins: [] })
    const res = await app.request('/api/trading/uta/x/wallet/push', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    }, envWithIp('203.0.113.5'))
    expect(res.status).toBe(401)
  })

  it('01.3: forged cookie → 401', async () => {
    const app = makeApp({ trustedProxies: [], csrfTrustedOrigins: [] })
    const res = await app.request('/api/trading/uta', {
      headers: { cookie: `${SESSION_COOKIE_NAME}=clearly-not-real` },
    }, envWithIp('203.0.113.5'))
    expect(res.status).toBe(401)
  })

  it('valid session cookie → 200', async () => {
    const session = await createSession()
    const app = makeApp({ trustedProxies: [], csrfTrustedOrigins: [] })
    const res = await app.request('/api/trading/uta', {
      headers: { cookie: `${SESSION_COOKIE_NAME}=${session.sid}` },
    }, envWithIp('203.0.113.5'))
    expect(res.status).toBe(200)
  })

  it('localhost (true loopback) bypasses without cookie → 200', async () => {
    const app = makeApp({ trustedProxies: [], csrfTrustedOrigins: [] })
    const res = await app.request('/api/trading/uta', undefined, envWithIp('127.0.0.1'))
    expect(res.status).toBe(200)
  })

  it('::1 bypasses without cookie → 200', async () => {
    const app = makeApp({ trustedProxies: [], csrfTrustedOrigins: [] })
    const res = await app.request('/api/trading/uta', undefined, envWithIp('::1'))
    expect(res.status).toBe(200)
  })

  it('loopback browser origin keeps the localhost bypass', async () => {
    const app = makeApp({ trustedProxies: [], csrfTrustedOrigins: [] })
    const res = await app.request('/api/trading/uta', {
      headers: { origin: 'http://127.0.0.1:40123' },
    }, envWithIp('127.0.0.1'))
    expect(res.status).toBe(200)
  })

  it('public browser origin cannot inherit the localhost bypass', async () => {
    const app = makeApp({ trustedProxies: [], csrfTrustedOrigins: [] })
    const res = await app.request('/api/trading/uta', {
      headers: { origin: 'https://evil.example' },
    }, envWithIp('127.0.0.1'))
    expect(res.status).toBe(401)
  })

  it('public route /api/version is accessible without cookie or localhost', async () => {
    const app = makeApp({ trustedProxies: [], csrfTrustedOrigins: [] })
    const res = await app.request('/api/version', undefined, envWithIp('203.0.113.5'))
    expect(res.status).toBe(200)
  })

  it('public route /api/auth/login accessible without cookie', async () => {
    const app = makeApp({ trustedProxies: [], csrfTrustedOrigins: [] })
    const res = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    }, envWithIp('203.0.113.5'))
    expect(res.status).toBe(200)  // public route reaches handler; handler validates token
  })

  it('empty cookie value treated as "no session" → 401', async () => {
    const app = makeApp({ trustedProxies: [], csrfTrustedOrigins: [] })
    const res = await app.request('/api/trading/uta', {
      headers: { cookie: `${SESSION_COOKIE_NAME}=` },
    }, envWithIp('203.0.113.5'))
    expect(res.status).toBe(401)
  })
})

describe('auth middleware — playbook 03 (localhost spoofing)', () => {
  it('03.1: X-Forwarded-For: 127.0.0.1 from non-trusted proxy → ignored', async () => {
    // No trusted proxy configured. Public IP attacker tries to spoof
    // localhost via XFF header. Must NOT bypass.
    const app = makeApp({ trustedProxies: [], csrfTrustedOrigins: [] })
    const res = await app.request('/api/trading/uta', {
      headers: { 'x-forwarded-for': '127.0.0.1' },
    }, envWithIp('203.0.113.5'))
    expect(res.status).toBe(401)
  })

  it('03.4: when trusted proxy is configured, localhost passthrough disabled entirely', async () => {
    // With a trusted proxy configured, even a true-localhost socket
    // remoteAddress doesn't grant bypass — because the trusted proxy IS
    // at 127.0.0.1 from Alice's view, accepting localhost would let
    // every public request through.
    const app = makeApp({ trustedProxies: ['10.0.0.5'], csrfTrustedOrigins: [] })
    const res = await app.request('/api/trading/uta', undefined, envWithIp('127.0.0.1'))
    expect(res.status).toBe(401)
  })

  it('Host: localhost spoof does not grant bypass', async () => {
    const app = makeApp({ trustedProxies: [], csrfTrustedOrigins: [] })
    const res = await app.request('/api/trading/uta', {
      headers: { host: 'localhost' },
    }, envWithIp('203.0.113.5'))
    expect(res.status).toBe(401)
  })
})

describe('auth middleware — playbook 02 (CSRF)', () => {
  it('02.1: cross-origin POST with bad Origin → 403', async () => {
    const session = await createSession()
    const app = makeApp({ trustedProxies: [], csrfTrustedOrigins: [] })
    const res = await app.request('/api/trading/uta/x/wallet/push', {
      method: 'POST',
      headers: {
        'cookie': `${SESSION_COOKIE_NAME}=${session.sid}`,
        'origin': 'http://evil.example.com',
        'host': 'localhost:47331',
        'content-type': 'application/json',
      },
      body: '{}',
    }, envWithIp('203.0.113.5'))
    expect(res.status).toBe(403)
  })

  it('02.1+: same-origin POST passes Origin check', async () => {
    const session = await createSession()
    const app = makeApp({ trustedProxies: [], csrfTrustedOrigins: [] })
    const res = await app.request('/api/trading/uta/x/wallet/push', {
      method: 'POST',
      headers: {
        'cookie': `${SESSION_COOKIE_NAME}=${session.sid}`,
        'origin': 'http://localhost:47331',
        'host': 'localhost:47331',
        'content-type': 'application/json',
      },
      body: '{}',
    }, envWithIp('203.0.113.5'))
    expect(res.status).toBe(200)
  })

  it('explicitly trusted Origin allowed cross-origin', async () => {
    const session = await createSession()
    const app = makeApp({
      trustedProxies: [],
      csrfTrustedOrigins: ['http://demo.openalice.io'],
    })
    const res = await app.request('/api/trading/uta/x/wallet/push', {
      method: 'POST',
      headers: {
        'cookie': `${SESSION_COOKIE_NAME}=${session.sid}`,
        'origin': 'http://demo.openalice.io',
        'host': 'localhost:47331',
        'content-type': 'application/json',
      },
      body: '{}',
    }, envWithIp('203.0.113.5'))
    expect(res.status).toBe(200)
  })

  it('CSRF check does NOT apply to GET (read-only)', async () => {
    const session = await createSession()
    const app = makeApp({ trustedProxies: [], csrfTrustedOrigins: [] })
    const res = await app.request('/api/trading/uta', {
      headers: {
        'cookie': `${SESSION_COOKIE_NAME}=${session.sid}`,
        'origin': 'http://evil.example.com',
        'host': 'localhost:47331',
      },
    }, envWithIp('203.0.113.5'))
    expect(res.status).toBe(200)  // GET is safe even with foreign Origin
  })

  it('mutating request without Origin header → allowed (CLI scenario)', async () => {
    const session = await createSession()
    const app = makeApp({ trustedProxies: [], csrfTrustedOrigins: [] })
    const res = await app.request('/api/trading/uta/x/wallet/push', {
      method: 'POST',
      headers: {
        'cookie': `${SESSION_COOKIE_NAME}=${session.sid}`,
        'content-type': 'application/json',
      },
      body: '{}',
    }, envWithIp('203.0.113.5'))
    expect(res.status).toBe(200)
  })
})

describe('auth middleware — SPA shell exception', () => {
  // Same setup as the protected-route app but with non-API routes
  // registered, so we can verify the SPA shell can be reached without
  // a session (otherwise the React bundle never loads and the user
  // can't even see the login page).
  function makeSPAApp() {
    const app = new Hono()
    app.use('*', createAuthMiddleware({ trustedProxies: [], csrfTrustedOrigins: [] }))
    app.get('/', (c) => c.html('<html>spa</html>'))
    app.get('/inbox', (c) => c.html('<html>spa</html>'))
    app.get('/workspaces/abc', (c) => c.html('<html>spa</html>'))
    app.get('/api/trading/uta', (c) => c.json({ utas: [] }))
    app.post('/api/trading/uta/x/wallet/push', (c) => c.json({ ok: true }))
    return app
  }

  it('GET / (SPA root) is public — even from a foreign IP, no cookie', async () => {
    const app = makeSPAApp()
    const res = await app.request('/', undefined, envWithIp('203.0.113.5'))
    expect(res.status).toBe(200)
  })

  it('GET /inbox (SPA deep-link) is public', async () => {
    const app = makeSPAApp()
    const res = await app.request('/inbox', undefined, envWithIp('203.0.113.5'))
    expect(res.status).toBe(200)
  })

  it('GET /workspaces/abc (SPA route with param) is public', async () => {
    const app = makeSPAApp()
    const res = await app.request('/workspaces/abc', undefined, envWithIp('203.0.113.5'))
    expect(res.status).toBe(200)
  })

  it('GET /api/trading/uta is STILL gated — SPA exception is GET-only on non-/api', async () => {
    const app = makeSPAApp()
    const res = await app.request('/api/trading/uta', undefined, envWithIp('203.0.113.5'))
    expect(res.status).toBe(401)
  })

  it('POST to a non-api path is STILL gated — SPA exception is GET-only', async () => {
    const app = makeSPAApp()
    const res = await app.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    }, envWithIp('203.0.113.5'))
    // No route defined for POST / so Hono will 404, but the important
    // thing is the middleware shouldn't have let it through. We check
    // by registering POST / and verifying 401:
    expect([401, 404]).toContain(res.status)
  })

  it('explicit non-GET non-api POST is gated to 401 when route exists', async () => {
    const app = new Hono()
    app.use('*', createAuthMiddleware({ trustedProxies: [], csrfTrustedOrigins: [] }))
    app.post('/custom-post', (c) => c.json({ ok: true }))
    const res = await app.request('/custom-post', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    }, envWithIp('203.0.113.5'))
    expect(res.status).toBe(401)
  })
})

describe('auth middleware — bypass switch', () => {
  it('disabled: true → no checks fire, any request passes', async () => {
    const app = makeApp({ trustedProxies: [], csrfTrustedOrigins: [], disabled: true })
    const res = await app.request('/api/trading/uta', undefined, envWithIp('203.0.113.5'))
    expect(res.status).toBe(200)
  })
})
