import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SaveIndicator } from '../SaveIndicator'
import { Toggle } from '../Toggle'
import type { SaveStatus } from '../../hooks/useAutoSave'
import { useHarnessPreferences } from '../../hooks/useHarnessPreferences'

export function UnverifiedHarnessReleaseSetting() {
  const { t } = useTranslation()
  const { preferences, save, error } = useHarnessPreferences()
  const [status, setStatus] = useState<SaveStatus>('idle')
  const id = useId()
  const descriptionId = `${id}-description`

  const update = async (checked: boolean) => {
    setStatus('saving')
    try {
      await save({ ...preferences, showUnverifiedHarnessReleases: checked })
      setStatus('saved')
      window.setTimeout(() => setStatus('idle'), 1800)
    } catch {
      setStatus('error')
    }
  }

  return <div className="flex min-h-12 items-start justify-between gap-4 py-3">
    <div className="min-w-0">
      <label htmlFor={id} className="block text-sm font-medium text-foreground">{t('settings.harness.showUnverifiedReleases')}</label>
      <p id={descriptionId} className="mt-1 text-xs leading-relaxed text-muted-foreground">{t('settings.harness.showUnverifiedReleasesDescription')}</p>
    </div>
    <div className="flex shrink-0 items-center gap-2">
      <Toggle id={id} ariaLabel={t('settings.harness.showUnverifiedReleases')} checked={preferences.showUnverifiedHarnessReleases} disabled={status === 'saving'} onChange={(next) => void update(next)} />
      <SaveIndicator status={status === 'idle' && error ? 'error' : status} />
    </div>
  </div>
}
