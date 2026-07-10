/**
 * Auth API client — talks to /api/auth/{login, logout, status}.
 *
 * Uses raw fetch (not `fetchJson`) because we need to inspect status codes
 * ourselves; 401 from the auth endpoints is meaningful, not an error to
 * funnel through the global unauthorized handler.
 */

export interface AuthStatus {
  authed: boolean
  tokenConfigured: boolean
  session?: { createdAt: string; lastSeenAt: string }
}

/** The auth backend could not answer authoritatively. This is deliberately
 * different from `{ authed: false }`: a restart window must never manufacture
 * a logout decision. */
export class AuthStatusUnavailableError extends Error {
  readonly status: number | null

  constructor(message: string, options: { status?: number; cause?: unknown } = {}) {
    super(message, { cause: options.cause })
    this.name = 'AuthStatusUnavailableError'
    this.status = options.status ?? null
  }
}

export async function getStatus(): Promise<AuthStatus> {
  let res: Response
  try {
    res = await fetch('/api/auth/status', { credentials: 'same-origin' })
  } catch (cause) {
    throw new AuthStatusUnavailableError('Auth status request failed', { cause })
  }
  if (res.status === 401) {
    return { authed: false, tokenConfigured: true }
  }
  if (!res.ok) {
    throw new AuthStatusUnavailableError(`Auth status returned HTTP ${res.status}`, {
      status: res.status,
    })
  }
  let body: unknown
  try {
    body = await res.json()
  } catch (cause) {
    throw new AuthStatusUnavailableError('Auth status returned invalid JSON', { cause })
  }
  if (
    typeof body !== 'object' || body === null ||
    typeof (body as Partial<AuthStatus>).authed !== 'boolean' ||
    typeof (body as Partial<AuthStatus>).tokenConfigured !== 'boolean'
  ) {
    throw new AuthStatusUnavailableError('Auth status returned an invalid payload')
  }
  return body as AuthStatus
}

export async function login(token: string): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({ token }),
  })
  if (res.ok) return { ok: true }
  const body = await res.json().catch(() => ({}))
  return { ok: false, error: body.error ?? `HTTP ${res.status}` }
}

export async function logout(): Promise<void> {
  await fetch('/api/auth/logout', {
    method: 'POST',
    credentials: 'same-origin',
  })
}
