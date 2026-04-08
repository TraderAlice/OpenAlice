import { createMiddleware } from 'hono/factory'
import { timingSafeEqual } from 'node:crypto'
import { readSecurityConfig } from '../../../core/config.js'

/**
 * Bearer token authentication middleware.
 *
 * Reads `apiToken` from security config on each request (hot-reload).
 * If no token is configured, all requests are allowed (local-only mode).
 * If a token is set, requires `Authorization: Bearer <token>` header.
 */
export function authMiddleware() {
  return createMiddleware(async (c, next) => {
    const { apiToken } = await readSecurityConfig()
    if (!apiToken) {
      return next()
    }

    const authHeader = c.req.header('Authorization')
    if (!authHeader?.startsWith('Bearer ')) {
      return c.json({ error: 'Unauthorized' }, 401)
    }

    const provided = authHeader.slice(7)
    if (!safeEqual(provided, apiToken)) {
      return c.json({ error: 'Unauthorized' }, 401)
    }

    return next()
  })
}

function safeEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a)
  const bBuf = Buffer.from(b)
  if (aBuf.length !== bBuf.length) return false
  return timingSafeEqual(aBuf, bBuf)
}
