import { Select } from '@/components/ui/select'
import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertCircle, CircleCheck, CircleMinus, ChevronDown, LoaderCircle, Monitor, Plus, RefreshCw, Server } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { useUpdateLifecycle } from '../../hooks/useUpdateLifecycle'
import { Button } from '../ui/button'
import { ContextHelp } from '../ContextHelp'
import { AddMachineDialog } from './AddMachineDialog'
import { MachineUpgradeDialog } from './MachineUpgradeDialog'
import { claimUpgradeDialog, shouldRestoreUpgradeDialog } from './upgrade-dialog-owner'

/** Machine management for the local relay and Electron's main process. */
export function MachineManagementSection() {
  const { t } = useTranslation()
  const manager = useUpdateLifecycle().machines
  const [expanded, setExpanded] = useState<string | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [added, setAdded] = useState(false)
  const addRef = useRef<HTMLButtonElement>(null)
  const onAdded = useCallback(() => { setAddOpen(false); setAdded(true) }, [])
  const [upgradeProjects, setUpgradeProjects] = useState<Record<string, string>>({})
  const [upgradeOpen, setUpgradeOpen] = useState(false)

  useEffect(() => { void manager.refresh() }, [manager.refresh])
  useEffect(() => { if (manager.operation?.mode === 'upgrade' && manager.operation.phase === 'running' && shouldRestoreUpgradeDialog('machines')) setUpgradeOpen(true) }, [manager.operation?.id, manager.operation?.phase, manager.operation?.mode])
  useEffect(() => { if (manager.operation?.mode === 'add' && manager.operation.phase === 'running') setAddOpen(true) }, [manager.operation?.id, manager.operation?.phase, manager.operation?.mode])
  const running = manager.applying || manager.operation?.phase === 'running'
  const busy = manager.loading || manager.probing || running
  const available = Boolean(manager.status || window.openAlice?.desktopConnection)

  const show = (key: string) => {
    manager.clearPlan()
    setExpanded((current) => current === key ? null : key)
  }
  const add = () => { manager.clearPlan(); setAdded(false); setAddOpen(true) }
  const apply = () => { void manager.apply().then(() => setExpanded(null)).catch(() => undefined) }

  return <section aria-label={t('settings.machines.title')}>
    {added && <p role="status" className="mb-3 text-xs text-success">{t('settings.machines.added')}</p>}
    <div className="min-w-0 overflow-hidden rounded-xl border border-border/70 bg-card">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/70 px-3 py-3 sm:px-4">
        <div className="flex items-center gap-2 text-sm text-muted-foreground"><Server className="size-4" aria-hidden />{t('settings.machines.saved', 'Saved Machines')}<ContextHelp label={t('settings.machines.title')}>{`${t('settings.machines.description')} ${t('settings.machines.localControl')}`}</ContextHelp></div>
        <div className="flex items-center gap-1.5">
          <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => void manager.refresh()} className="min-h-9 gap-1.5"><RefreshCw className={`size-3.5 ${manager.loading ? 'animate-spin motion-reduce:animate-none' : ''}`} aria-hidden />{t('settings.machines.refresh', 'Refresh')}</Button>
          <Button type="button" variant="outline" size="sm" ref={addRef} disabled={!available || busy} onClick={add} className="min-h-9 gap-1.5"><Plus className="size-3.5" aria-hidden />{t('settings.machines.add', 'Add Machine')}</Button>
        </div>
      </div>

      <div className="min-h-[4rem] divide-y divide-border/70" aria-busy={manager.loading}>
        {manager.loading && manager.fleet.length === 0 ? <p role="status" className="flex min-h-16 items-center gap-2 px-4 text-sm text-muted-foreground"><LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" aria-hidden />{t('settings.machines.finding', 'Checking saved Machines…')}</p> : manager.fleet.map((machine) => {
          const local = machine.key === 'local'
          const open = expanded === machine.key
          const online = machine.connection === 'online' || machine.connection === 'local'
          const ConnectionIcon = online ? CircleCheck : CircleMinus
          const current = manager.status?.target?.machine === machine.key
          const selectableProjects = machine.projects.filter((project) => project.available && ['running', 'absent'].includes(project.runtime.class))
          const selectedProject = selectableProjects.find((project) => project.key === upgradeProjects[machine.key])
            ?? selectableProjects.find((project) => current && project.key === manager.status?.target?.project)
            ?? selectableProjects.find((project) => project.key === machine.defaultProject)
            ?? selectableProjects[0]
          return <div key={machine.key} className="min-w-0">
            <button type="button" disabled={local || busy} onClick={() => show(machine.key)} aria-expanded={local ? undefined : open} className="flex min-h-[4.25rem] w-full min-w-0 items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-secondary/50 focus-visible:outline-none focus-visible:[box-shadow:var(--oa-focus-shadow)] disabled:cursor-default sm:px-4">
              {local ? <Monitor className="size-4 shrink-0 text-muted-foreground" aria-hidden /> : <Server className="size-4 shrink-0 text-muted-foreground" aria-hidden />}
              <span className="min-w-0 flex-1"><span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-medium"><span className="min-w-0 break-words">{machine.displayName}</span>{current && <span className="rounded-full bg-secondary px-2 py-0.5 text-sm text-foreground">{t('settings.machines.current', 'Current')}</span>}</span><span className="block truncate text-sm text-muted-foreground">{machine.sshTarget ?? (local ? t('settings.backendConnection.thisMachine') : '')}</span></span>
              <span className={`inline-flex shrink-0 items-center gap-2 text-sm ${online ? 'text-success' : 'text-muted-foreground'}`}><ConnectionIcon className="size-4" aria-hidden />{machine.connection}</span>
              {!local && <ChevronDown className={`size-4 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none ${open ? 'rotate-180' : ''}`} aria-hidden />}
            </button>
            {open && !local && <div className="border-t border-border/70 bg-secondary/20 px-3 py-4 sm:px-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2 text-sm"><p className="font-medium">{t('settings.machines.health', 'Health & installation')}</p><p className="flex justify-between gap-2"><span className="text-muted-foreground">SSH</span><span>{machine.connection}</span></p><p className="flex justify-between gap-2"><span className="text-muted-foreground">OpenAlice CLI</span><span>{machine.cliVersion ?? '—'}</span></p><p className="flex justify-between gap-2"><span className="text-muted-foreground">AliceProjects</span><span>{machine.projects.length}</span></p></div>
                <div className="flex min-w-0 flex-col justify-between gap-3"><div><p className="text-sm font-medium">{t('settings.machines.update', 'Check for update')}</p><p className="mt-1 text-sm text-muted-foreground">{t('settings.machines.updateDescription', 'Check this Machine’s update channel and review the installation and activation plan.')}</p>{selectableProjects.length > 0 && <label className="mt-2 block text-sm text-muted-foreground">AliceProject<Select className="mt-1" value={selectedProject?.key ?? ''} onValueChange={(selectedValue) => { setUpgradeProjects((value) => ({ ...value, [machine.key]: selectedValue })); manager.clearPlan() }}
                  options={selectableProjects.map((project) => ({ value: project.key, label: project.displayName }))}
                /></label>}</div><Button type="button" variant="outline" size="sm" disabled={busy} className="min-h-9 self-start" onClick={() => void manager.probe({ mode: 'upgrade', machineKey: machine.key, ...(selectedProject ? { projectKey: selectedProject.key } : {}) }).then(() => { claimUpgradeDialog('machines'); setUpgradeOpen(true) }).catch(() => undefined)}>{manager.probing ? <LoaderCircle className="mr-2 size-4 animate-spin motion-reduce:animate-none" aria-hidden /> : <RefreshCw className="mr-2 size-4" aria-hidden />}{t('settings.machines.checkUpdate', 'Probe and review')}</Button></div>
              </div>
              {machine.issue && <p role="status" className="mt-3 text-sm text-muted-foreground">{machine.issue.message}</p>}
            </div>}
          </div>
        })}
      </div>
      {!addOpen && manager.operationError && <p role="alert" className="flex gap-2 border-t border-border/70 px-3 py-3 text-sm text-destructive sm:px-4"><AlertCircle className="size-4 shrink-0" aria-hidden />{manager.operationError}</p>}
      {manager.error && <p role="alert" className="flex gap-2 border-t border-border/70 px-3 py-3 text-sm text-destructive sm:px-4"><AlertCircle className="size-4 shrink-0" aria-hidden />{manager.error}</p>}
      {available && !manager.loading && manager.fleet.length === 0 && !manager.error && <p className="px-4 py-3 text-sm text-muted-foreground">{t('settings.machines.none', 'No Machines found.')}</p>}
    </div>
    {!available && !manager.loading && <p role="status" className="mt-3 text-xs text-muted-foreground">{t('settings.machines.unavailable')}</p>}
    {addOpen && <AddMachineDialog manager={manager} onClose={() => setAddOpen(false)} onAdded={onAdded} restoreFocusRef={addRef} />}
    <MachineUpgradeDialog open={upgradeOpen} plan={manager.plan?.mode === 'upgrade' ? manager.plan : null} operation={manager.operation} busy={manager.applying} error={manager.operationError} onClose={() => { setUpgradeOpen(false); manager.clearPlan() }} onApply={apply} onRetry={() => {
      const plan = manager.plan
      if (plan?.mode === 'upgrade' && plan.machine.key) void manager.probe({ mode: 'upgrade', machineKey: plan.machine.key, ...(plan.project ? { projectKey: plan.project.key } : {}) }).catch(() => undefined)
    }} />
  </section>
}
