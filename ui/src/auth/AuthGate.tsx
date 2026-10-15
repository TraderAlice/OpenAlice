/**
 * AuthGate — branches the render tree on AuthContext state.
 *
 * Sits between `<AuthProvider>` (which holds the state) and `<App>`
 * (which assumes the user is in). Critical that `<App>` only mounts in
 * the 'authed' branch — otherwise its SSE / WebSocket / interval-poll
 * effects start firing against an unauthed backend and produce a
 * cascade of 401-driven retries.
 */

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { CloudOff, RefreshCw, ServerOff } from 'lucide-react'
import { useAuth } from './AuthContext'
import { LoginPage, NoTokenPage } from './LoginPage'
import { Spinner } from '../components/StateViews'
import { Button } from '../components/ui/button'
import { useWindowsChrome } from '../hooks/useWindowsChrome'
import { useConnectionLifecycle } from '../hooks/useConnectionLifecycle'
import type { RelayStatus } from '../hooks/useRelayConnection'
import { RelayConnectionChooser } from '../components/RelayConnectionChooser'
import { BackendOutageOverlayContext } from './BackendOutageOverlayContext'

export function BackendUnavailableScreen({
  retry,
  phase = 'backend-unavailable',
  relayStatus = null,
  retrying = false,
}: {
  retry: () => Promise<void>
  phase?: ReturnType<typeof useConnectionLifecycle>['phase']
  relayStatus?: RelayStatus | null
  retrying?: boolean
}) {
  const { t } = useTranslation()
  const [chooserOpen, setChooserOpen] = useState(false)
  const dialogRef = useRef<HTMLDivElement>(null)
  const target = relayStatus?.target
  const targetName = target?.projectName ?? target?.project ?? ''
  const machineName = target?.machineName ?? target?.machine ?? ''
  const remote = target?.machine !== 'local' && !!target
  const eyebrowKey = phase === 'relay-unavailable' ? 'auth.relayUnavailableEyebrow'
    : phase === 'target-reconnecting' ? 'auth.targetReconnectingEyebrow'
      : phase === 'target-unavailable' ? 'auth.targetUnavailableEyebrow'
        : phase === 'target-missing' ? 'auth.targetMissingEyebrow'
        : 'auth.backendUnavailableEyebrow'
  const headingKey = phase === 'relay-unavailable' ? 'auth.relayUnavailableHeading'
    : phase === 'target-reconnecting' ? 'auth.targetReconnectingHeading'
      : phase === 'target-unavailable' ? 'auth.targetUnavailableHeading'
        : phase === 'target-missing' ? 'auth.targetMissingHeading'
          : 'auth.backendUnavailableHeading'
  const descriptionKey = phase === 'relay-unavailable' ? 'auth.relayUnavailableDescription'
    : phase === 'target-reconnecting' ? 'auth.targetReconnectingDescription'
      : phase === 'target-unavailable' ? 'auth.targetUnavailableDescription'
        : phase === 'target-missing' ? 'auth.targetMissingDescription'
          : 'auth.backendUnavailableDescription'

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
        <div className="mb-5 flex h-12 w-12 items-center justify-center text-destructive">
          {phase === 'relay-unavailable' ? <CloudOff aria-hidden className="h-7 w-7" /> : <ServerOff aria-hidden className="h-7 w-7" />}
        </div>

        <p className="mb-2 text-[12px] font-medium text-destructive">
          {t(eyebrowKey)}
        </p>
        <h1 id="backend-unavailable-title" className="max-w-[560px] break-words text-2xl font-semibold leading-tight text-foreground sm:text-3xl">
          {t(headingKey, { target: targetName })}
        </h1>
        <p id="backend-unavailable-description" className="mt-4 max-w-[560px] text-[14px] leading-6 text-muted-foreground sm:text-[15px]">
          {t(descriptionKey, { target: targetName, machine: machineName })}
        </p>

        {target && <div className="mt-5 flex flex-wrap gap-x-5 gap-y-1 text-[12px] text-muted-foreground">
          <span>{t('auth.activeMachine')}: <strong className="font-medium text-foreground">{machineName}</strong></span>
          <span>{t('auth.activeProject')}: <strong className="font-medium text-foreground">{targetName}</strong></span>
        </div>}

        <div className="oa-status-surface mt-7 rounded-lg border border-border bg-secondary/55 px-4 py-4 sm:px-5">
          <div role="status" aria-live="polite" className="flex items-start gap-3">
            <Spinner size="sm" />
            <div className="min-w-0">
              <p className="break-words text-[13px] font-medium text-foreground">
                {t(phase === 'relay-unavailable' ? 'auth.reconnectingRelay' : remote ? 'auth.reconnectingRemote' : 'auth.reconnecting', { target: machineName })}
              </p>
              <p className="mt-1 text-[12px] leading-5 text-muted-foreground">
                {t('auth.backendUnavailableImpact')}
              </p>
            </div>
          </div>
        </div>

        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
          <Button
            type="button"
            onClick={() => void retry()}
            disabled={retrying}
            className="min-h-10 px-4"
          >
            <RefreshCw aria-hidden className="h-4 w-4" />
            {t('auth.retryNow')}
          </Button>
          {relayStatus && <Button type="button" variant="outline" onClick={() => setChooserOpen(true)}>{t('settings.backendConnection.change')}</Button>}
          <p className="max-w-[390px] break-words text-[11px] leading-5 text-muted-foreground">
            {t(phase === 'relay-unavailable' ? 'auth.relayUnavailableHelp' : remote ? 'auth.targetUnavailableHelp' : 'auth.backendUnavailableHelp')}
          </p>
        </div>
        {chooserOpen && <RelayConnectionChooser open={chooserOpen} onOpenChange={setChooserOpen} initialStatus={relayStatus} />}
      </section>
    </div>
  )
}

export function AuthGate({ children, initialRelayStatus = null, relayExpected = false }: { children: ReactNode; initialRelayStatus?: RelayStatus | null; relayExpected?: boolean }) {
  useWindowsChrome()
  const { state, backendUnavailable } = useAuth()
  const connection = useConnectionLifecycle(initialRelayStatus, relayExpected)
  const [upgradeDialogActive, setUpgradeDialogActive] = useState(false)
  const showBackendOutage = backendUnavailable && !upgradeDialogActive

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
    <BackendOutageOverlayContext.Provider value={setUpgradeDialogActive}>
    <div className="relative h-full min-h-0">
      <div
        aria-hidden={showBackendOutage ? true : undefined}
        inert={showBackendOutage ? true : undefined}
        className="h-full min-h-0"
      >
        {content}
      </div>
      {showBackendOutage && <BackendUnavailableScreen retry={connection.retry} phase={connection.phase} relayStatus={connection.relayStatus} retrying={connection.retrying} />}
    </div>
    </BackendOutageOverlayContext.Provider>
  )
}
