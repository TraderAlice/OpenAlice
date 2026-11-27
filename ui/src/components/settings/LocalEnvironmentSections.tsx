import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { preferencesApi, type WorkspaceShellStatus } from '../../api/preferences'
import { getBackendConnection } from '../../auth/backendConnection'
import { useRelayConnection } from '../../hooks/useRelayConnection'
import { ConfigSection, Field, inputClass } from '../form'
import { Button } from '../ui/button'

export function DataHomeSection({ embedded = false }: { embedded?: boolean } = {}) {
  const { t } = useTranslation()
  const bridge = window.openAlice?.dataHome
  void getBackendConnection()
  const relay = useRelayConnection()
  const [status, setStatus] = useState<OpenAliceDataHomeStatus | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!bridge) return
    bridge.getStatus()
      .then(setStatus)
      .catch(() => setError(t('settings.dataHome.loadError')))
  }, [bridge, t])

  const lockDescription = status?.selectionLock === 'openalice-home-env'
    ? t('settings.dataHome.lockedByHome')
    : status?.selectionLock === 'workspace-root-env'
      ? t('settings.dataHome.lockedByWorkspace')
      : null

  const body = !bridge ? (
    <div className="rounded-lg border border-border/60 bg-secondary/50 px-3 py-3">
      {relay.status?.target?.machine && relay.status.target.machine !== 'local' ? (
        <p className="text-[13px] leading-relaxed text-foreground">
          {t('settings.dataHome.remoteManaged')}
        </p>
      ) : (
        <>
          <p className="text-[13px] text-foreground">{t('settings.dataHome.browserOnly')}</p>
          <p className="mt-2 break-all font-mono text-[12px] leading-[18px] text-muted-foreground">
            openalice run --home &lt;path&gt;
          </p>
          <p className="mt-1 break-all font-mono text-[12px] leading-[18px] text-muted-foreground">
            pnpm dev -- --home &lt;path&gt;
          </p>
        </>
      )}
    </div>
  ) : (
    <>
      <div className="rounded-lg border border-border/60 bg-secondary/50 px-3 py-3">
        <div className="flex items-center justify-between gap-3">
          <p className="text-[12px] font-medium text-muted-foreground">
            {t('settings.dataHome.current')}
          </p>
          {status && (
            <span className="rounded-full border border-border px-2 py-0.5 text-[10px] leading-[14px] text-muted-foreground">
              {t(`settings.dataHome.source.${status.source}`)}
            </span>
          )}
        </div>
        <p data-testid="data-home-current" className="mt-1 break-all font-mono text-[12px] leading-[18px] text-foreground">
          {status?.currentHome ?? t('settings.dataHome.loading')}
        </p>
        <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
          {t('settings.dataHome.switchNote')}
        </p>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="min-h-10 sm:min-h-8"
          disabled={!status}
          onClick={() => void bridge.openCurrent()
            .then((message) => { if (message) setError(t('settings.dataHome.openError')) })
            .catch(() => setError(t('settings.dataHome.openError')))}
        >
          {t('settings.dataHome.open')}
        </Button>
      </div>

      {lockDescription && (
        <p className="mt-3 rounded-lg border border-warning/30 bg-warning/5 px-3 py-2 text-[11px] leading-relaxed text-warning">
          {lockDescription}
        </p>
      )}
      {error && <p className="mt-3 text-[11px] text-destructive">{error}</p>}
    </>
  )

  if (embedded) {
    return (
      <div className="border-t border-border/60 pt-4">
        <h4 className="text-xs font-semibold text-foreground">{t('settings.dataHome.title')}</h4>
        <p className="mt-0.5 mb-2.5 text-[11px] leading-relaxed text-muted-foreground">
          {t('settings.dataHome.description')}
        </p>
        {body}
      </div>
    )
  }

  return (
    <ConfigSection
      title={t('settings.dataHome.title')}
      description={t('settings.dataHome.description')}
    >
      {body}
    </ConfigSection>
  )
}

export function WorkspaceShellSection({ embedded = false }: { embedded?: boolean } = {}) {
  const { t } = useTranslation()
  const [status, setStatus] = useState<WorkspaceShellStatus | null>(null)
  const [mode, setMode] = useState<'auto' | 'custom'>('auto')
  const [customPath, setCustomPath] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    preferencesApi.getWorkspaceShell()
      .then((next) => {
        setStatus(next)
        if (next.supported) {
          setMode(next.mode)
          setCustomPath(next.customPath ?? '')
        }
      })
      .catch(() => setStatus({ supported: false }))
  }, [])

  if (!status?.supported) return null

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      const next = await preferencesApi.saveWorkspaceShell({
        mode,
        ...(mode === 'custom' ? { customPath } : { customPath: null }),
      })
      setStatus(next)
      if (next.supported) {
        setMode(next.mode)
        setCustomPath(next.customPath ?? '')
      }
    } catch {
      setError(t('settings.workspaceShell.saveError'))
    } finally {
      setSaving(false)
    }
  }

  const body = (
    <>
      <Field label={t('settings.workspaceShell.mode')}>
        <select
          className={inputClass}
          value={mode}
          onChange={(event) => setMode(event.target.value as 'auto' | 'custom')}
        >
          <option value="auto">{t('settings.workspaceShell.auto')}</option>
          <option value="custom">{t('settings.workspaceShell.custom')}</option>
        </select>
      </Field>
      {mode === 'custom' && (
        <Field
          label={t('settings.workspaceShell.path')}
          description={t('settings.workspaceShell.pathDescription')}
        >
          <input
            data-testid="workspace-shell-path"
            className={`${inputClass} font-mono`}
            value={customPath}
            placeholder="C:\\Program Files\\Git\\bin\\bash.exe"
            onChange={(event) => setCustomPath(event.target.value)}
          />
        </Field>
      )}
      <div className="mb-3 rounded-lg border border-border/60 bg-secondary/50 px-3 py-2.5">
        <p className="text-[12px] font-medium text-muted-foreground">
          {t('settings.workspaceShell.resolved')}
        </p>
        <p className="mt-1 break-all font-mono text-[12px] leading-[18px] text-foreground">
          {status.resolvedPath ?? t('settings.workspaceShell.notFound')}
        </p>
        <p className={`mt-1 text-[11px] ${status.valid ? 'text-success' : 'text-destructive'}`}>
          {status.valid
            ? t('settings.workspaceShell.source', { source: status.source })
            : status.message ?? t('settings.workspaceShell.notFound')}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          size="sm"
          className="min-h-10 sm:min-h-8"
          disabled={saving || (mode === 'custom' && customPath.trim().length === 0)}
          onClick={() => void save()}
        >
          {saving ? t('settings.workspaceShell.saving') : t('settings.workspaceShell.save')}
        </Button>
        {error && <span className="text-[11px] text-destructive">{error}</span>}
      </div>
    </>
  )

  if (embedded) {
    return (
      <div className="border-t border-border/60 pt-4">
        <h4 className="text-xs font-semibold text-foreground">{t('settings.workspaceShell.title')}</h4>
        <p className="mt-0.5 mb-2.5 text-[11px] leading-relaxed text-muted-foreground">
          {t('settings.workspaceShell.description')}
        </p>
        {body}
      </div>
    )
  }

  return (
    <ConfigSection
      title={t('settings.workspaceShell.title')}
      description={t('settings.workspaceShell.description')}
    >
      {body}
    </ConfigSection>
  )
}
