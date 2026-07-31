/**
 * AuthGate — branches the render tree on AuthContext state.
 *
 * Sits between `<AuthProvider>` (which holds the state) and `<App>`
 * (which assumes the user is in). Critical that `<App>` only mounts in
 * the 'authed' branch — otherwise its SSE / WebSocket / interval-poll
 * effects start firing against an unauthed backend and produce a
 * cascade of 401-driven retries.
 */

import { useEffect, useRef, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { CloudOff, RefreshCw } from 'lucide-react'
import { useAuth } from './AuthContext'
import { LoginPage, NoTokenPage } from './LoginPage'
import { Spinner } from '../components/StateViews'

function BackendUnavailableScreen({ retry }: { retry: () => Promise<void> }) {
  const { t } = useTranslation()
  const dialogRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    dialogRef.current?.focus({ preventScroll: true })
  }, [])

  return (
    <div
      ref={dialogRef}
      role="alertdialog"
      tabIndex={-1}
      aria-modal="true"
      aria-labelledby="backend-unavailable-title"
      aria-describedby="backend-unavailable-description"
      className="fixed inset-0 z-[100] flex min-h-dvh items-start justify-start overflow-y-auto bg-background px-5 py-10"
    >
      <section className="oa-view-enter mx-auto my-auto w-full max-w-[620px]">
        <div className="mb-6 flex h-14 w-14 items-center justify-center rounded-xl border border-destructive/25 bg-destructive/[0.08] text-destructive">
          <CloudOff aria-hidden className="h-7 w-7" />
        </div>

        <p className="mb-3 font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-destructive">
          {t('auth.backendUnavailableEyebrow')}
        </p>
        <h1 id="backend-unavailable-title" className="max-w-[560px] text-2xl font-semibold leading-tight text-foreground sm:text-3xl">
          {t('auth.backendUnavailableHeading')}
        </h1>
        <p id="backend-unavailable-description" className="mt-4 max-w-[560px] text-[14px] leading-6 text-muted-foreground sm:text-[15px]">
          {t('auth.backendUnavailableDescription')}
        </p>

        <div className="oa-status-surface mt-7 rounded-xl border border-border bg-secondary/55 px-4 py-4 sm:px-5">
          <div role="status" aria-live="polite" className="flex items-start gap-3">
            <Spinner size="sm" />
            <div className="min-w-0">
              <p className="text-[13px] font-medium text-foreground">{t('auth.reconnecting')}</p>
              <p className="mt-1 text-[12px] leading-5 text-muted-foreground">
                {t('auth.backendUnavailableImpact')}
              </p>
            </div>
          </div>
        </div>

        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
          <button
            type="button"
            onClick={() => void retry()}
            className="btn-primary oa-pressable inline-flex min-h-10 items-center justify-center gap-2 px-4"
          >
            <RefreshCw aria-hidden className="h-4 w-4" />
            {t('auth.retryNow')}
          </button>
          <p className="max-w-[390px] text-[11px] leading-5 text-muted-foreground">
            {t('auth.backendUnavailableHelp')}
          </p>
        </div>
      </section>
    </div>
  )
}

export function AuthGate({ children }: { children: ReactNode }) {
  const { state, backendUnavailable, refresh } = useAuth()

  if (state === 'loading' && !backendUnavailable) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background text-muted-foreground">
        <Spinner />
      </div>
    )
  }

  const content = state === 'login-required'
    ? <LoginPage />
    : state === 'no-token'
      ? <NoTokenPage />
      : state === 'authed'
        ? children
        : null

  return (
    <div className="relative h-full min-h-0">
      <div
        aria-hidden={backendUnavailable ? true : undefined}
        inert={backendUnavailable ? true : undefined}
        className="h-full min-h-0"
      >
        {content}
      </div>
      {backendUnavailable && <BackendUnavailableScreen retry={refresh} />}
    </div>
  )
}
