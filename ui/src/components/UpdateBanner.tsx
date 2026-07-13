import { useEffect, useState } from 'react'
import { api } from '../api'
import type { VersionInfo } from '../api/types'

const SKIP_STORAGE_KEY = 'openalice.update.skipVersion'
type RuntimeMode = 'browser' | 'electron-dev' | 'electron-packaged'

/**
 * Top-of-app banner shown when GitHub Releases reports a version newer
 * than the running app's package.json.
 *
 * Three actions for the user:
 *  - "Release notes" — opens the GitHub release page (changelog)
 *  - "Skip this version" — persists in localStorage; never bug user
 *    about THIS specific version again. They'll see the banner again
 *    when a newer version is released.
 *  - "×" close — session-only dismiss (until next page load).
 *
 * The action text is runtime-aware: source/Docker installs update from git,
 * while packaged Electron is handled by the native auto-updater.
 */
export function UpdateBanner() {
  const [info, setInfo] = useState<VersionInfo | null>(null)
  const [runtimeMode, setRuntimeMode] = useState<RuntimeMode>('browser')
  const [sessionDismissed, setSessionDismissed] = useState(false)

  useEffect(() => {
    api.version.get().then(setInfo).catch(() => {})
    window.openAlice?.runtime.info()
      .then((runtime) => setRuntimeMode(runtime.mode))
      .catch(() => setRuntimeMode('browser'))
  }, [])

  if (!info || !info.hasUpdate || !info.latest) return null
  if (sessionDismissed) return null

  const skippedVersion = (() => {
    try { return localStorage.getItem(SKIP_STORAGE_KEY) } catch { return null }
  })()
  if (skippedVersion === info.latest) return null

  const handleSkip = () => {
    try { localStorage.setItem(SKIP_STORAGE_KEY, info.latest!) } catch { /* ignore */ }
    setSessionDismissed(true)
  }
  const handleDismiss = () => {
    setSessionDismissed(true)
  }

  return (
    <div className="flex items-center gap-3 px-4 py-2 bg-accent-dim/30 border-b border-accent/40 text-[12px] text-text">
      <span className="shrink-0">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-accent">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="7 10 12 15 17 10" />
          <line x1="12" y1="15" x2="12" y2="3" />
        </svg>
      </span>
      <span className="flex-1 min-w-0 truncate">
        <span className="font-semibold">v{info.latest}</span> available
        {' '}<span className="text-text-muted hidden sm:inline">(you have v{info.current})</span>
        {info.publishedAt && (
          <span className="text-text-muted hidden lg:inline"> · released {info.publishedAt.slice(0, 10)}</span>
        )}
      </span>
      {runtimeMode === 'electron-packaged' ? (
        <span className="text-text-muted shrink-0 hidden md:inline">
          Desktop updater will prompt when the download is ready
        </span>
      ) : (
        <span className="text-text-muted shrink-0 hidden md:inline">
          Run <code className="text-accent bg-bg-tertiary px-1 rounded">git pull &amp;&amp; pnpm build</code> to update
        </span>
      )}
      {info.releaseUrl && (
        <a
          href={info.releaseUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-accent hover:underline shrink-0"
        >
          <span className="hidden sm:inline">Release notes</span>
          <span className="sm:hidden">Notes</span>
          {' '}→
        </a>
      )}
      <button
        onClick={handleSkip}
        className="text-text-muted hover:text-text shrink-0 text-[11px]"
        title="Don't show this update again"
      >
        <span className="hidden sm:inline">Skip this version</span>
        <span className="sm:hidden">Skip</span>
      </button>
      <button
        onClick={handleDismiss}
        className="text-text-muted hover:text-text shrink-0"
        title="Dismiss until next reload"
        aria-label="Dismiss"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
    </div>
  )
}
