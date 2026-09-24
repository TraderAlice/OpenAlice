import { useEffect, useMemo, useState } from 'react'
import { CheckCircle2, Download, ExternalLink, LoaderCircle, RefreshCw, Server } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { useMachineManagement } from '../../hooks/useMachineManagement'
import { useVersionInfo } from '../../hooks/useVersionInfo'
import { Button } from '../ui/button'
import { ConfigSection } from '../form'
import { MachineUpgradeDialog } from './MachineUpgradeDialog'
import { claimUpgradeDialog, shouldRestoreUpgradeDialog } from './upgrade-dialog-owner'

type RuntimeMode = 'browser' | 'electron-dev' | 'electron-packaged'
type NativeUpdaterStatus =
  | { phase: 'available'; version?: string; releaseUrl?: string }
  | { phase: 'downloading'; version?: string; percent?: number }
  | { phase: 'downloaded'; version: string; releaseUrl: string }
  | { phase: 'installing'; version: string; stage: 'preparing' | 'stopping-services' | 'releasing-runtime' | 'handing-off' }
  | { phase: 'error'; message: string }

const RELEASES_URL = 'https://github.com/TraderAlice/OpenAlice/releases'
const UI_VERSION = typeof __OPENALICE_UI_VERSION__ === 'string' ? __OPENALICE_UI_VERSION__ : 'development'

