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

export function AuthGate({ children }: { children: ReactNode }) {
  const { state } = useAuth()
  const { t } = useTranslation()

  if (state === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-bg">
        <div className="text-[12px] text-text-muted">{t('common.loading')}</div>
      </div>
    )
  }
  if (state === 'login-required') return <LoginPage />
  if (state === 'no-token') return <NoTokenPage />
  return <>{children}</>
}
