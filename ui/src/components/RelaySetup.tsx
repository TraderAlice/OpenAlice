import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, Box, CircleAlert, LoaderCircle, Monitor, RefreshCw, Server, Plus } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from './ui/button'
import { type RelayStatus } from '../hooks/useRelayConnection'
import { useMachineControls } from '../hooks/useMachineControls'
import { StartupSshForm, StartupMachineReview, StartupProjectForm, type SshDraft } from './StartupForms'

/** Client-owned location choice: it renders before any AliceProject UI mounts. */
export function RelaySetup({ status }: { status: RelayStatus }) {
  const { t } = useTranslation()
  const relay = useMachineControls(status)
  const probeRequest = useRef(0)
  const heading = useRef<HTMLHeadingElement>(null)
  const machineHeading = useRef<HTMLHeadingElement>(null)
  const projectHeading = useRef<HTMLHeadingElement>(null)
  const previousPhonePane = useRef(false)
  const [machineKey, setMachineKey] = useState<string | null>(null)
  const [projectKey, setProjectKey] = useState<string | null>(null)
  const [step, setStep] = useState<'choose' | 'ssh' | 'checking' | 'prepare' | 'create'>('choose')
  const [draft, setDraft] = useState<SshDraft>({ label: '', host: '', user: '', port: '', identity: '' })
  const [newName, setNewName] = useState('')
  const [newHome, setNewHome] = useState('')
  const [openingPhase, setOpeningPhase] = useState<'creating' | 'starting' | 'connecting'>('connecting')
  const [opening, setOpening] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [showProjectsOnPhone, setShowProjectsOnPhone] = useState(false)

  useEffect(() => { heading.current?.focus() }, [step])
  useEffect(() => {
    if (previousPhonePane.current !== showProjectsOnPhone && window.matchMedia('(max-width: 767px)').matches) {
      const pane = showProjectsOnPhone ? projectHeading : machineHeading
      pane.current?.focus()
    }
    previousPhonePane.current = showProjectsOnPhone
  }, [showProjectsOnPhone])
  useEffect(() => () => { probeRequest.current++ }, [])
  useEffect(() => { void relay.refresh() }, [relay.refresh])
  useEffect(() => {
    if (!relay.fleet.length || machineKey !== null) return
    const saved = relay.startup?.target?.machine
    const preferred = relay.fleet.find((machine) => machine.key === saved)
    const local = relay.fleet.find((machine) => machine.key === 'local')
    setMachineKey((preferred ?? local ?? relay.fleet[0])?.key ?? null)
    setProjectKey(preferred ? relay.startup?.target?.project ?? null : null)
  }, [relay.fleet, relay.startup, machineKey])

  const machine = relay.fleet.find((item) => item.key === machineKey)
  const project = machine?.projects.find((item) => item.key === projectKey)
  const online = machine?.connection === 'online' || machine?.connection === 'local'
  const running = project?.runtime.class === 'electron-ipc' || project?.available && Boolean(project.runtime.webEndpoint)
  const stopped = ['absent', 'stopped'].includes(project?.runtime.class ?? '') || project?.runtime.state === 'stopped'
  const busy = opening || relay.busy || relay.applying || relay.operation?.phase === 'running'
  const canOpen = Boolean(online && project && (running || stopped) && !busy && !relay.status?.switching)
  const open = async () => {
    if (!machineKey || !projectKey) return
    setOpening(true); setActionError(null)
    try {
      if (!running) { setOpeningPhase('starting'); await relay.controlProject({ machine: machineKey, project: projectKey, action: 'start' }) }
      setOpeningPhase('connecting')
      await relay.connect(machineKey, projectKey)
    } catch (error) { setActionError(error instanceof Error ? error.message : String(error)) }
    finally { setOpening(false) }
  }
  const probeSsh = async () => {
    const request = ++probeRequest.current
    setStep('checking'); setActionError(null)
    try {
      await relay.probe({ mode: 'add', label: draft.label.trim(), sshTarget: draft.user.trim() ? `${draft.user.trim()}@${draft.host.trim()}` : draft.host.trim(), ...(draft.port ? { sshPort: Number(draft.port) } : {}), ...(draft.identity.trim() ? { identityFile: draft.identity.trim() } : {}) })
      if (request === probeRequest.current) setStep('prepare')
    } catch (error) {
      if (request === probeRequest.current) { setActionError(error instanceof Error ? error.message : String(error)); setStep('ssh') }
    }
  }
  const create = async () => {
    if (!machineKey) return
    setOpening(true); setActionError(null)
    try {
      setOpeningPhase('creating')
      await relay.controlProject({ machine: machineKey, project: newName, home: newHome.trim(), action: 'create' })
      setOpeningPhase('starting')
      await relay.controlProject({ machine: machineKey, project: newName, action: 'start' })
      setOpeningPhase('connecting')
      await relay.connect(machineKey, newName)
    } catch (error) { setActionError(error instanceof Error ? error.message : String(error)) }
    finally { setOpening(false) }
  }
  const saved = relay.startup?.target
  const savedMachine = relay.fleet.find((item) => item.key === saved?.machine)
  const savedLabel = saved ? `${savedMachine?.displayName ?? saved.machine} · ${savedMachine?.projects.find((item) => item.key === saved.project)?.displayName ?? saved.project}` : null
  const failure = relay.startup?.error

  return <main className="flex h-dvh flex-col overflow-hidden bg-background text-foreground">
    <header className="flex h-12 shrink-0 items-center border-b border-border/70 px-5 sm:px-8">
      <div className="flex items-center gap-2 text-sm font-semibold tracking-tight"><Box className="size-5 text-primary" aria-hidden />OpenAlice</div>
    </header>

    <div className="mx-auto flex w-full max-w-6xl min-h-0 flex-1 flex-col overflow-hidden px-5 py-[clamp(0.75rem,3dvh,1.75rem)] sm:px-8">
      {step !== 'choose' && <Button variant="ghost" className="mb-4 -ml-2 self-start" disabled={busy} onClick={() => { probeRequest.current++; relay.clearPlan(); setActionError(null); setStep('choose') }}><ArrowLeft className="size-4" />{t('common.back', 'Back')}</Button>}
      <div className="mb-[clamp(0.75rem,2dvh,1.5rem)] shrink-0">
        <p className="mb-2 text-xs font-medium uppercase tracking-[0.14em] text-primary">{t('settings.backendConnection.startupLabel', 'Startup location')}</p>
        <h1 ref={heading} tabIndex={-1} className="outline-none text-[clamp(1.5rem,4dvh,2.25rem)] font-semibold tracking-tight">{step === 'choose' ? t('settings.backendConnection.startupTitle') : t(`startup.title.${step}`)}</h1>
        <p className="mt-2 text-base text-muted-foreground">{step === 'choose' ? t('settings.backendConnection.startupDescription') : t(`startup.description.${step}`)}</p>
      </div>

      {step === 'choose' && failure && <div role="alert" className="mb-4 flex shrink-0 flex-wrap items-center gap-3 rounded-xl border border-warning/30 bg-warning/10 px-4 py-3 text-sm">
        <CircleAlert className="size-5 shrink-0 text-warning" aria-hidden />
        <div className="min-w-0 flex-1"><span className="font-medium">{savedLabel ? t('settings.backendConnection.savedUnavailable', '{{name}} is unavailable right now.', { name: savedLabel }) : t('settings.backendConnection.startupUnavailable', 'The startup location could not be checked.')}</span><span className="mt-0.5 block break-words text-muted-foreground">{failure}</span></div>
        <Button size="sm" variant="ghost" onClick={() => { if (saved) void relay.connect(saved.machine, saved.project).catch(() => undefined); else void relay.refresh() }} disabled={relay.loading || busy}>{t('settings.backendConnection.retry')}</Button>
      </div>}

      {relay.operation?.phase === 'running' && step !== 'prepare' && <p role="status" className="mb-5 flex items-center gap-3 text-sm"><LoaderCircle className="size-5 animate-spin motion-reduce:animate-none" aria-hidden />{t(`startup.stage.${relay.operation.stage}`)}</p>}
      {opening && <p role="status" className="mb-5 flex items-center gap-3 text-sm"><LoaderCircle className="size-5 animate-spin motion-reduce:animate-none" aria-hidden />{t(`startup.opening.${openingPhase}`)}</p>}
      {step !== 'choose' && <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain [scrollbar-width:thin]">
      {step === 'ssh' && <StartupSshForm value={draft} onChange={setDraft} busy={busy} onSubmit={() => void probeSsh()} />}
      {step === 'checking' && <div role="status" className="mx-auto w-full max-w-2xl space-y-5"><p className="flex items-center gap-3 text-sm"><LoaderCircle className="size-5 animate-spin motion-reduce:animate-none" aria-hidden />{t('startup.checkingMachine', { name: draft.label })}</p><div className="space-y-3">{[0, 1, 2].map(i => <div key={i} className="skeleton h-16 rounded-xl" />)}</div></div>}
      {step === 'prepare' && relay.plan && <StartupMachineReview plan={relay.plan} applying={busy} operation={relay.operation} onApply={() => { void relay.apply().then(result => { setMachineKey(result.machineKey); setProjectKey(null); setStep('choose') }).catch(error => { setActionError(error instanceof Error ? error.message : String(error)); setStep('ssh') }) }} />}
      {step === 'create' && <StartupProjectForm machine={machine?.displayName ?? ''} name={newName} home={newHome} onName={setNewName} onHome={setNewHome} busy={busy} onSubmit={() => void create()} />}
      </div>}
      {step === 'choose' && <div className="grid min-h-0 flex-1 gap-7 md:grid-cols-2 md:gap-0">
        <section aria-labelledby="startup-machines" className={`${showProjectsOnPhone ? 'hidden md:flex' : 'flex'} min-h-0 min-w-0 flex-col md:border-r md:border-border/70 md:pr-7`}>
          <div className="mb-3 flex shrink-0 items-center justify-between gap-3">
            <h2 ref={machineHeading} tabIndex={-1} id="startup-machines" className="text-lg font-semibold">{t('settings.backendConnection.machines', 'Machines')} <span className="ml-1 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">{relay.fleet.length}</span></h2>
            <Button variant="ghost" size="sm" onClick={() => void relay.refresh()} disabled={relay.loading || relay.busy} aria-label={t('settings.backendConnection.retry')}><RefreshCw className={`size-4 ${relay.loading ? 'animate-spin motion-reduce:animate-none' : ''}`} aria-hidden /></Button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain [scrollbar-width:thin]">
          {relay.loading && relay.fleet.length === 0 ? <div role="status" className="space-y-2" aria-label={t('settings.backendConnection.findingLocations')}>{[0, 1, 2].map((index) => <div key={index} className="skeleton h-[5.5rem] rounded-xl" />)}</div>
            : relay.error && relay.fleet.length === 0 ? <p role="alert" className="rounded-xl border border-destructive/30 p-4 text-sm text-destructive">{relay.error}</p>
              : <div className="space-y-2">{relay.fleet.map((entry) => {
                const selected = entry.key === machineKey
                const online = entry.connection === 'local' || entry.connection === 'online'
                const isDefault = entry.key === saved?.machine
                return <button key={entry.key} type="button" aria-pressed={selected} disabled={busy} onClick={() => { setMachineKey(entry.key); setProjectKey(null); setShowProjectsOnPhone(true) }} className={`flex w-full min-w-0 items-center gap-4 rounded-xl border px-4 py-4 text-left transition-colors focus-visible:outline-2 focus-visible:outline-primary ${selected ? 'border-primary bg-primary/10' : 'border-border/70 hover:bg-muted/60'}`}>
                  {entry.key === 'local' ? <Monitor className="size-6 shrink-0" aria-hidden /> : <Server className="size-6 shrink-0" aria-hidden />}
                  <span className="min-w-0 flex-1"><span className="block truncate font-medium">{entry.displayName}</span><span className="mt-1 flex items-center gap-2 text-sm text-muted-foreground"><span className={`size-2 rounded-full ${online ? 'bg-success' : 'bg-warning'}`} aria-hidden />{entry.connection}</span></span>
                  {isDefault && <span className="hidden shrink-0 rounded-md bg-warning/10 px-2 py-1 text-xs text-warning sm:inline">{t('settings.backendConnection.startupDefault')}</span>}
                  <ArrowRight className="size-4 shrink-0 text-muted-foreground md:hidden" aria-hidden />
                </button>
              })}</div>}
          </div>
          <Button variant="outline" className="mt-3 shrink-0 self-start" disabled={busy} onClick={() => { relay.clearPlan(); setActionError(null); setStep('ssh') }}><Plus className="size-4" />{t('startup.addSsh')}</Button>
        </section>

        <section aria-labelledby="startup-projects" className={`${!showProjectsOnPhone ? 'hidden md:flex' : 'flex'} min-h-0 min-w-0 flex-col md:pl-7`}>
          <div className="mb-3 flex min-h-9 shrink-0 items-center gap-2">
            <Button variant="ghost" size="sm" className="-ml-2 md:hidden" onClick={() => setShowProjectsOnPhone(false)} aria-label={t('common.back', 'Back')}><ArrowLeft className="size-4" aria-hidden /></Button>
            <h2 ref={projectHeading} tabIndex={-1} id="startup-projects" className="min-w-0 truncate text-lg font-semibold">{t('settings.backendConnection.projectsOn', 'AliceProjects on {{machine}}', { machine: machine?.displayName ?? '—' })}</h2>
            {machine && <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">{machine.projects.length}</span>}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain [scrollbar-width:thin]">
          {machine?.issue && !(failure && machine.key === saved?.machine) && <p role="alert" className="mb-3 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{machine.issue.message}</p>}
          {!machine ? <p className="rounded-xl border border-border/70 p-5 text-sm text-muted-foreground">{t('settings.backendConnection.chooseMachine')}</p> : machine.projects.length === 0 ? <p className="rounded-xl border border-border/70 p-5 text-sm text-muted-foreground">{t('settings.backendConnection.noProjects')}</p> : <div className="space-y-2">{machine.projects.map((entry) => {
            const running = online && (entry.runtime.class === 'electron-ipc' || entry.available && Boolean(entry.runtime.webEndpoint))
            const selected = entry.key === projectKey
            return <button key={entry.key} type="button" aria-pressed={selected} disabled={busy} onClick={() => setProjectKey(entry.key)} className={`flex w-full min-w-0 items-center gap-4 rounded-xl border px-4 py-4 text-left transition-colors focus-visible:outline-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-50 ${selected ? 'border-primary bg-primary/10' : 'border-border/70 hover:bg-muted/60'}`}>
              <Box className="size-6 shrink-0" aria-hidden /><span className="min-w-0 flex-1"><span className="block truncate font-medium">{entry.displayName}</span><span className="mt-1 flex items-center gap-2 text-sm text-muted-foreground"><span className={`size-2 rounded-full ${running ? 'bg-success' : 'bg-muted-foreground'}`} aria-hidden />{!online ? t('startup.unavailable') : running ? t('settings.backendConnection.running') : ['absent', 'stopped'].includes(entry.runtime.class) || entry.runtime.state === 'stopped' ? t('startup.stopped') : t('startup.unavailable')}</span></span><ArrowRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            </button>
          })}</div>}
          </div>
          {online && <Button variant="outline" className="mt-3 shrink-0 self-start" disabled={busy} onClick={() => { setActionError(null); setStep('create') }}><Plus className="size-4" />{t('startup.createProject')}</Button>}
        </section>
      </div>}
    </div>

    <footer className="shrink-0 border-t border-border/70 bg-background/95 px-5 py-4 backdrop-blur sm:px-8">
      <div className="mx-auto flex w-full max-w-6xl items-center gap-4">
        <p className="min-w-0 flex-1 text-sm text-muted-foreground">{t('settings.backendConnection.rememberStartup')}</p>
        {step === 'choose' && <Button className="min-w-0 max-w-[55%] shrink-0" disabled={!canOpen} onClick={() => void open()}>
          {busy ? <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" aria-hidden /> : <ArrowRight className="size-4" aria-hidden />}
          <span className="truncate">{busy ? t('settings.backendConnection.checking') : project ? !online ? t('startup.unavailable') : running ? t('settings.backendConnection.openProject', { name: project.displayName }) : t('startup.startOpen') : t('startup.chooseProject')}</span>
        </Button>}
      </div>
      {(actionError || relay.operationError || relay.error) && <p role="alert" className="mx-auto mt-3 max-h-[20dvh] w-full max-w-6xl overflow-y-auto break-words text-sm text-destructive">{actionError ?? relay.operationError ?? relay.error}</p>}
    </footer>
  </main>
}
