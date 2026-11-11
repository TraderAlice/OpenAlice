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

  return <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-4 gap-y-2 py-3">
    <label htmlFor={id} className="min-w-0 text-sm font-medium leading-5 text-foreground">{t('settings.harness.showUnverifiedReleases')}</label>
    <Toggle id={id} ariaLabel={t('settings.harness.showUnverifiedReleases')} checked={preferences.showUnverifiedHarnessReleases} pending={status === 'saving'} onChange={(next) => void update(next)} />
    <p id={descriptionId} className="col-span-2 text-sm leading-5 text-muted-foreground">{t('settings.harness.showUnverifiedReleasesDescription')}</p>
    <div className="col-span-2 justify-self-end">
      <SaveIndicator status={status === 'idle' && error ? 'error' : status} />
    </div>
  </div>
}