export function AboutOpenAliceSection() {
  const { t } = useTranslation()
  const [runtimeMode, setRuntimeMode] = useState<RuntimeMode>('browser')
  const [nativeStatus, setNativeStatus] = useState<NativeUpdaterStatus | null>(null)
  const [checking, setChecking] = useState(false)
  const [installing, setInstalling] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [upgradeOpen, setUpgradeOpen] = useState(false)
  const { info: versionInfo, error: versionError, check: checkVersion } = useVersionInfo()
  const machines = useMachineManagement()
  useEffect(() => { if (machines.operation?.mode === 'upgrade' && machines.operation.phase === 'running' && shouldRestoreUpgradeDialog('about')) setUpgradeOpen(true) }, [machines.operation?.id, machines.operation?.phase, machines.operation?.mode])
  const target = machines.status?.target
  const remote = Boolean(target && target.machine !== 'local')
  const updater = window.openAlice?.updater

  useEffect(() => {
    let active = true
    const runtime = window.openAlice?.runtime
    if (runtime) {
      void runtime.info().then((info) => {
        if (active) setRuntimeMode(info.mode)
      }).catch(() => {})
    }
    const nativeUpdater = window.openAlice?.updater
    if (!nativeUpdater) return () => { active = false }
    void nativeUpdater.getStatus().then((status) => {
      if (active && status) setNativeStatus(status)
    }).catch(() => {})
    const unsubscribe = nativeUpdater.onStatus((status) => {
      if (active) setNativeStatus(status)
    })
    return () => { active = false; unsubscribe() }
  }, [])

  const backendVersion = versionInfo?.current ?? t('settings.about.versionLoading')
  const updateVersion = nativeStatus && 'version' in nativeStatus && nativeStatus.version
    ? nativeStatus.version
    : versionInfo?.hasUpdate ? versionInfo.latest : null
  const webUpdateCheckOwned = !remote && (versionInfo === null || (
    versionInfo.updateAuthority === 'source'
    || versionInfo.updateAuthority === 'desktop'
    || (versionInfo.updateAuthority === 'cli' && versionInfo.channel !== 'dev')
  ))

  const backendStatus = useMemo(() => {
    if (checking && !updater) return { kind: 'checking' as const, text: t('settings.about.status.checking') }
    if (versionError || versionInfo?.error || (error && !remote && !updater)) return { kind: 'error' as const, text: t('settings.about.status.error') }
    if (!versionInfo) return { kind: 'checking' as const, text: t('settings.about.status.loading') }
    if (remote) return { kind: 'managed' as const, text: t('settings.about.backendRelayManaged') }
    if (versionInfo.hasUpdate) return { kind: 'available' as const, text: versionInfo.latest
      ? t('settings.about.status.available', { version: versionInfo.latest })
      : t('settings.about.status.availableUnknown') }
    if (versionInfo.updateAuthority === 'service') return { kind: 'current' as const, text: t('settings.about.status.serviceManaged') }
    if (versionInfo.updateAuthority === 'none') return { kind: 'current' as const, text: t('settings.about.status.noUpdater') }
    if (versionInfo.updateAuthority === 'cli' && versionInfo.channel === 'dev') return { kind: 'current' as const, text: t('settings.about.status.cliManaged') }
    return { kind: 'current' as const, text: t('settings.about.status.current') }
  }, [checking, error, remote, t, updater, versionError, versionInfo])

  const nativeMessage = nativeStatus?.phase === 'downloaded'
    ? t('settings.about.status.ready', { version: nativeStatus.version })
    : nativeStatus?.phase === 'installing'
      ? t(`settings.about.status.installing.${nativeStatus.stage}`)
      : nativeStatus?.phase === 'downloading'
        ? typeof nativeStatus.percent === 'number'
          ? t('settings.about.status.downloadingProgress', { percent: Math.round(nativeStatus.percent) })
          : t('settings.about.status.downloading')
        : nativeStatus?.phase === 'available'
          ? updateVersion ? t('settings.about.status.available', { version: updateVersion }) : t('settings.about.status.availableUnknown')
          : nativeStatus?.phase === 'error' || error ? t('settings.about.status.error')
            : checking && updater ? t('settings.about.status.checking') : null
  const nativeBusy = checking || nativeStatus?.phase === 'downloading' || nativeStatus?.phase === 'installing'
  const backendTone = backendStatus.kind === 'error'
    ? 'border-destructive/25 bg-destructive/10 text-destructive'
    : backendStatus.kind === 'managed' ? 'border-border/70 bg-background/50 text-muted-foreground'
    : backendStatus.kind === 'current' ? 'border-success/25 bg-success/10 text-success'
      : 'border-primary/25 bg-primary-muted/30 text-primary'
  const BackendIcon = backendStatus.kind === 'current' ? CheckCircle2 : backendStatus.kind === 'checking' ? LoaderCircle : RefreshCw

  const checkForUpdates = async () => {
    setChecking(true)
    setError(null)
    try {
      const nativeCheck = updater?.checkForUpdates().catch(() => null)
      const backendCheck = !updater || !remote ? checkVersion() : Promise.resolve(null)
      const [, next] = await Promise.all([nativeCheck ?? Promise.resolve(null), backendCheck])
      if (next?.error) setError(t('settings.about.checkError'))
    } catch {
      setError(t('settings.about.checkError'))
    } finally { setChecking(false) }
  }

  const openRelease = async () => {
    setError(null)
    try {
      if (updater) await updater.openRelease(updateVersion ?? undefined)
      else window.open(RELEASES_URL, '_blank', 'noopener,noreferrer')
    } catch { setError(t('settings.about.openReleaseError')) }
  }

  const installAndRestart = async () => {
    if (!updater) return
    setInstalling(true)
    setError(null)
    try { await updater.installAndRestart() }
    catch { setError(t('settings.about.installError')); setInstalling(false) }
  }

  const probeBackend = () => {
    if (!target || target.machine === 'local') return
    void machines.probe({ mode: 'upgrade', machineKey: target.machine, projectKey: target.project }).then(() => { claimUpgradeDialog('about'); setUpgradeOpen(true) }).catch(() => undefined)
  }
  const applyBackend = () => {
    void machines.apply().then(() => checkVersion()).catch(() => undefined)
  }

  return <ConfigSection title={t('settings.about.title')}>
    <div className="min-w-0 rounded-lg border border-border/70 bg-secondary/35 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <img src="/alice.ico" alt="" className="size-11 shrink-0 object-contain" />
          <div className="min-w-0">
            <p className="text-[11px] font-medium text-muted-foreground">{t('settings.about.clientLabel')}</p>
            <p className="text-[14px] font-semibold text-foreground">OpenAlice <span className="font-mono text-[12px] text-muted-foreground">v{UI_VERSION}</span></p>
          </div>
        </div>
        <span className="rounded-full border border-border bg-background px-2 py-0.5 text-[10px] leading-[14px] text-muted-foreground">
          {t(`settings.about.runtime.${runtimeMode}`)}
        </span>
      </div>

      {updater && <div className="mt-3">
        {nativeMessage && <div className="oa-status-surface flex items-center gap-2 rounded-lg border border-primary/25 bg-primary-muted/30 px-3 py-2.5 text-[12px] text-primary" aria-live="polite">
          {nativeBusy ? <LoaderCircle className="size-4 shrink-0 animate-spin motion-reduce:animate-none" aria-hidden /> : <Download className="size-4 shrink-0" aria-hidden />}
          <span className="font-medium">{nativeMessage}</span>
        </div>}
        {(nativeStatus?.phase === 'downloading' || nativeStatus?.phase === 'installing') && <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-primary/15" role="progressbar" aria-label={nativeMessage ?? undefined} aria-valuemin={0} aria-valuemax={100} {...(nativeStatus.phase === 'downloading' && typeof nativeStatus.percent === 'number' ? { 'aria-valuenow': Math.round(nativeStatus.percent) } : {})}>
          <div className={`h-full rounded-full bg-primary transition-[width] duration-300 motion-reduce:transition-none ${nativeStatus.phase === 'installing' ? 'animate-pulse motion-reduce:animate-none' : ''}`} style={{ width: nativeStatus.phase === 'downloading' && typeof nativeStatus.percent === 'number' ? `${Math.max(2, Math.min(100, nativeStatus.percent))}%` : '100%' }} />
        </div>}
        {nativeStatus?.phase === 'installing' && <p className="mt-2 text-[11px] text-muted-foreground">{t('settings.about.installHandoffNote')}</p>}
        <div className="mt-3 flex flex-wrap gap-2">
          {nativeStatus?.phase === 'downloaded' || nativeStatus?.phase === 'installing'
            ? <Button type="button" size="sm" className="min-h-10 sm:min-h-8" disabled={installing || nativeStatus.phase === 'installing'} onClick={() => void installAndRestart()}><RefreshCw className={`size-3.5 ${installing ? 'animate-spin motion-reduce:animate-none' : ''}`} aria-hidden />{installing || nativeStatus.phase === 'installing' ? t('settings.about.installing') : t('settings.about.installAndRestart')}</Button>
            : <Button type="button" size="sm" className="min-h-10 sm:min-h-8" disabled={checking} onClick={() => void checkForUpdates()}><RefreshCw className={`size-3.5 ${checking ? 'animate-spin motion-reduce:animate-none' : ''}`} aria-hidden />{checking ? t('settings.about.checking') : t('settings.about.check')}</Button>}
        </div>
      </div>}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" className="min-h-10 sm:min-h-8" onClick={() => void openRelease()}><ExternalLink className="size-3.5" aria-hidden />{t('settings.about.viewReleases')}</Button>
      </div>
      {error && <p role="alert" className="mt-2 text-[12px] text-destructive">{error}</p>}

      <div className="mt-4 border-t border-border/70 pt-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground"><Server className="size-3.5" aria-hidden />{t('settings.about.backendLabel')}</p>
            <p className="mt-1 text-[14px] font-semibold text-foreground">{target?.machineName ?? t('settings.backendConnection.thisMachine')}{target?.projectName && <span className="font-normal text-muted-foreground"> · {target.projectName}</span>}</p>
          </div>
          <div className="text-right"><p className="font-mono text-[13px] font-medium tabular-nums">v{backendVersion}</p>{versionInfo && <p className="text-[11px] text-muted-foreground">{t(`settings.about.channel.${versionInfo.channel}`)}</p>}</div>
        </div>
        <div className={`oa-status-surface mt-3 flex items-center gap-2 rounded-lg border px-3 py-2.5 text-[12px] leading-[18px] ${backendTone}`} aria-live="polite">
          <BackendIcon className={`size-4 shrink-0 ${backendStatus.kind === 'checking' ? 'animate-spin motion-reduce:animate-none' : ''}`} aria-hidden />
          <span className="font-medium">{backendStatus.text}</span>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {remote && <Button type="button" size="sm" className="min-h-10 sm:min-h-8" disabled={machines.probing || machines.applying} onClick={probeBackend}><RefreshCw className={`size-3.5 ${machines.probing ? 'animate-spin motion-reduce:animate-none' : ''}`} aria-hidden />{machines.probing ? t('settings.machines.probing') : t('settings.about.reviewBackendUpdate')}</Button>}
          {!remote && !updater && webUpdateCheckOwned && <Button type="button" size="sm" className="min-h-10 sm:min-h-8" disabled={checking} onClick={() => void checkForUpdates()}><RefreshCw className={`size-3.5 ${checking ? 'animate-spin motion-reduce:animate-none' : ''}`} aria-hidden />{checking ? t('settings.about.checking') : t('settings.about.check')}</Button>}
        </div>
        <MachineUpgradeDialog open={upgradeOpen} plan={machines.plan?.mode === 'upgrade' ? machines.plan : null} operation={machines.operation} busy={machines.applying} error={machines.operationError} onClose={() => { setUpgradeOpen(false); machines.clearPlan() }} onApply={applyBackend} onRetry={probeBackend} />
        {machines.operationError && <p role="alert" className="mt-2 text-[12px] text-destructive">{machines.operationError}</p>}
      </div>
    </div>
  </ConfigSection>
}
