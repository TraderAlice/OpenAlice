import { useEffect, useState } from 'react'
import { Download, ExternalLink, RefreshCcw, X } from 'lucide-react'
import { Dialog } from './uta/Dialog'

type UpdateStatus =
  | { phase: 'available'; version?: string; releaseUrl?: string }
  | { phase: 'downloading'; version?: string; percent?: number }
  | { phase: 'downloaded'; version: string; releaseUrl: string }
  | { phase: 'error'; message: string }

function previewStatus(): UpdateStatus | null {
  if (!import.meta.env.DEV || typeof window === 'undefined') return null
  const params = new URLSearchParams(window.location.search)
  if (params.get('updatePrompt') !== '1') return null
  const version = params.get('updateVersion') || '0.74.0-beta'
  return {
    phase: 'downloaded',
    version,
    releaseUrl: `https://github.com/TraderAlice/OpenAlice/releases/tag/v${version}`,
  }
}

export function DesktopUpdatePrompt() {
  const [status, setStatus] = useState<UpdateStatus | null>(() => previewStatus())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const updater = window.openAlice?.updater
    if (!updater) return

    void updater.getStatus()
      .then((next) => {
        if (next?.phase === 'downloaded') setStatus(next)
      })
      .catch(() => {})

    return updater.onStatus((next) => {
      if (next.phase !== 'downloaded') return
      setError(null)
      setStatus(next)
    })
  }, [])

  if (status?.phase !== 'downloaded') return null

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
    window.open(status.releaseUrl, '_blank', 'noopener,noreferrer')
  }

  return (
    <Dialog onClose={busy ? () => {} : () => setStatus(null)} width="w-[480px]">
      <div className="px-5 py-4 border-b border-border flex items-center gap-3">
        <div className="h-9 w-9 rounded-lg border border-accent/30 bg-accent-dim/30 text-accent flex items-center justify-center shrink-0">
          <Download size={18} strokeWidth={1.8} />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="text-[15px] font-semibold text-text leading-snug">Update ready</h2>
          <p className="text-[12px] text-text-muted truncate">OpenAlice v{status.version}</p>
        </div>
        <button
          type="button"
          onClick={() => setStatus(null)}
          disabled={busy}
          className="h-8 w-8 rounded-md text-text-muted hover:text-text hover:bg-bg-tertiary disabled:opacity-40 flex items-center justify-center transition-colors"
          aria-label="Close update prompt"
        >
          <X size={16} />
        </button>
      </div>

      <div className="px-5 py-4 space-y-3">
        <p className="text-[13px] leading-relaxed text-text">
          The update has been downloaded and is ready to install.
        </p>
        <p className="text-[12px] leading-relaxed text-text-muted">
          Restarting will stop Alice and UTA gracefully, then reopen OpenAlice on the new version.
        </p>
        {error && (
          <div className="rounded-lg border border-red/30 bg-red/10 px-3 py-2 text-[12px] leading-relaxed text-red">
            {error}
          </div>
        )}
      </div>

      <div className="px-5 py-3 border-t border-border flex flex-col-reverse sm:flex-row sm:items-center sm:justify-end gap-2">
        <button
          type="button"
          onClick={() => setStatus(null)}
          disabled={busy}
          className="btn-secondary"
        >
          Later
        </button>
        <button
          type="button"
          onClick={handleRelease}
          disabled={busy}
          className="btn-secondary inline-flex items-center justify-center gap-2"
        >
          <ExternalLink size={14} />
          View release
        </button>
        <button
          type="button"
          onClick={handleInstall}
          disabled={busy}
          className="btn-primary inline-flex items-center justify-center gap-2"
        >
          <RefreshCcw size={14} />
          {busy ? 'Preparing...' : 'Restart now'}
        </button>
      </div>
    </Dialog>
  )
}
