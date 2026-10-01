import { useEffect, useState, type ReactNode } from 'react'
import { ArrowRight, ArrowUpCircle, CircleCheck, CircleAlert, CircleHelp, BarChart3, ExternalLink, FlaskConical, Folder, Info, LoaderCircle, MessageCircle, Monitor, RefreshCw, Server } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { Resources } from '../../i18n/locales/en'
import { useUpdateLifecycle } from '../../hooks/useUpdateLifecycle'
import { projectSetupFailures, useSharedProjectWorkspaceSetup } from '../../hooks/useProjectWorkspaceSetup'
import { useAliceProject } from '../../hooks/useAliceProject'
import { getBackendConnection } from '../../auth/backendConnection'
import { useBackendRecoverySignal } from '../../auth/AuthContext'
import { ConfigSection } from '../form'
import { Button } from '../ui/button'
import { Collapsible, CollapsibleContent, CollapsibleDetailsTrigger } from '../ui/collapsible'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../ui/dialog'
import { MachineUpgradeDialog } from './MachineUpgradeDialog'
import { ProjectUpdateReview } from './ProjectUpdateReview'
import { claimUpgradeDialog, shouldRestoreUpgradeDialog } from './upgrade-dialog-owner'
import { VERSION_OVERVIEW_ID } from '../../lib/updates/focusVersionOverview'

const version = (value?: string | null) => value ? `v${value.replace(/^v/, '')}` : '—'
type View = 'app' | 'backend' | 'project' | 'native-review' | 'native-progress' | 'backend-review' | null

