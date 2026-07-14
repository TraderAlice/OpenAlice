/**
 * Auth middleware — the single gate between the public internet and the
 * rest of Alice's HTTP surface.
 *
 * Order of operations on every request:
 *   1. Public allowlist  — `/api/auth/*`, `/api/version`, static assets,
 *                          MCP routes (own protection).
 *   2. Localhost trust   — true-loopback bypass when no trusted proxy is
 *                          configured. Carefully NOT spoofable through
 *                          X-Forwarded-For unless an explicit trusted
 *                          proxy IP is in `OPENALICE_TRUSTED_PROXIES`.
 *   3. Session cookie    — looked up in sessions.json, expiry checked,
 *                          window slid forward on use.
 *   4. CSRF Origin check — mutating methods (POST/PUT/DELETE/PATCH) must
 *                          carry an Origin header that matches the
 *                          configured allowlist.
 *
 * Reference: `safe/playbooks/01-auth-bypass.md`, `safe/playbooks/02-csrf-cross-origin.md`,
 * `safe/playbooks/03-localhost-spoofing.md`.
 */

import type { Context, MiddlewareHandler } from 'hono'
import { validateAndTouch } from '@/services/auth/index.js'

export const SESSION_COOKIE_NAME = 'alice_session'

/** Routes that NEVER require auth (the public surface). */
const PUBLIC_PATH_EXACT = new Set([
  '/api/auth/login',
  '/api/auth/logout',
  '/api/auth/status',
  '/api/version',
])

/** Path prefixes that NEVER require auth. */
const PUBLIC_PATH_PREFIX = [
  '/login',           // UI login page (served by Vite or static)
  '/favicon',         // favicon.ico, favicon-*.png, etc.
  '/assets/',         // bundled UI static assets
  '/mcp',             // MCP transport — has its own protection model
] as const

const MUTATING_METHODS = new Set(['POST', 'PUT', 'DELETE', 'PATCH'])

export interface AuthMiddlewareOptions {
  /** Trusted proxy IPs (e.g., ["10.0.0.5"]). Empty = no trusted proxy. */
  trustedProxies: string[]
  /** Additional allowed Origins for cross-origin mutating requests. */
  csrfTrustedOrigins: string[]
  /** Set true to disable auth (dev / test). Default false. */
  disabled?: boolean
}

export function createAuthMiddleware(opts: AuthMiddlewareOptions): MiddlewareHandler {
  const trustedProxies = new Set(opts.trustedProxies)
  const csrfTrustedOrigins = new Set(opts.csrfTrustedOrigins)

  return async (c: Context, next) => {
    if (opts.disabled) return next()

    const path = c.req.path

    if (PUBLIC_PATH_EXACT.has(path)) return next()
    if (PUBLIC_PATH_PREFIX.some((p) => path.startsWith(p))) return next()

    // SPA shell — any GET to a non-API path is public. The React bundle
    // is the entity that decides "render the login page vs the app" by
    // polling /api/auth/status; if we 401 the HTML itself, the user
    // can't even reach the login UI. Mutations and any /api/* still
    // require a session.
    if (c.req.method === 'GET' && !path.startsWith('/api/')) {
      return next()
    }

    // Localhost passthrough — only honored when no trusted proxy is
    // configured. With a trusted proxy in front, the proxy IS at 127.0.0.1
    // from Alice's view, so trusting "localhost requests" would let every
    // public request through. See safe/playbooks/03-localhost-spoofing.md.
    if (trustedProxies.size === 0) {
      const clientIp = getSocketRemoteAddress(c)
      const origin = c.req.header('origin')
      if (clientIp && isLoopbackIp(clientIp) && (!origin || isTrustedLocalOrigin(origin))) {
        return next()
      }
    }

    // Session cookie check
    const sid = readSessionCookie(c.req.header('cookie') ?? '')
    if (!sid) {
      return c.json({ error: 'Unauthorized', code: 'NO_SESSION' }, 401)
    }
    const session = await validateAndTouch(sid)
    if (!session) {
      return c.json({ error: 'Unauthorized', code: 'INVALID_SESSION' }, 401)
    }

    // CSRF — Origin check on state-changing methods. SameSite=Lax cookie
    // catches most of these already, but a malicious page hosted same-site
    // (e.g., XSS on a sibling subdomain) could still issue authenticated
    // mutations. Explicit Origin enforcement is the second layer.
    if (MUTATING_METHODS.has(c.req.method)) {
      const origin = c.req.header('origin')
      if (origin) {
        if (!isAllowedOrigin(origin, c, csrfTrustedOrigins)) {
          return c.json({ error: 'Forbidden: origin not allowed', code: 'CSRF_ORIGIN' }, 403)
        }
      }
      // Origin header absent on POST is common from non-browser callers
      // (curl, Telegram bot, server-to-server). We allow it — only reject
      // when an Origin IS provided and is wrong. A future tightening could
      // require Origin for browser-typical mutating requests, but it would
      // break legitimate CLI use.
    }

    // Attach session to context for downstream handlers
    c.set('session', session)
    return next()
  }
}

