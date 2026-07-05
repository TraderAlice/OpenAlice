/**
 * AuthGate — branches the render tree on AuthContext state.
 *
 * Sits between `<AuthProvider>` (which holds the state) and `<App>`
 * (which assumes the user is in). Critical that `<App>` only mounts in
 * the 'authed' branch — otherwise its SSE / WebSocket / interval-poll
 * effects start firing against an unauthed backend and produce a
 * cascade of 401-driven retries.
 */

import type { ReactNode } from 'react'
import { useAuth } from './AuthContext'
import { LoginPage, NoTokenPage } from './LoginPage'
import { Spinner } from '../components/StateViews'

export function AuthGate({ children }: { children: ReactNode }) {
  const { state } = useAuth()

  if (state === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-bg">
        <Spinner />
      </div>
    )
  }
  if (state === 'login-required') return <LoginPage />
  if (state === 'no-token') return <NoTokenPage />
  return <>{children}</>
}
