import { useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useUpdateLifecycle, type UpdatePreferences } from '../../hooks/useUpdateLifecycle'
import { Button } from '../ui/button'
import { ConfigSection } from '../form'
import { Collapsible, CollapsibleContent, CollapsibleDetailsTrigger } from '../ui/collapsible'
import { Toggle } from '../Toggle'

export function UpdateLifecycleSection() {
  const { t } = useTranslation()
  const updates = useUpdateLifecycle()
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const preferences = updates.preferences

  const change = async (key: keyof UpdatePreferences, value: boolean) => {
    if (!preferences) return
    setSaving(true)
    setSaveError(null)
    try { await updates.savePreferences({ ...preferences, [key]: value }) }
    catch (cause) { setSaveError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setSaving(false) }
  }

  return <ConfigSection title={t('settings.versions.preferences')}>
    <Collapsible>
    <CollapsibleDetailsTrigger>{t('settings.versions.managePreferences')}</CollapsibleDetailsTrigger>
    <CollapsibleContent>
    <div className="mt-3 rounded-lg border border-border/70 bg-secondary/35 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-2xl text-xs leading-5 text-muted-foreground">{t('settings.updateLifecycle.description')}</p>
        <Button type="button" size="sm" variant="outline" disabled={updates.checking} onClick={() => void updates.refresh()}>
          <RefreshCw className={`size-3.5 ${updates.checking ? 'animate-spin motion-reduce:animate-none' : ''}`} aria-hidden />
          {updates.checking ? t('settings.updateLifecycle.checking') : t('settings.updateLifecycle.checkNow')}
        </Button>
      </div>

      {updates.updatesUnsupported && <p className="mt-4 rounded-md border border-border/70 bg-background/60 px-3 py-2 text-xs leading-5 text-muted-foreground" role="status">
        {t('settings.updateLifecycle.unsupported')}
      </p>}

      <div className="mt-4 divide-y divide-border/65 border-y border-border/65">
        <div className="flex min-w-0 items-center justify-between gap-4 py-3">
          <div className="min-w-0">
            <p className="text-sm font-medium">{t('settings.updateLifecycle.clientCheck')}</p>
            <p className="mt-0.5 text-xs leading-5 text-muted-foreground">{t('settings.updateLifecycle.clientCheckDescription')}</p>
          </div>
          <Toggle ariaLabel={t('settings.updateLifecycle.clientCheck')} checked={updates.client?.preferences.autoCheck ?? false}
            disabled={!updates.client || saving} onChange={(autoCheck) => {
              setSaving(true); setSaveError(null)
              void updates.saveClientPreferences({ autoCheck }).catch((cause: unknown) => setSaveError(cause instanceof Error ? cause.message : String(cause))).finally(() => setSaving(false))
            }} />
        </div>
        {([
          ['autoCheckApp', 'appCheck', 'appCheckDescription'],
          ['autoUpdateAutoQuant', 'autoQuant', 'autoQuantDescription'],
          ['autoUpdateAutoPrediction', 'autoPrediction', 'autoPredictionDescription'],
        ] as const).map(([key, label, description]) => <div key={key} className="flex min-w-0 items-center justify-between gap-4 py-3">
          <div className="min-w-0">
            <p className="text-sm font-medium">{t(`settings.updateLifecycle.${label}`)}</p>
            <p className="mt-0.5 text-xs leading-5 text-muted-foreground">{t(`settings.updateLifecycle.${description}`)}</p>
          </div>
          <Toggle ariaLabel={t(`settings.updateLifecycle.${label}`)} checked={preferences?.[key] ?? false}
            disabled={!preferences || saving} onChange={(value) => void change(key, value)} />
        </div>)}
      </div>

      {(updates.error || updates.clientError || saveError) && <p className="mt-3 text-xs text-destructive" role="alert">{saveError || updates.clientError || updates.error}</p>}
    </div>
    </CollapsibleContent></Collapsible>
  </ConfigSection>
}
