/**
 * AuthProvider — gates the entire app on a successful /api/auth/status check.
 *
 * Three terminal states (after the initial loading bounce):
 *
 *   - 'authed'         → render the app. Covers both real session cookies
 *                        AND the localhost passthrough (in dev, the backend
 *                        reports authed:true for true-loopback callers).
 *   - 'login-required' → tokenConfigured:true, authed:false → show LoginPage.
 *   - 'no-token'       → tokenConfigured:false — backend never bootstrapped
 *                        a token. Defensive: shouldn't happen because
 *                        bootstrap runs at boot. Shows a setup hint.
 *
 * A transport failure or 5xx is not a fourth auth decision: it preserves the
 * last confirmed state and retries. On a cold mount it stays in loading; once
 * authed it keeps the App mounted so backend hot reload cannot strand the UI.
 *
 * A global window-level `app:unauthorized` event flips the state back to
 * 'login-required' — `fetchJson` dispatches it on any 401 (see api/client.ts).
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { getStatus, type AuthStatus } from './api'

type AuthState = 'loading' | 'authed' | 'login-required' | 'no-token'

export const AUTH_RETRY_DELAYS_MS = [250, 500, 1_000, 2_000, 3_000] as const

export function authRetryDelayMs(attempt: number): number {
  const index = Math.max(0, Math.min(attempt - 1, AUTH_RETRY_DELAYS_MS.length - 1))
  return AUTH_RETRY_DELAYS_MS[index]
}

interface AuthContextValue {
  state: AuthState
  status: AuthStatus | null
  /** The last status check was inconclusive because Alice is unavailable.
   *  Keep the last confirmed auth decision while retrying. */
  backendUnavailable: boolean
  /** Re-check /api/auth/status. Called after login success. */
  refresh: () => Promise<void>
  /** Locally flip state to login-required (e.g. after logout). */
  markUnauthorized: () => void
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}

function deriveState(status: AuthStatus | null): AuthState {
  if (!status) return 'loading'
  if (status.authed) return 'authed'
  if (!status.tokenConfigured) return 'no-token'
  return 'login-required'
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus | null>(null)
  const [backendUnavailable, setBackendUnavailable] = useState(false)
  const [retryAttempt, setRetryAttempt] = useState(0)
  const mountedRef = useRef(false)
  const requestGenerationRef = useRef(0)
  const state = deriveState(status)

  const refresh = useCallback(async () => {
    const generation = ++requestGenerationRef.current
    try {
      const next = await getStatus()
      if (!mountedRef.current || generation !== requestGenerationRef.current) return
      setStatus(next)
      setBackendUnavailable(false)
      setRetryAttempt(0)
    } catch {
      if (!mountedRef.current || generation !== requestGenerationRef.current) return
      // Absence of an answer is not an authentication decision. Preserve the
      // last confirmed status (and therefore the mounted App) while Alice's
      // watch process comes back, then retry with a short capped backoff.
      setBackendUnavailable(true)
      setRetryAttempt((attempt) => attempt + 1)
    }
  }, [])

  const markUnauthorized = useCallback(() => {
    requestGenerationRef.current += 1
    setStatus({ authed: false, tokenConfigured: true })
    setBackendUnavailable(false)
    setRetryAttempt(0)
  }, [])

  useEffect(() => {
    mountedRef.current = true
    void refresh()
    return () => {
      mountedRef.current = false
      requestGenerationRef.current += 1
    }
  }, [refresh])

  useEffect(() => {
    if (!backendUnavailable) return
    const timer = window.setTimeout(() => {
      void refresh()
    }, authRetryDelayMs(retryAttempt))
    return () => window.clearTimeout(timer)
  }, [backendUnavailable, refresh, retryAttempt])

  // Wire the global unauthorized signal — any fetchJson 401 flips us
  // back to the login page, killing whatever the user was doing. This
  // is the right trade-off: stale UI on an expired session is worse
  // than a hard interrupt.
  useEffect(() => {
    const onUnauth = () => markUnauthorized()
    window.addEventListener('app:unauthorized', onUnauth)
    return () => window.removeEventListener('app:unauthorized', onUnauth)
  }, [markUnauthorized])

  return (
    <AuthContext.Provider value={{
      state,
      status,
      backendUnavailable,
      refresh,
      markUnauthorized,
    }}>
      {children}
    </AuthContext.Provider>
  )
}
