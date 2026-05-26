import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '../api'
import type { VersionInfo } from '../api/types'

const SKIP_STORAGE_KEY = 'openalice.update.skipVersion'

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
 * Self-hosted source distribution: when the user wants to actually
 * update, they run `git pull && pnpm build && restart` in their
 * terminal. We don't auto-execute (Electron auto-update will
 * eventually handle that path natively).
 */
export function UpdateBanner() {
  const { t } = useTranslation()
  const [info, setInfo] = useState<VersionInfo | null>(null)
  const [sessionDismissed, setSessionDismissed] = useState(false)

  useEffect(() => {
    api.version.get().then(setInfo).catch(() => {})
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
        <span className="font-semibold">v{info.latest}</span> {t('updateBanner.isAvailable', 'is available')}
        {' '}<span className="text-text-muted">({t('updateBanner.youHave', 'you have v{{version}}', { version: info.current })})</span>
        {info.publishedAt && (
          <span className="text-text-muted"> · {t('updateBanner.released', 'released {{date}}', { date: info.publishedAt.slice(0, 10) })}</span>
        )}
      </span>
      <span className="text-text-muted shrink-0 hidden md:inline">
        {t('updateBanner.runToUpdate', 'Run')} <code className="text-accent bg-bg-tertiary px-1 rounded">git pull &amp;&amp; pnpm build</code> {t('updateBanner.toUpdate', 'to update')}
      </span>
      {info.releaseUrl && (
        <a
          href={info.releaseUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-accent hover:underline shrink-0"
        >
          {t('updateBanner.releaseNotes', 'Release notes →')}
        </a>
      )}
      <button
        onClick={handleSkip}
        className="text-text-muted hover:text-text shrink-0 text-[11px]"
        title={t('updateBanner.skipTitle', "Don't show this update again")}
      >
        {t('updateBanner.skipThisVersion', 'Skip this version')}
      </button>
      <button
        onClick={handleDismiss}
        className="text-text-muted hover:text-text shrink-0"
        title={t('updateBanner.dismissTitle', 'Dismiss until next reload')}
        aria-label={t('common.dismiss')}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
    </div>
  )
}