/** Extracts the Node socket-level remote address from the Hono context. */
export function getSocketRemoteAddress(c: Context): string | undefined {
  // @hono/node-server exposes the raw Node IncomingMessage as c.env.incoming
  const env = c.env as { incoming?: { socket?: { remoteAddress?: string } } } | undefined
  return env?.incoming?.socket?.remoteAddress
}

/**
 * Normalize an IP literal for comparison: strip the IPv6 zone suffix
 * (fe80::1%eth0 → fe80::1) and unwrap IPv4-mapped IPv6
 * (::ffff:10.0.0.5 → 10.0.0.5).
 */
export function normalizeIp(ip: string): string {
  const cleaned = ip.split('%')[0]
  return cleaned.startsWith('::ffff:') ? cleaned.slice(7) : cleaned
}

/**
 * Returns true if the given IP literal is a loopback address. Handles
 * IPv4 (127.0.0.0/8), IPv6 (::1), and IPv4-mapped IPv6 (::ffff:127.x.x.x).
 */
export function isLoopbackIp(ip: string): boolean {
  if (!ip) return false
  const norm = normalizeIp(ip)
  if (norm === '::1') return true
  // IPv4 — accept the entire 127.0.0.0/8 range, not just 127.0.0.1
  if (/^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(norm)) return true
  return false
}

/** Browser origins that are owned by a local OpenAlice surface. This keeps
 * localhost, Vite, and the packaged Electron app frictionless without letting
 * an arbitrary public page inherit the socket-level loopback bypass (including
 * while an SSH tunnel is open). */
export function isTrustedLocalOrigin(origin: string): boolean {
  try {
    const url = new URL(origin)
    if (url.protocol === 'app:' && url.hostname === 'openalice') return true
    return (url.protocol === 'http:' || url.protocol === 'https:') && (
      url.hostname === 'localhost' ||
      url.hostname === '127.0.0.1' ||
      url.hostname === '[::1]'
    )
  } catch {
    return false
  }
}

function readSessionCookie(cookieHeader: string): string | null {
  if (!cookieHeader) return null
  const pairs = cookieHeader.split(';')
  for (const raw of pairs) {
    const entry = raw.trim()
    const eq = entry.indexOf('=')
    if (eq < 0) continue
    const name = entry.slice(0, eq)
    if (name === SESSION_COOKIE_NAME) {
      const value = entry.slice(eq + 1).trim()
      // Empty value is "no session" — explicitly do NOT treat empty
      // string as a valid SID. See safe/playbooks/01-auth-bypass.md.
      return value.length > 0 ? decodeURIComponent(value) : null
    }
  }
  return null
}

function isAllowedOrigin(origin: string, c: Context, trustedOrigins: Set<string>): boolean {
  // Same-origin: Origin's host matches our Host header.
  const host = c.req.header('host')
  if (host) {
    try {
      const o = new URL(origin)
      if (o.host === host) return true
    } catch {
      return false
    }
  }
  // Explicitly trusted via env (cloud-demo cross-origin scenarios).
  return trustedOrigins.has(origin)
}
