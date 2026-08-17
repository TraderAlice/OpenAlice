import { useEffect, useState } from 'react'
import { Download, ExternalLink, RefreshCcw, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Dialog } from './uta/Dialog'

type UpdateStatus =
  | { phase: 'available'; version?: string; releaseUrl?: string }
  | { phase: 'downloading'; version?: string; percent?: number }
  | { phase: 'downloaded'; version: string; releaseUrl: string }
  | {
      phase: 'installing'
      version: string
      stage: 'preparing' | 'stopping-services' | 'releasing-runtime' | 'handing-off'
    }
  | { phase: 'error'; message: string }

function previewStatus(): UpdateStatus | null {
  if (!import.meta.env.DEV || typeof window === 'undefined') return null
  const params = new URLSearchParams(window.location.search)
  if (params.get('updatePrompt') !== '1') return null
  const version = params.get('updateVersion') || '0.74.0-beta'
  const stage = params.get('updateStage')
  if (
    stage === 'preparing' ||
    stage === 'stopping-services' ||
    stage === 'releasing-runtime' ||
    stage === 'handing-off'
  ) {
    return { phase: 'installing', version, stage }
  }
  return {
    phase: 'downloaded',
    version,
    releaseUrl: `https://github.com/TraderAlice/OpenAlice/releases/tag/v${version}`,
  }
}

export function DesktopUpdatePrompt() {
  const { t } = useTranslation()
  const [status, setStatus] = useState<UpdateStatus | null>(() => previewStatus())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const updater = window.openAlice?.updater
    if (!updater) return

    void updater.getStatus()
      .then((next) => {
        if (next?.phase === 'downloaded' || next?.phase === 'installing') setStatus(next)
      })
      .catch(() => {})

    return updater.onStatus((next) => {
      if (next.phase === 'error') {
        setError(next.message)
        setBusy(false)
        return
      }
      if (next.phase !== 'downloaded' && next.phase !== 'installing') return
      setError(null)
      setBusy(next.phase === 'installing')
      setStatus(next)
    })
  }, [])

  if (status?.phase !== 'downloaded' && status?.phase !== 'installing') return null

  const installing = busy || status.phase === 'installing'
  const installText = status.phase === 'installing'
    ? t(`settings.about.status.installing.${status.stage}`)
    : t('settings.about.installing')

  const handleInstall = async () => {
    const updater = window.openAlice?.updater
    if (!updater) {
      setStatus(null)
      return
    }
    setBusy(true)
    setError(null)
    try {
      await updater.installAndRestart()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setBusy(false)
    }
  }

  const handleRelease = async () => {
    const updater = window.openAlice?.updater
    if (updater) {
      await updater.openRelease(status.version)
      return
    }
    const releaseUrl = status.phase === 'downloaded'
      ? status.releaseUrl
      : `https://github.com/TraderAlice/OpenAlice/releases/tag/v${status.version}`
    window.open(releaseUrl, '_blank', 'noopener,noreferrer')
  }

  return (
    <Dialog
      ariaLabel={installing
        ? t('settings.about.prompt.installingTitle')
        : t('settings.about.prompt.readyTitle')}
      onClose={installing ? () => {} : () => setStatus(null)}
      width="w-[480px]"
    >
      <div className="px-5 py-4 border-b border-border flex items-center gap-3">
        <div className="h-9 w-9 rounded-lg border border-primary/30 bg-primary-muted/30 text-primary flex items-center justify-center shrink-0">
          <Download size={18} strokeWidth={1.8} />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="text-[15px] font-semibold text-foreground leading-snug">
            {installing ? t('settings.about.prompt.installingTitle') : t('settings.about.prompt.readyTitle')}
          </h2>
          <p className="text-[12px] text-muted-foreground truncate">OpenAlice v{status.version}</p>
        </div>
        <button
          type="button"
          onClick={() => setStatus(null)}
          disabled={installing}
          className="h-8 w-8 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-40 flex items-center justify-center transition-colors"
          aria-label={t('settings.about.prompt.close')}
        >
          <X size={16} />
        </button>
      </div>

      <div className="px-5 py-4 space-y-3">
        <p className="text-[13px] leading-relaxed text-foreground">
          {installing ? installText : t('settings.about.prompt.readyBody')}
        </p>
        <p className="text-[12px] leading-relaxed text-muted-foreground">
          {t('settings.about.installHandoffNote')}
        </p>
        {installing && (
          <div
            className="h-1.5 overflow-hidden rounded-full bg-primary/15"
            role="progressbar"
            aria-label={installText}
          >
            <div className="h-full w-full animate-pulse rounded-full bg-primary motion-reduce:animate-none" />
          </div>
        )}
        {error && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-[12px] leading-relaxed text-destructive">
            {error}
          </div>
        )}
      </div>

      <div className="px-5 py-3 border-t border-border flex flex-col-reverse sm:flex-row sm:items-center sm:justify-end gap-2">
        <button
          type="button"
          onClick={() => setStatus(null)}
          disabled={installing}
          className="btn-secondary"
        >
          {t('settings.about.prompt.later')}
        </button>
        <button
          type="button"
          onClick={handleRelease}
          disabled={installing}
          className="btn-secondary inline-flex items-center justify-center gap-2"
        >
          <ExternalLink size={14} />
          {t('settings.about.viewReleases')}
        </button>
        <button
          type="button"
          onClick={handleInstall}
          disabled={installing}
          className="btn-primary inline-flex items-center justify-center gap-2"
        >
          <RefreshCcw size={14} />
          {installing ? installText : t('settings.about.prompt.restartNow')}
        </button>
      </div>
    </Dialog>
  )
}
