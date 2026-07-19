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
import { useTranslation } from 'react-i18next'
import { useAuth } from './AuthContext'
import { LoginPage, NoTokenPage } from './LoginPage'
import { Spinner } from '../components/StateViews'

function ReconnectNotice() {
  const { t } = useTranslation()
  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed left-1/2 top-4 z-[80] flex -translate-x-1/2 items-center gap-2 rounded-lg border border-border bg-secondary/95 px-3 py-2 text-[12px] text-muted-foreground shadow-lg backdrop-blur-sm"
    >
      <Spinner size="sm" />
      <span>{t('auth.reconnecting')}</span>
    </div>
  )
}

export function AuthGate({ children }: { children: ReactNode }) {
  const { state, backendUnavailable } = useAuth()
  const { t } = useTranslation()

  if (state === 'loading') {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-3 bg-background text-[12px] text-muted-foreground">
        <Spinner />
        {backendUnavailable && <span role="status">{t('auth.reconnecting')}</span>}
      </div>
    )
  }
  return (
    <>
      {state === 'login-required' ? <LoginPage /> : state === 'no-token' ? <NoTokenPage /> : children}
      {backendUnavailable && <ReconnectNotice />}
    </>
  )
}
