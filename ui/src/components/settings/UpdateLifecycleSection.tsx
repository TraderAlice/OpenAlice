import { useState } from 'react'
import { ArrowUpRight, CheckCircle2, CircleAlert, LoaderCircle, RefreshCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useWorkspaces } from '../../contexts/workspaces-context'
import { useUpdateLifecycle, type UpdatePreferences } from '../../hooks/useUpdateLifecycle'
import { Button } from '../ui/button'
import { ConfigSection } from '../form'
import { Toggle } from '../Toggle'

const VERSION = typeof __OPENALICE_UI_VERSION__ === 'string' ? __OPENALICE_UI_VERSION__ : 'development'
const displayVersion = (version: string) => version.startsWith('v') ? version : `v${version}`
const templateLabel: Record<string, string> = {
  chat: 'Chat',
  'auto-quant-v2': 'Auto Quant',
  'auto-prediction': 'Auto Prediction',
}
const clientHasUpdate = (latest: string | null | undefined) => {
  const match = (value: string) => /^v?(\d+)\.(\d+)\.(\d+)(?:-(.+))?$/.exec(value)
  const a = latest && match(latest)
  const b = match(VERSION)
  if (!a || !b) return false
  for (let index = 1; index <= 3; index += 1) {
    if (a[index] !== b[index]) return Number(a[index]) > Number(b[index])
  }
  return !a[4] && Boolean(b[4]) || Boolean(a[4] && b[4] && a[4].localeCompare(b[4], undefined, { numeric: true }) > 0)
}

export function UpdateLifecycleSection() {
  const { t } = useTranslation()
  const updates = useUpdateLifecycle()
  const { workspaces, openAgentConfig } = useWorkspaces()
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

  return <ConfigSection title={t('settings.updateLifecycle.title')}>
    <div className="rounded-lg border border-border/70 bg-secondary/35 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-2xl text-xs leading-5 text-muted-foreground">{t('settings.updateLifecycle.description')}</p>
        <Button type="button" size="sm" variant="outline" disabled={updates.checking} onClick={() => void updates.refresh()}>
          <RefreshCw className={`size-3.5 ${updates.checking ? 'animate-spin motion-reduce:animate-none' : ''}`} aria-hidden />
          {updates.checking ? t('settings.updateLifecycle.checking') : t('settings.updateLifecycle.checkNow')}
        </Button>
      </div>

      <div className="mt-4 divide-y divide-border/65 border-y border-border/65">
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

      <div className="mt-4 space-y-1" aria-live="polite">
        <p className="mb-2 text-xs font-semibold text-muted-foreground">{t('settings.updateLifecycle.statusTitle')}</p>
        <div className="flex min-w-0 items-start gap-3 rounded-md px-2 py-2 text-xs">
          <CheckCircle2 className="size-4 shrink-0 text-primary" aria-hidden />
          <span className="min-w-0 flex-1">{t('settings.updateLifecycle.client')} · {displayVersion(VERSION)}</span>
          <span className="max-w-[42%] text-right text-muted-foreground">{updates.nativeStatus && 'version' in updates.nativeStatus && updates.nativeStatus.version && ['available', 'downloaded'].includes(updates.nativeStatus.phase)
            ? t('settings.updateLifecycle.available', { version: updates.nativeStatus.version })
            : preferences?.autoCheckApp && updates.versionInfo?.latest && clientHasUpdate(updates.versionInfo.latest)
              ? t('settings.updateLifecycle.available', { version: updates.versionInfo.latest })
            : t('settings.updateLifecycle.currentOrManaged')}</span>
        </div>
        <div className="flex min-w-0 items-start gap-3 rounded-md px-2 py-2 text-xs">
          <CheckCircle2 className="size-4 shrink-0 text-primary" aria-hidden />
          <span className="min-w-0 flex-1">{t('settings.updateLifecycle.backend')} · {updates.versionInfo?.current ? displayVersion(updates.versionInfo.current) : '—'}</span>
          <span className="max-w-[42%] text-right text-muted-foreground">{updates.versionInfo?.hasUpdate && updates.versionInfo.latest
            ? t('settings.updateLifecycle.available', { version: updates.versionInfo.latest })
            : t('settings.updateLifecycle.currentOrManaged')}</span>
        </div>
        {workspaces.filter((workspace) => ['chat', 'auto-quant-v2', 'auto-prediction'].includes(workspace.template ?? '')).map((workspace) => {
          const status = updates.workspaceStates.find((state) => state.workspaceId === workspace.id)
          const available = status?.phase === 'updated' && status.toVersion === workspace.upgradeAvailable?.to
            ? undefined : workspace.upgradeAvailable
          const attention = available || status?.phase === 'blocked' || status?.phase === 'failed'
          const Icon = status?.phase === 'checking' ? LoaderCircle : attention ? CircleAlert : CheckCircle2
          return <div key={workspace.id} className="flex min-w-0 items-start gap-3 rounded-md px-2 py-2 text-xs">
            <Icon className={`size-4 shrink-0 ${attention ? 'text-primary' : 'text-muted-foreground'} ${status?.phase === 'checking' ? 'animate-spin motion-reduce:animate-none' : ''}`} aria-hidden />
            <span className="min-w-0 flex-1">{templateLabel[workspace.template ?? ''] ?? workspace.displayName ?? workspace.tag}
              {status?.fromVersion ? <span className="ml-1 text-muted-foreground">{displayVersion(status.fromVersion)}</span> : null}</span>
            <span className="max-w-[42%] text-right text-muted-foreground" title={status?.reason}>{status?.phase === 'blocked'
              ? t('settings.updateLifecycle.blocked')
              : status?.phase === 'failed' ? t('settings.updateLifecycle.failed')
                : available ? t('settings.updateLifecycle.available', { version: available.to })
                  : status?.phase === 'checking' ? t('settings.updateLifecycle.checking')
                    : t('settings.updateLifecycle.currentOrManaged')}</span>
            {attention && <Button type="button" size="icon" variant="ghost" aria-label={t('settings.updateLifecycle.review', { name: workspace.displayName || workspace.tag })}
              onClick={() => openAgentConfig(workspace.id, undefined, 'template')}><ArrowUpRight className="size-4" aria-hidden /></Button>}
          </div>
        })}
      </div>
      {(updates.error || saveError) && <p className="mt-3 text-xs text-destructive" role="alert">{saveError || updates.error}</p>}
    </div>
  </ConfigSection>
}
