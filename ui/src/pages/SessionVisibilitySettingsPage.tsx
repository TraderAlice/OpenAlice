import { useEffect, useId, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ConfigSection, SettingsScrollArea } from '../components/form'
import { PageHeader } from '../components/PageHeader'
import { SaveIndicator } from '../components/SaveIndicator'
import { Toggle } from '../components/Toggle'
import { ContextHelp } from '../components/ContextHelp'
import type { SaveStatus } from '../hooks/useAutoSave'
import { useHarnessPreferences } from '../hooks/useHarnessPreferences'

export function SessionVisibilitySettingsPage() {
  const { t } = useTranslation()
  const { preferences, save, error, loading } = useHarnessPreferences()
  const [status, setStatus] = useState<SaveStatus>('idle')
  const rosterToggleId = useId()
  const issueRosterToggleId = useId()
  useEffect(() => {
    if (status !== 'saved') return
    const timer = window.setTimeout(() => setStatus('idle'), 1800)
    return () => window.clearTimeout(timer)
  }, [status])

  const persist = async (next: typeof preferences) => {
    setStatus('saving')
    try {
      await save(next)
      setStatus('saved')
    } catch {
      setStatus('error')
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title={t('settings.category.visibility')}
        help={t('settings.visibility.description')}
        right={<SaveIndicator status={status === 'idle' && error ? 'error' : status} />}
      />
      <SettingsScrollArea>
        <div className="max-w-[880px]">
          <ConfigSection
            title={t('settings.visibility.sessions')}
          >
            <div className="flex min-h-12 items-center justify-between gap-4 py-3">
              <div className="flex min-w-0 items-center gap-2">
                <label htmlFor={rosterToggleId} className="block text-sm font-medium text-foreground">
                  {t('settings.harness.showHeadlessBorn')}
                </label>
                <ContextHelp label={t('settings.harness.showHeadlessBorn')}>
                  {t('settings.harness.showHeadlessBornDescription')}
                </ContextHelp>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Toggle
                  id={rosterToggleId}
                  ariaLabel={t('settings.harness.showHeadlessBorn')}
                  checked={preferences.showHeadlessBornSessions}
                  disabled={loading}
                  pending={status === 'saving'}
                  onChange={(next) => void persist({ ...preferences, showHeadlessBornSessions: next })}
                />
              </div>
            </div>
            <div className="flex min-h-12 items-center justify-between gap-4 border-t border-border py-3">
              <div className="flex min-w-0 items-center gap-2">
                <label htmlFor={issueRosterToggleId} className="block text-sm font-medium text-foreground">
                  {t('settings.harness.showIssueAttached')}
                </label>
                <ContextHelp label={t('settings.harness.showIssueAttached')}>
                  {t('settings.harness.showIssueAttachedDescription')}
                </ContextHelp>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Toggle
                  id={issueRosterToggleId}
                  ariaLabel={t('settings.harness.showIssueAttached')}
                  checked={preferences.showIssueAttachedSessions}
                  disabled={loading}
                  pending={status === 'saving'}
                  onChange={(next) => void persist({ ...preferences, showIssueAttachedSessions: next })}
                />
              </div>
            </div>
          </ConfigSection>
        </div>
      </SettingsScrollArea>
    </div>
  )
}