export function VersionOverviewSection() {
  const { t } = useTranslation()
  const text = (key: keyof Resources['settings']['versions']) => t(`settings.versions.${key}`)
  const updates = useUpdateLifecycle()
  const setup = useSharedProjectWorkspaceSetup()
  const setupFailures = projectSetupFailures(setup?.setup ?? null, setup?.error ?? null)
  const { machines, nativeStatus } = updates
  const { project } = useAliceProject()
  const { backendUnavailable, backendRecoveryGeneration } = useBackendRecoverySignal()
  const [view, setView] = useState<View>(null)
  const [expanded, setExpanded] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)
  const integrated = getBackendConnection().kind === 'electron'
  const target = machines.status?.target
  const remote = Boolean(target && target.machine !== 'local')
  const appVersion = updates.client?.currentVersion
  const appCandidate = updates.nativeReady?.version ?? updates.client?.discovery.value?.latestVersion
  const appAvailable = Boolean(updates.nativeReady || updates.client?.discovery.value?.status === 'available')
  const backend = updates.versionInfo
  const projectName = project?.displayName ?? target?.projectName ?? text('projectUnknown')
  const machineName = target?.machineName ?? t('settings.backendConnection.thisMachine')
  const nativeBusy = updates.nativeInstalling || nativeStatus?.phase === 'installing'
  const backendBusy = machines.applying || machines.operation?.phase === 'running'
  const activeOperation = updates.operation && updates.operation.phase !== 'succeeded'
  const rows = updates.projectWorkspaces.map(item => {
    const workspace = item.workspace
    const state = updates.workspaceStates.find(value => value.workspaceId === workspace?.id)
    const current = state?.phase === 'updated' ? state.toVersion : state?.fromVersion ?? workspace?.currentVersion
    const candidate = state && ['available', 'blocked'].includes(state.phase) ? state.toVersion : undefined
    const failure = setupFailures.find(failure => failure.kind === item.kind)
    const error = item.error || (state?.phase === 'failed' ? state.reason : null) || failure?.reason
    const attention = Boolean(error || state?.phase === 'failed' || (state?.phase === 'blocked' && state.reason?.split(/\s*,\s*/).some(reason => reason !== 'active_runtime')))
    const status = item.error || (state?.phase === 'failed' && state.failureStage === 'check') ? text('checkFailed')
      : state?.phase === 'failed' ? text('needsAttention') : failure ? t('projectSetup.setupFailed') : !item.loaded || state?.phase === 'checking' ? text('loading') : !workspace ? text('notConfigured')
      : state?.phase === 'applying' ? text('updating') : state?.phase === 'blocked' ? text('waiting')
        : candidate ? text('available') : state?.phase === 'current' || state?.phase === 'updated' ? text('current') : text('unknown')
    return { ...item, current, candidate, attention, error, status }
  })
  const projectAvailable = rows.some(row => row.candidate)
  const projectError = updates.error || rows.find(row => row.error)?.error
  const projectStatus = activeOperation ? text('needsAttention') : projectError || setupFailures.length || rows.some(row => row.attention) ? text('needsAttention')
    : rows.some(row => row.status === text('updating')) ? text('updating') : projectAvailable ? text('available')
      : rows.some(row => !row.loaded) ? text('loading') : rows.every(row => !row.workspace) ? text('notConfigured')
        : rows.some(row => row.workspace && row.status === text('unknown')) ? text('unknown') : text('current')
  useEffect(() => {
    if (machines.operation?.mode === 'upgrade' && machines.operation.phase === 'running' && shouldRestoreUpgradeDialog('about')) setView('backend-review')
  }, [machines.operation?.id, machines.operation?.phase, machines.operation?.mode])
  useEffect(() => { if (!backendBusy && !nativeBusy) setView(null); setExpanded(false) }, [backendRecoveryGeneration]) // eslint-disable-line react-hooks/exhaustive-deps
  const open = (next: View) => { setLocalError(null); setView(next) }
  const reviewBackend = (force = false) => {
    if (!remote || !target) return
    claimUpgradeDialog('about'); open('backend-review')
    void machines.probe({ mode: 'upgrade', machineKey: target.machine, projectKey: target.project }, { force }).catch(() => undefined)
  }
  const appStatus = updates.clientError || updates.nativeError ? text('checkFailed')
    : nativeStatus?.phase === 'downloading' ? text('downloading')
      : appAvailable ? text('available') : updates.client?.discovery.value?.status === 'current' ? text('current') : text('unknown')
  const backendStatus = updates.versionError || backend?.error ? text('checkFailed')
    : backend?.hasUpdate ? text('available') : backend?.updateAuthority === 'service' ? t('settings.about.status.serviceManaged')
      : backend?.updateAuthority === 'none' ? t('settings.about.status.noUpdater')
        : backend?.updateAuthority === 'source' ? text('sourceManaged') : backend?.latest ? text('current') : text('unknown')
  const row = (kind: 'app' | 'backend' | 'project', icon: ReactNode, subtitle: ReactNode, identity: string, status: string, available: boolean, action: () => void, children?: ReactNode) => <section id={`settings-version-${kind}`} tabIndex={-1} className="min-w-0 scroll-mt-5 outline-none focus-visible:[box-shadow:var(--oa-focus-shadow)]">
    <div className="grid grid-cols-[1.5rem_minmax(0,1fr)] items-center gap-x-3 gap-y-3 px-4 py-5 sm:px-5 @3xl:grid-cols-[1.5rem_minmax(0,1fr)_10rem_14rem_7rem]">
      <div className={`self-start pt-0.5 ${available ? 'text-info' : 'text-muted-foreground'}`} aria-hidden>{icon}</div>
      <div className="min-w-0"><h3 className="text-sm font-semibold">{text(kind)}</h3><div className="mt-1 flex flex-wrap items-center gap-2 break-words text-sm text-muted-foreground">{subtitle}</div></div>
      {identity && <span className="col-start-2 min-w-0 break-words text-sm tabular-nums @3xl:col-start-3 @3xl:row-start-1">{identity}</span>}
      <span className={`col-start-2 flex items-start gap-1.5 text-sm @3xl:col-start-4 @3xl:row-start-1 ${available ? 'text-info' : status === text('needsAttention') || status === text('checkFailed') ? 'text-warning' : 'text-muted-foreground'}`}>
        {available ? <ArrowUpCircle className="mt-0.5 size-4 shrink-0" aria-hidden /> : status === text('current') ? <CircleCheck className="mt-0.5 size-4 shrink-0 text-success" aria-hidden /> : status === text('needsAttention') || status === text('checkFailed') ? <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden /> : <CircleHelp className="mt-0.5 size-4 shrink-0" aria-hidden />}
        <span className="min-w-0">{status}</span>
      </span>
      <div className="col-start-2 flex items-center @3xl:col-start-5 @3xl:row-start-1 @3xl:justify-end">
        {(available || (kind === 'project' && activeOperation)) && <Button size="sm" onClick={action}>{activeOperation && kind === 'project' ? text('viewProgress') : text('viewUpdate')}</Button>}
        {!available && kind !== 'project' && <Button variant="outline" size="sm" aria-label={`${text(kind)}: ${text('details')}`} onClick={action}>{text('details')}</Button>}
      </div>
    </div>{children}
  </section>
  const projectDetails = <Collapsible open={expanded} onOpenChange={setExpanded} className="mx-4 mb-4 ml-[52px] sm:mx-5 sm:ml-14">
    <CollapsibleDetailsTrigger>{text('projectDetails')}</CollapsibleDetailsTrigger>
    <CollapsibleContent><div className="space-y-4 border-l border-border pl-4 pt-4">
      {rows.map(item => <div key={item.kind} className="grid min-w-0 grid-cols-[1rem_minmax(0,1fr)] items-start gap-x-3 gap-y-2 @3xl:grid-cols-[1rem_minmax(0,1fr)_10rem_14rem_7rem]">
        <span className="pt-0.5 text-muted-foreground" aria-hidden>{item.kind === 'chat' ? <MessageCircle className="size-4" /> : item.kind === 'auto-quant' ? <BarChart3 className="size-4" /> : <FlaskConical className="size-4" />}</span>
        <div className="min-w-0"><p className="text-sm font-medium">{item.label}</p>{item.workspace && <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground"><span>{item.workspace.displayName || item.workspace.tag}</span><span className="rounded-full bg-secondary px-2 py-0.5">{text('defaultWorkspace')}</span></div>}</div>
        <div className="col-start-2 grid gap-x-3 gap-y-2 text-sm @3xl:col-start-3 @3xl:col-span-2 @3xl:row-start-1 @3xl:grid-cols-subgrid">{item.workspace && <span className="flex items-center gap-2 tabular-nums">{version(item.current)}{item.candidate && <><ArrowRight className="size-3 text-muted-foreground" /><span className="text-info">{version(item.candidate)}</span></>}</span>}<span className={`flex items-start gap-1.5 ${item.status === text('waiting') || item.attention ? 'text-warning' : item.candidate ? 'text-info' : 'text-muted-foreground'}`}>{item.status === text('current') ? <CircleCheck className="mt-0.5 size-4 shrink-0 text-success" aria-hidden /> : item.status === text('waiting') || item.attention ? <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden /> : item.candidate ? <ArrowUpCircle className="mt-0.5 size-4 shrink-0" aria-hidden /> : <CircleHelp className="mt-0.5 size-4 shrink-0" aria-hidden />}<span className="min-w-0">{item.status}</span></span></div>
        {item.error && <p role="alert" className="col-span-full break-words text-xs text-warning">{item.error}</p>}
      </div>)}
      {setupFailures.length > 0 && <Button variant="outline" size="sm" disabled={setup?.busy} onClick={() => { void setup?.retry() }}>{setup?.busy ? t('projectSetup.preparing') : t('common.retry')}</Button>}
      {setup?.error && <p role="alert" className="break-words text-xs text-warning">{setup.error}</p>}
      {updates.error && <p role="alert" className="break-words text-xs text-warning">{updates.error}</p>}
    </div></CollapsibleContent>
  </Collapsible>
  return <ConfigSection title={text('title')} headingLevel={2} titleId={VERSION_OVERVIEW_ID} focusableTitle accessory={
    <Button variant="ghost" size="sm" disabled={updates.checking} onClick={() => { void updates.refresh().catch(error => setLocalError(String(error))) }}>
      <RefreshCw className={`size-4 ${updates.checking ? 'animate-spin motion-reduce:animate-none' : ''}`} />{text('checkAgain')}
    </Button>
  }>
    <div className="@container divide-y divide-border/70 overflow-hidden rounded-xl border border-border/70 bg-background">
      {row('app', <Monitor className="size-5" />, window.openAlice?.updater ? text('desktop') : text('browser'), version(appVersion), appStatus, appAvailable, () => open(updates.nativeReady ? 'native-review' : 'app'))}
      {row('backend', <Server className="size-5" />, <><span>{machineName}</span><span className={`rounded-full px-2 py-0.5 ${backendUnavailable ? 'bg-warning/12 text-warning' : 'bg-success/10 text-success'}`}>{backendUnavailable ? text('offline') : text('connected')}</span></>, version(backend?.current), integrated ? text('integrated') : backendStatus, Boolean(backend?.hasUpdate), integrated ? () => open(updates.nativeReady ? 'native-review' : 'app') : remote && backend?.hasUpdate ? () => reviewBackend() : () => open('backend'))}
      {row('project', <Folder className="size-5" />, projectName, '', projectStatus, projectAvailable, () => open('project'), projectDetails)}
    </div>
    {localError && view === null && <p role="alert" className="mt-3 text-sm text-destructive">{localError}</p>}
    {view === 'backend-review' ? <MachineUpgradeDialog open plan={machines.plan?.mode === 'upgrade' ? machines.plan : null} operation={machines.operation} busy={machines.applying} checking={machines.probing} error={machines.operationError} onClose={() => setView(null)} onApply={() => { void machines.apply().then(() => updates.refresh()).catch(() => undefined) }} onRetry={() => reviewBackend(true)} /> : <Dialog open={view !== null} onOpenChange={next => { if (!next && !nativeBusy) setView(null) }}>
      <DialogContent showCloseButton={!nativeBusy} className="flex max-h-[calc(100dvh-2rem)] flex-col gap-0 overflow-hidden p-0" style={{ width: 'calc(100vw - 2rem)', maxWidth: 600 }}>
        <div className="border-b border-border px-5 py-5 pr-14 sm:px-6"><DialogTitle className="text-lg">{text(view === 'project' ? 'updateProject' : view === 'native-review' ? 'reviewApp' : view === 'native-progress' ? 'appProgress' : view === 'backend' ? 'backendDetails' : 'appDetails')}</DialogTitle><DialogDescription className="mt-1 text-sm">{view === 'project' ? projectName : text(view === 'native-review' ? 'restartNote' : view === 'native-progress' ? 'handoffNote' : 'detailsDescription')}</DialogDescription></div>
        {view === 'project' ? <ProjectUpdateReview onClose={() => setView(null)} /> : <>
        <div className="min-h-0 overflow-y-auto p-5 sm:p-6">
          {(view === 'app' || view === 'backend') && <>
            <div className="mb-6 flex flex-wrap items-center gap-3"><span className="text-3xl font-semibold tabular-nums">{version(view === 'app' ? appVersion : backend?.current)}</span><span className="rounded-full border border-border px-3 py-1 text-xs">{view === 'app' ? updates.client?.discovery.value?.channel ?? '—' : backend?.channel ?? '—'}</span></div>
            <dl className="grid gap-5 border-y border-border py-5 sm:grid-cols-2"><Fact label={text('runningVersion')} value={version(view === 'app' ? appVersion : backend?.current)}/><Fact label={text('installedVersion')} value={text('notReported')}/><Fact label={text('location')} value={view === 'app' ? t('settings.backendConnection.thisMachine') : machineName}/><Fact label={text('updateStatus')} value={view === 'app' ? appStatus : backendStatus}/></dl>
            {integrated && <p className="mt-4 rounded-lg bg-primary/5 p-3 text-sm">{text('integrated')}</p>}
            {view === 'app' && updates.client?.kind === 'cli' && <p className="mt-4 text-sm text-muted-foreground">{text('cliManaged')}</p>}
            {view === 'backend' && !remote && !integrated && <p className="mt-4 text-sm text-muted-foreground">{text('localManaged')}</p>}
            {(view === 'app' ? updates.clientError : updates.versionError || backend?.error) && <p role="alert" className="mt-5 text-sm text-warning">{view === 'app' ? updates.clientError : updates.versionError || backend?.error}</p>}
          </>}
          {view === 'native-review' && <><ReviewRow title={text('app')} detail={`${version(appVersion)} → ${version(updates.nativeReady?.version)}`}/><p className="mt-4 rounded-lg bg-primary/5 p-4 text-sm">{text('restartNote')}</p>{remote && <p className="mt-3 text-xs text-muted-foreground">{text('backendOptional')}</p>}</>}
          {view === 'native-progress' && <div role="status" className="space-y-5"><div className="flex items-center gap-3"><LoaderCircle className="size-6 animate-spin motion-reduce:animate-none text-primary"/><p>{nativeStatus?.phase === 'installing' ? t(`settings.about.status.installing.${nativeStatus.stage}`) : updates.nativeError || text('handoffNote')}</p></div><p className="text-sm text-muted-foreground">{text('handoffNote')}</p></div>}
          {(localError || updates.nativeError) && <p role="alert" className="mt-4 text-sm text-destructive">{localError || updates.nativeError}</p>}
        </div>
        <div className="flex flex-wrap justify-end gap-2 border-t border-border px-5 py-4 sm:px-6">
          {!nativeBusy && <Button variant="outline" onClick={() => setView(null)}>{text('close')}</Button>}
          {view === 'app' && !updates.nativeReady && <Button variant="outline" onClick={() => { void updates.openClientRelease(appCandidate).catch(error => setLocalError(String(error))) }}><ExternalLink className="size-4" />{t('settings.about.viewReleases')}</Button>}
          {(view === 'native-review' || view === 'app') && updates.nativeReady && <Button disabled={nativeBusy} onClick={() => { setView('native-progress'); void updates.installClient().catch(() => undefined) }}>{t('settings.about.installAndRestart')}</Button>}
        </div></>}
      </DialogContent>
    </Dialog>}
  </ConfigSection>
}
function Fact({ label, value }: { label: string; value: string }) { return <div><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-1 break-words text-sm font-medium">{value}</dd></div> }
function ReviewRow({ title, detail }: { title: string; detail: string }) { return <div className="flex items-center gap-3 border-b border-border pb-4"><Info className="size-5 shrink-0 text-primary" /><div className="min-w-0"><p className="font-medium">{title}</p><p className="mt-1 break-words text-sm text-muted-foreground">{detail}</p></div></div> }
