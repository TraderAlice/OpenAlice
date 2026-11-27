import { useState } from 'react'
import { useUpdateLifecycle, type NativeStatus } from '../hooks/useUpdateLifecycle'
import { Download, ExternalLink, RefreshCcw, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Dialog } from './uta/Dialog'
import { Button } from './ui/button'

function previewStatus(): NativeStatus | null {
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
  const updates = useUpdateLifecycle()
  const [preview, setPreview] = useState(() => previewStatus())
  const [dismissed, setDismissed] = useState<string | null>(null)
  const status = updates.nativeStatus?.phase === 'installing' ? updates.nativeStatus : updates.nativeReady ?? preview
  if (status?.phase !== 'downloaded' && status?.phase !== 'installing') return null
  const installing = updates.nativeInstalling || status.phase === 'installing'
  if (!installing && dismissed === status.version) return null
  const error = updates.nativeError
  const installText = status.phase === 'installing'
    ? t(`settings.about.status.installing.${status.stage}`)
    : t('settings.about.installing')
  const dismiss = () => { setDismissed(status.version); setPreview(null) }
  const handleInstall = () => {
    if (preview && !updates.nativeReady) { dismiss(); return }
    void updates.installClient().catch(() => undefined)
  }
  const handleRelease = () => { void updates.openClientRelease(status.version).catch(() => undefined) }

  return (
    <Dialog
      ariaLabel={installing
        ? t('settings.about.prompt.installingTitle')
        : t('settings.about.prompt.readyTitle')}
      onClose={installing ? () => {} : dismiss}
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
          <p className="text-sm text-muted-foreground truncate">OpenAlice v{status.version}</p>
        </div>
        <Button
          type="button"
          onClick={dismiss}
          disabled={installing}
          variant="ghost"
          size="icon-sm"
          className="text-muted-foreground"
          aria-label={t('settings.about.prompt.close')}
        >
          <X size={16} />
        </Button>
      </div>

      <div className="px-5 py-4 space-y-3">
        <p className="text-sm leading-relaxed text-foreground">
          {installing ? installText : t('settings.about.prompt.readyBody')}
        </p>
        <p className="text-sm leading-relaxed text-muted-foreground">
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
          <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm leading-relaxed text-destructive">
            {error}
          </div>
        )}
      </div>

      <div className="px-5 py-3 border-t border-border flex flex-col-reverse sm:flex-row sm:items-center sm:justify-end gap-2">
        <Button
          type="button"
          onClick={dismiss}
          disabled={installing}
          variant="secondary"
        >
          {t('settings.about.prompt.later')}
        </Button>
        <Button
          type="button"
          onClick={handleRelease}
          disabled={installing}
          variant="secondary"
        >
          <ExternalLink size={14} />
          {t('settings.about.viewReleases')}
        </Button>
        <Button
          type="button"
          onClick={handleInstall}
          disabled={installing}
        >
          <RefreshCcw size={14} />
          {installing ? installText : t('settings.about.prompt.restartNow')}
        </Button>
      </div>
    </Dialog>
  )
}
