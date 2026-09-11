import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ConfigSection, SettingsScrollArea } from '../components/form'
import { PageHeader } from '../components/PageHeader'
import { SaveIndicator } from '../components/SaveIndicator'
import { Toggle } from '../components/Toggle'
import type { SaveStatus } from '../hooks/useAutoSave'
import { useHarnessPreferences } from '../hooks/useHarnessPreferences'

export function HarnessSettingsPage() {
  const { t } = useTranslation()
  const { preferences, save, error } = useHarnessPreferences()
  const [status, setStatus] = useState<SaveStatus>('idle')
  const rosterToggleId = useId()
  const rosterDescriptionId = `${rosterToggleId}-description`
  const issueRosterToggleId = useId()
  const issueRosterDescriptionId = `${issueRosterToggleId}-description`
  const releasesToggleId = useId()
  const releasesDescriptionId = `${releasesToggleId}-description`

  const persist = async (next: typeof preferences) => {
    setStatus('saving')
    try {
      await save(next)
      setStatus('saved')
      window.setTimeout(() => setStatus('idle'), 1800)
    } catch {
      setStatus('error')
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title={t('settings.harness.title')}
        description={t('settings.harness.description')}
      />
      <SettingsScrollArea className="px-4 py-5 md:px-8">
        <div className="mx-auto max-w-[880px]">
          <ConfigSection
            title={t('settings.harness.shared')}
          >
            <div className="flex min-h-12 items-start justify-between gap-4 py-3">
              <div className="min-w-0">
                <label htmlFor={rosterToggleId} className="block text-sm font-medium text-foreground">
                  {t('settings.harness.showHeadlessBorn')}
                </label>
                <p id={rosterDescriptionId} className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
                  {t('settings.harness.showHeadlessBornDescription')}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Toggle
                  id={rosterToggleId}
                  ariaLabel={t('settings.harness.showHeadlessBorn')}
                  checked={preferences.showHeadlessBornSessions}
                  disabled={status === 'saving'}
                  onChange={(next) => void persist({ ...preferences, showHeadlessBornSessions: next })}
                />
                <SaveIndicator status={status === 'idle' && error ? 'error' : status} />
              </div>
            </div>
            <div className="flex min-h-12 items-start justify-between gap-4 border-t border-border py-3">
              <div className="min-w-0">
                <label htmlFor={issueRosterToggleId} className="block text-sm font-medium text-foreground">
                  {t('settings.harness.showIssueAttached')}
                </label>
                <p id={issueRosterDescriptionId} className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
                  {t('settings.harness.showIssueAttachedDescription')}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Toggle
                  id={issueRosterToggleId}
                  ariaLabel={t('settings.harness.showIssueAttached')}
                  checked={preferences.showIssueAttachedSessions}
                  disabled={status === 'saving'}
                  onChange={(next) => void persist({ ...preferences, showIssueAttachedSessions: next })}
                />
              </div>
            </div>
            <div className="flex min-h-12 items-start justify-between gap-4 border-t border-border py-3">
              <div className="min-w-0">
                <label htmlFor={releasesToggleId} className="block text-sm font-medium text-foreground">
                  {t('settings.harness.showUnverifiedReleases')}
                </label>
                <p id={releasesDescriptionId} className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
                  {t('settings.harness.showUnverifiedReleasesDescription')}
                </p>
              </div>
              <Toggle
                id={releasesToggleId}
                ariaLabel={t('settings.harness.showUnverifiedReleases')}
                checked={preferences.showUnverifiedHarnessReleases}
                disabled={status === 'saving'}
                onChange={(next) => void persist({ ...preferences, showUnverifiedHarnessReleases: next })}
              />
            </div>
          </ConfigSection>
        </div>
      </SettingsScrollArea>
    </div>
  )
}
