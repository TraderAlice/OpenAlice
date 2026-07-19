import { useEffect, useMemo, useState } from 'react'
import { CheckCircle2, Download, ExternalLink, LoaderCircle, RefreshCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { api } from '../../api'
import type { VersionInfo } from '../../api/types'
import { ConfigSection } from '../form'

type RuntimeMode = 'browser' | 'electron-dev' | 'electron-packaged'
type NativeUpdaterStatus =
  | { phase: 'available'; version?: string; releaseUrl?: string }
  | { phase: 'downloading'; version?: string; percent?: number }
  | { phase: 'downloaded'; version: string; releaseUrl: string }
  | { phase: 'error'; message: string }

const RELEASES_URL = 'https://github.com/TraderAlice/OpenAlice/releases'

export function AboutOpenAliceSection() {
  const { t } = useTranslation()
  const [versionInfo, setVersionInfo] = useState<VersionInfo | null>(null)
  const [runtimeMode, setRuntimeMode] = useState<RuntimeMode>('browser')
  const [nativeStatus, setNativeStatus] = useState<NativeUpdaterStatus | null>(null)
  const [checking, setChecking] = useState(false)
  const [installing, setInstalling] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    void api.version.get()
      .then((next) => {
        if (active) setVersionInfo(next)
      })
      .catch(() => {
        if (active) setError(t('settings.about.checkError'))
      })

    const runtime = window.openAlice?.runtime
    if (runtime) {
      void runtime.info()
        .then((info) => {
          if (active) setRuntimeMode(info.mode)
        })
        .catch(() => {})
    }

    const updater = window.openAlice?.updater
    if (!updater) return () => { active = false }
    void updater.getStatus()
      .then((status) => {
        if (active && status) setNativeStatus(status)
      })
      .catch(() => {})
    const unsubscribe = updater.onStatus((status) => {
      if (active) setNativeStatus(status)
    })
    return () => {
      active = false
      unsubscribe()
    }
  }, [t])

  const currentVersion = versionInfo?.current ?? t('settings.about.versionLoading')
  const updateVersion = nativeStatus && 'version' in nativeStatus && nativeStatus.version
    ? nativeStatus.version
    : versionInfo?.hasUpdate
      ? versionInfo.latest
      : null
  const releaseUrl = nativeStatus && 'releaseUrl' in nativeStatus && nativeStatus.releaseUrl
    ? nativeStatus.releaseUrl
    : versionInfo?.releaseUrl ?? RELEASES_URL
  const channel = versionInfo?.current.includes('-') ? 'beta' : 'stable'

  const status = useMemo(() => {
    if (checking) {
      return { kind: 'checking' as const, text: t('settings.about.status.checking') }
    }
    if (nativeStatus?.phase === 'downloaded') {
      return {
        kind: 'ready' as const,
        text: t('settings.about.status.ready', { version: nativeStatus.version }),
      }
    }
    if (nativeStatus?.phase === 'downloading') {
      return {
        kind: 'checking' as const,
        text: typeof nativeStatus.percent === 'number'
          ? t('settings.about.status.downloadingProgress', { percent: Math.round(nativeStatus.percent) })
          : t('settings.about.status.downloading'),
      }
    }
    if (nativeStatus?.phase === 'available' || updateVersion) {
      return {
        kind: 'available' as const,
        text: updateVersion
          ? t('settings.about.status.available', { version: updateVersion })
          : t('settings.about.status.availableUnknown'),
      }
    }
    if (nativeStatus?.phase === 'error' || versionInfo?.error || error) {
      return { kind: 'error' as const, text: t('settings.about.status.error') }
    }
    if (versionInfo) {
      return { kind: 'current' as const, text: t('settings.about.status.current') }
    }
    return { kind: 'checking' as const, text: t('settings.about.status.loading') }
  }, [checking, error, nativeStatus, t, updateVersion, versionInfo])

  const checkForUpdates = async () => {
    setChecking(true)
    setError(null)
    try {
      const nativeCheck = window.openAlice?.updater?.checkForUpdates().catch(() => null)
      const [, next] = await Promise.all([
        nativeCheck ?? Promise.resolve(null),
        api.version.check(),
      ])
      setVersionInfo(next)
      if (next.error) setError(t('settings.about.checkError'))
    } catch {
      setError(t('settings.about.checkError'))
    } finally {
      setChecking(false)
    }
  }

  const openRelease = async () => {
    setError(null)
    try {
      const updater = window.openAlice?.updater
      if (updater) {
        await updater.openRelease(updateVersion ?? undefined)
      } else {
        window.open(releaseUrl, '_blank', 'noopener,noreferrer')
      }
    } catch {
      setError(t('settings.about.openReleaseError'))
    }
  }

  const installAndRestart = async () => {
    const updater = window.openAlice?.updater
    if (!updater) return
    setInstalling(true)
    setError(null)
    try {
      await updater.installAndRestart()
    } catch {
      setError(t('settings.about.installError'))
      setInstalling(false)
    }
  }

  const StatusIcon = status.kind === 'current'
    ? CheckCircle2
    : status.kind === 'ready'
      ? Download
      : status.kind === 'checking'
        ? LoaderCircle
        : RefreshCw
  const statusTone = status.kind === 'current'
    ? 'border-success/25 bg-success/10 text-success'
    : status.kind === 'error'
      ? 'border-destructive/25 bg-destructive/10 text-destructive'
      : 'border-primary/25 bg-primary-muted/30 text-primary'

  return (
    <ConfigSection title={t('settings.about.title')} description={t('settings.about.description')}>
      <div className="rounded-xl border border-border/70 bg-secondary/35 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-border bg-background shadow-sm">
              <img src="/alice.ico" alt="" className="h-8 w-8" />
            </div>
            <div className="min-w-0">
              <p className="text-[14px] font-semibold text-foreground">OpenAlice</p>
              <p className="mt-0.5 font-mono text-[12px] text-muted-foreground">v{currentVersion}</p>
            </div>
          </div>
          <div className="flex flex-wrap justify-end gap-1.5">
            <span className="rounded-full border border-border bg-background px-2 py-0.5 text-[10px] text-muted-foreground">
              {t(`settings.about.runtime.${runtimeMode}`)}
            </span>
            <span className="rounded-full border border-border bg-background px-2 py-0.5 text-[10px] text-muted-foreground">
              {t(`settings.about.channel.${channel}`)}
            </span>
          </div>
        </div>

        <div className={`oa-status-surface mt-4 flex items-center gap-2 rounded-lg border px-3 py-2.5 text-[12px] ${statusTone}`} aria-live="polite">
          <StatusIcon className={`h-4 w-4 shrink-0 ${status.kind === 'checking' ? 'animate-spin motion-reduce:animate-none' : ''}`} />
          <span className="font-medium">{status.text}</span>
        </div>

        {error && (
          <p className="mt-2 text-[11px] leading-relaxed text-destructive">{error}</p>
        )}

        <div className="mt-4 flex flex-wrap gap-2">
          {nativeStatus?.phase === 'downloaded' ? (
            <button
              type="button"
              onClick={() => void installAndRestart()}
              disabled={installing}
              className="btn-primary-sm inline-flex items-center gap-1.5"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${installing ? 'animate-spin motion-reduce:animate-none' : ''}`} />
              {installing ? t('settings.about.installing') : t('settings.about.installAndRestart')}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void checkForUpdates()}
              disabled={checking}
              className="btn-primary-sm inline-flex items-center gap-1.5"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${checking ? 'animate-spin motion-reduce:animate-none' : ''}`} />
              {checking ? t('settings.about.checking') : t('settings.about.check')}
            </button>
          )}
          <button
            type="button"
            onClick={() => void openRelease()}
            className="btn-secondary-sm inline-flex items-center gap-1.5"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            {t('settings.about.viewReleases')}
          </button>
        </div>
      </div>
    </ConfigSection>
  )
}
