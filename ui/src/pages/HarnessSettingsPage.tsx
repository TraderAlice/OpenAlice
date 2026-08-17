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
  const toggleId = useId()
  const toggleDescriptionId = `${toggleId}-description`

  const persist = async (next: boolean) => {
    setStatus('saving')
    try {
      await save({ showHeadlessBornSessions: next })
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
      <SettingsScrollArea className="px-4 py-6 md:px-8">
        <div className="mx-auto max-w-[880px]">
          <ConfigSection
            title={t('settings.harness.shared')}
            description={t('settings.harness.sharedDescription')}
          >
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <label htmlFor={toggleId} className="block text-sm font-medium text-foreground">
                  {t('settings.harness.showHeadlessBorn')}
                </label>
                <p id={toggleDescriptionId} className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
                  {t('settings.harness.showHeadlessBornDescription')}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Toggle
                  ariaLabel={t('settings.harness.showHeadlessBorn')}
                  checked={preferences.showHeadlessBornSessions}
                  disabled={status === 'saving'}
                  onChange={(next) => void persist(next)}
                />
                <SaveIndicator status={status === 'idle' && error ? 'error' : status} />
              </div>
            </div>
          </ConfigSection>

          <ConfigSection
            title={t('settings.harness.askAlice')}
            description={t('settings.harness.askAliceDescription')}
          >
            <p className="text-[13px] leading-relaxed text-muted-foreground">
              {t('settings.harness.usesSharedRoster')}
            </p>
          </ConfigSection>

          <ConfigSection
            title={t('settings.harness.autoQuant')}
            description={t('settings.harness.autoQuantDescription')}
          >
            <p className="text-[13px] leading-relaxed text-muted-foreground">
              {t('settings.harness.usesSharedRoster')}
            </p>
          </ConfigSection>
        </div>
      </SettingsScrollArea>
    </div>
  )
}
