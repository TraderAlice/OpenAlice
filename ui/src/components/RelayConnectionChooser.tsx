import { useEffect, useState } from 'react'
import { ArrowRight, CircleAlert, LoaderCircle, Monitor, RefreshCw, Server } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from './ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './ui/dialog'
import { useRelayConnection, type RelayStatus } from '../hooks/useRelayConnection'

function LoadingRows({ count = 2 }: { count?: number }) {
  return <div aria-hidden="true" className="space-y-2">
    {Array.from({ length: count }, (_, index) => <div key={index} className="flex h-16 items-center gap-3 rounded-xl border border-border/70 px-4">
      <div className="skeleton size-4 shrink-0 rounded-full" />
      <div className="min-w-0 flex-1 space-y-2">
        <div className="skeleton h-3.5 w-2/5 rounded" />
        <div className="skeleton h-3 w-1/4 rounded" />
      </div>
    </div>)}
  </div>
}

export function RelayConnectionChooser({ open, onOpenChange, initialStatus }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  initialStatus?: RelayStatus | null
}) {
  const { t } = useTranslation()
  const relay = useRelayConnection(initialStatus)
  const [machineKey, setMachineKey] = useState<string | null>(null)
  const [projectKey, setProjectKey] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setMachineKey(initialStatus?.target?.machine ?? null)
    setProjectKey(initialStatus?.target?.project ?? null)
    void relay.refresh()
  }, [open, initialStatus?.target?.machine, initialStatus?.target?.project, relay.refresh])

  const current = relay.status?.target ?? initialStatus?.target
  const selectedMachine = relay.fleet.find((machine) => machine.key === machineKey)
  const selectedProject = selectedMachine?.projects.find((project) => project.key === projectKey)
  const currentMachineName = current?.machineName ?? (current?.machine === 'local' ? t('settings.backendConnection.thisMachine') : current?.machine)
  const currentProjectName = current?.projectName ?? current?.project
  const scanning = relay.loading && relay.fleet.length === 0
  const canConnect = selectedMachine && selectedProject?.available && selectedProject.runtime.webEndpoint
    && (selectedMachine.connection === 'local' || selectedMachine.connection === 'online')
  const isCurrent = current?.machine === machineKey && current?.project === projectKey

  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="flex max-h-[calc(100dvh-2rem)] min-w-0 flex-col gap-0 overflow-hidden p-0 sm:max-h-[min(44rem,calc(100dvh-3rem))] sm:max-w-[52rem]">
      <DialogHeader className="shrink-0 border-b border-border/70 px-5 pb-4 pt-5 pr-12 sm:px-6 sm:pr-12">
        <DialogTitle>{t('settings.backendConnection.change')}</DialogTitle>
        <DialogDescription>{t('settings.backendConnection.relayChooseDescription')}</DialogDescription>
        {current && <p className="min-w-0 truncate text-xs text-muted-foreground">
          {t('settings.backendConnection.currentLocation')}: <span className="font-medium text-foreground">{currentMachineName} · {currentProjectName}</span>
        </p>}
      </DialogHeader>

      <div className="min-h-0 space-y-5 overflow-y-auto px-5 py-5 sm:px-6">
        <section aria-labelledby="relay-machine-heading">
          <div className="mb-2 flex min-h-7 items-center justify-between gap-3">
            <h3 id="relay-machine-heading" className="text-sm font-medium">1. {t('settings.backendConnection.chooseAMachine')}</h3>
            {relay.loading ? <span role="status" className="flex items-center gap-1.5 text-xs text-muted-foreground"><LoaderCircle className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden />{t('settings.backendConnection.findingLocations')}</span>
              : <Button type="button" variant="ghost" size="sm" onClick={() => void relay.refresh()} disabled={relay.busy} className="h-7 gap-1.5 px-2 text-xs"><RefreshCw className="size-3.5" aria-hidden />{t('settings.backendConnection.retry')}</Button>}
          </div>
          {scanning ? <div className="grid gap-2 sm:grid-cols-2">
            {current && <div className="flex h-16 min-w-0 items-center gap-3 rounded-xl border border-border/70 px-3.5">
              {current.machine === 'local' ? <Monitor className="size-4 shrink-0" aria-hidden /> : <Server className="size-4 shrink-0" aria-hidden />}
              <span className="min-w-0"><span className="block truncate text-sm font-medium">{currentMachineName}</span><span className="block text-xs text-muted-foreground">{t('settings.backendConnection.currentLocation')}</span></span>
            </div>}
            <LoadingRows count={current ? 1 : 2} />
          </div> : relay.error && relay.fleet.length === 0 ? <p role="alert" className="rounded-lg bg-destructive/10 px-3 py-3 text-sm text-destructive">{relay.error}</p> : <div className="grid gap-2 sm:grid-cols-2">
            {relay.fleet.map((machine) => {
              const selected = machine.key === machineKey
              return <button key={machine.key} type="button" onClick={() => { setMachineKey(machine.key); setProjectKey(machine.key === current?.machine ? current.project : null) }}
                aria-pressed={selected} disabled={relay.busy}
                className={`flex min-w-0 items-center gap-3 rounded-xl border px-3.5 py-3 text-left transition-colors focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-60 ${selected ? 'border-primary bg-primary/5' : 'border-border/70 hover:bg-secondary'}`}>
                {machine.key === 'local' ? <Monitor className="size-4 shrink-0" aria-hidden /> : <Server className="size-4 shrink-0" aria-hidden />}
                <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{machine.displayName}</span><span className="block truncate text-xs text-muted-foreground">{machine.key === current?.machine ? t('settings.backendConnection.currentLocation') : machine.connection}</span></span>
                <span className={`size-4 shrink-0 rounded-full border ${selected ? 'border-[5px] border-primary' : 'border-muted-foreground/60'}`} aria-hidden />
              </button>
            })}
          </div>}
        </section>

        <section aria-labelledby="relay-project-heading" className="min-h-[10.5rem]">
          <div className="mb-2 flex min-h-7 items-center justify-between gap-3">
            <h3 id="relay-project-heading" className="text-sm font-medium">2. {t('settings.backendConnection.chooseAProject')}</h3>
            {scanning && <span role="status" className="flex items-center gap-1.5 text-xs text-muted-foreground"><LoaderCircle className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden />{t('settings.backendConnection.checkingProjects')}</span>}
          </div>
          {scanning ? <LoadingRows /> : selectedMachine?.issue ? <p className="flex gap-2 rounded-lg bg-destructive/10 px-3 py-3 text-sm text-destructive"><CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />{selectedMachine.issue.message}</p>
            : selectedMachine ? selectedMachine.projects.length ? <div className="divide-y divide-border/70 overflow-hidden rounded-xl border border-border/70">
              {selectedMachine.projects.map((project) => {
                const integrated = project.key === '@electron-current' && !!window.openAlice?.runtime
                const running = project.available && !!project.runtime.webEndpoint
                const selected = project.key === projectKey
                return <button key={project.key} type="button" onClick={() => setProjectKey(project.key)} aria-pressed={selected} disabled={relay.busy || (!running && !integrated)}
                  className={`flex w-full min-w-0 items-center gap-3 px-4 py-3 text-left transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed ${selected ? 'bg-primary/5' : 'hover:bg-secondary'} ${!running && !integrated ? 'opacity-55' : ''}`}>
                  <span className={`size-4 shrink-0 rounded-full border ${selected ? 'border-[5px] border-primary' : 'border-muted-foreground/60'}`} aria-hidden />
                  <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{integrated ? `${t('settings.backendConnection.thisElectronApp')} · ${project.displayName}` : project.displayName}</span>
                    <span className={`block text-xs ${running || integrated ? 'text-success' : 'text-muted-foreground'}`}>{integrated ? t('settings.backendConnection.currentIntegrated') : running ? t('settings.backendConnection.running') : t('settings.backendConnection.notRunning')}</span></span>
                </button>
              })}
            </div> : <p className="rounded-xl border border-border/70 px-4 py-5 text-sm text-muted-foreground">{t('settings.backendConnection.noProjects')}</p>
              : <p className="rounded-xl border border-border/70 px-4 py-5 text-sm text-muted-foreground">{t('settings.backendConnection.chooseMachine')}</p>}
        </section>

        <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3 rounded-xl border border-border/70 bg-muted/30 px-4 py-3 text-xs sm:gap-5" aria-live="polite">
          <div className="min-w-0"><span className="block text-muted-foreground">{t('settings.backendConnection.currentLocation')}</span><span className="block truncate font-medium">{current ? `${currentMachineName} · ${currentProjectName}` : '—'}</span></div>
          <ArrowRight className="size-4 text-muted-foreground" aria-hidden />
          <div className="min-w-0"><span className="block text-muted-foreground">{t('settings.backendConnection.destination')}</span><span className="block truncate font-medium">{selectedMachine && selectedProject ? `${selectedMachine.displayName} · ${selectedProject.displayName}` : '—'}</span></div>
        </div>
        {relay.error && relay.fleet.length > 0 && <p role="alert" className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{relay.error}</p>}
      </div>

      <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-border/70 px-5 py-3 sm:px-6">
        <Button type="button" variant="outline" size="sm" onClick={() => onOpenChange(false)}>{t('common.cancel', 'Cancel')}</Button>
        <Button type="button" size="sm" disabled={!canConnect || relay.loading || relay.busy || relay.status?.switching} onClick={() => { if (machineKey && projectKey) void relay.connect(machineKey, projectKey).catch(() => undefined) }}>
          {relay.busy || relay.status?.switching ? t('settings.backendConnection.checking') : isCurrent ? t('settings.backendConnection.reconnect') : t('settings.backendConnection.change')}
        </Button>
      </div>
    </DialogContent>
  </Dialog>
}
