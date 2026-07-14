/**
 * Auth routes: /api/auth/login, /api/auth/logout, /api/auth/status.
 *
 * Mounted in `src/webui/plugin.ts` BEFORE the auth middleware applies,
 * since these are the entry points to acquire a session.
 *
 * Status check (`/api/auth/status`) is bypass-friendly so the UI can
 * decide whether to render the login screen without a real authed call
 * round-trip. It reveals nothing beyond `{ authed: boolean }`.
 */

import { Hono, type Context } from 'hono'
import { setCookie, deleteCookie } from 'hono/cookie'
import { z } from 'zod'
import {
  verifyToken,
  createSession,
  revokeSession,
  validateAndTouch,
  getTokenInfo,
} from '@/services/auth/index.js'
import {
  SESSION_COOKIE_NAME,
  isLoopbackIp,
  isTrustedLocalOrigin,
  normalizeIp,
  getSocketRemoteAddress,
} from '../middleware/auth.js'

const loginSchema = z.object({
  token: z.string().min(1, 'token is required'),
})

export interface AuthRouteOptions {
  /** Should `Set-Cookie` mark the session cookie `Secure`? Set true in
   *  prod (HTTPS behind reverse proxy). Auto-detected from
   *  X-Forwarded-Proto when not provided — but only for requests
   *  arriving from a trusted proxy. */
  forceSecureCookie?: boolean
  /** Trusted reverse-proxy IPs. X-Forwarded-* headers are honored only
   *  when the request's socket peer is one of these — otherwise any
   *  client could send `X-Forwarded-Proto: https` over plain HTTP and
   *  coerce a `Secure` cookie the browser would then silently drop
   *  (login appears broken). Same list as the middleware's
   *  `trustedProxies`. */
  trustedProxies?: string[]
}

export function createAuthRoutes(opts: AuthRouteOptions = {}) {
  const app = new Hono()
  const trustedProxies = new Set((opts.trustedProxies ?? []).map(normalizeIp))

  /**
   * Returns whether the current request is authenticated, plus minimal
   * metadata. No-side-effect endpoint — does NOT extend session expiry.
   */
  app.get('/status', async (c) => {
    const tokenInfo = await getTokenInfo()

    // Mirror the middleware's localhost-trust passthrough: when no
    // trusted proxy is configured and the request came from a real
    // loopback socket, report authed:true even without a cookie. This
    // keeps `pnpm dev` zero-friction — the UI never bounces to the
    // login page in single-user local mode.
    if (trustedProxies.size === 0) {
      const remote = getSocketRemoteAddress(c) ?? ''
      const origin = c.req.header('origin')
      if (isLoopbackIp(remote) && (!origin || isTrustedLocalOrigin(origin))) {
        return c.json({ authed: true, tokenConfigured: tokenInfo.exists, passthrough: 'localhost' })
      }
    }

    const sid = readSidFromCookie(c.req.header('cookie') ?? '')
    if (!sid) {
      return c.json({ authed: false, tokenConfigured: tokenInfo.exists })
    }
    const session = await validateAndTouch(sid)
    if (!session) {
      return c.json({ authed: false, tokenConfigured: true })
    }
    return c.json({
      authed: true,
      tokenConfigured: true,
      session: {
        createdAt: session.createdAt,
        lastSeenAt: session.lastSeenAt,
        expiresAt: session.expiresAt,
      },
    })
  })

  /**
   * Accept an admin token, verify, issue a session cookie.
   *
   * Failures all return 401 with the same body to avoid leaking
   * "token configured vs not" via timing or content.
   */
  app.post('/login', async (c) => {
    const body = await c.req.json().catch(() => null)
    const parsed = loginSchema.safeParse(body)
    if (!parsed.success) {
      return c.json({ error: 'Invalid request' }, 400)
    }

    const ok = await verifyToken(parsed.data.token)
    if (!ok) {
      // Don't reveal whether the token was malformed vs wrong vs no auth
      // configured. Constant-ish behavior.
      return c.json({ error: 'Invalid token' }, 401)
    }

    const fromTrustedProxy = isTrustedProxyPeer(c, trustedProxies)
    const userAgent = c.req.header('user-agent') ?? undefined
    const ip = readClientIp(c, fromTrustedProxy) ?? undefined
    const session = await createSession({ userAgent, ip })

    const secure = opts.forceSecureCookie ?? (fromTrustedProxy && isForwardedHttps(c))
    setCookie(c, SESSION_COOKIE_NAME, session.sid, {
      httpOnly: true,
      sameSite: 'Lax',
      secure,
      path: '/',
      maxAge: Math.floor((new Date(session.expiresAt).getTime() - Date.now()) / 1000),
    })

    return c.json({ ok: true })
  })

  /**
   * Invalidate the caller's session server-side and clear the cookie.
   * Idempotent — calling without a cookie returns 200.
   */
  app.post('/logout', async (c) => {
    const sid = readSidFromCookie(c.req.header('cookie') ?? '')
    if (sid) await revokeSession(sid)
    deleteCookie(c, SESSION_COOKIE_NAME, { path: '/' })
    return c.json({ ok: true })
  })

  return app
}

function readSidFromCookie(cookieHeader: string): string | null {
  if (!cookieHeader) return null
  for (const raw of cookieHeader.split(';')) {
    const entry = raw.trim()
    const eq = entry.indexOf('=')
    if (eq < 0) continue
    if (entry.slice(0, eq) === SESSION_COOKIE_NAME) {
      const value = entry.slice(eq + 1).trim()
      return value.length > 0 ? decodeURIComponent(value) : null
    }
  }
  return null
}

/** True when the request's socket peer is one of the trusted proxy IPs. */
function isTrustedProxyPeer(c: Context, trustedProxies: ReadonlySet<string>): boolean {
  if (trustedProxies.size === 0) return false
  const remote = getSocketRemoteAddress(c)
  return remote ? trustedProxies.has(normalizeIp(remote)) : false
}

/**
 * Whether the trusted proxy says the original client request was HTTPS.
 * Only call after `isTrustedProxyPeer` — from any other peer the header
 * is attacker-controlled (see AuthRouteOptions.trustedProxies). Without
 * a proxy in front there is no TLS terminator, the connection is plain
 * HTTP, and `Secure` must not be set.
 */
function isForwardedHttps(c: Context): boolean {
  const proto = c.req.header('x-forwarded-proto')
  return proto?.split(',')[0]?.trim().toLowerCase() === 'https'
}

function readClientIp(c: Context, fromTrustedProxy: boolean): string | null {
  if (fromTrustedProxy) {
    const xff = c.req.header('x-forwarded-for')
    const first = xff?.split(',')[0]?.trim()
    if (first) return first
  }
  return getSocketRemoteAddress(c) ?? null
}
