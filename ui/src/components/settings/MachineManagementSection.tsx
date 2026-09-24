import { useEffect, useState } from 'react'
import { AlertCircle, ChevronDown, LoaderCircle, Monitor, Plus, RefreshCw, Server, ShieldCheck } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { useMachineManagement } from '../../hooks/useMachineManagement'
import { Button } from '../ui/button'
import { ConfigSection, inputClass } from '../form'
import { MachinePlanReview } from './MachinePlanReview'
import { MachineUpgradeDialog } from './MachineUpgradeDialog'
import { claimUpgradeDialog, shouldRestoreUpgradeDialog } from './upgrade-dialog-owner'

/** Inline Machine management for the local relay and Electron's main process. */
export function MachineManagementSection() {
  const { t } = useTranslation()
  const manager = useMachineManagement()
  const [expanded, setExpanded] = useState<string | null>(null)
  const [sshTarget, setSshTarget] = useState('')
  const [label, setLabel] = useState('')
  const [sshPort, setSshPort] = useState('')
  const [identityFile, setIdentityFile] = useState('')
  const [upgradeProjects, setUpgradeProjects] = useState<Record<string, string>>({})
  const [upgradeOpen, setUpgradeOpen] = useState(false)

  useEffect(() => { void manager.refresh() }, [manager.refresh])
  useEffect(() => { if (manager.operation?.mode === 'upgrade' && manager.operation.phase === 'running' && shouldRestoreUpgradeDialog('machines')) setUpgradeOpen(true) }, [manager.operation?.id, manager.operation?.phase, manager.operation?.mode])
  if (!manager.status && !window.openAlice?.desktopConnection) return null
  const busy = manager.loading || manager.probing || manager.applying

  const show = (key: string) => {
    manager.clearPlan()
    setExpanded((current) => current === key ? null : key)
  }
  const add = () => {
    manager.clearPlan()
    setExpanded((current) => current === '@add' ? null : '@add')
  }
  const probeAdd = () => {
    const port = sshPort.trim() ? Number(sshPort) : undefined
    if (port !== undefined && (!Number.isInteger(port) || port < 1 || port > 65535)) return
    void manager.probe({ mode: 'add', sshTarget: sshTarget.trim(), label: label.trim(), ...(port === undefined ? {} : { sshPort: port }), ...(identityFile.trim() ? { identityFile: identityFile.trim() } : {}) }).catch(() => undefined)
  }
  const apply = () => { void manager.apply().then(() => setExpanded(null)).catch(() => undefined) }

  return <ConfigSection title={t('settings.machines.title', 'Machines')} description={t('settings.machines.description', 'Inspect and manage the computers where Alice can work.')}>
    <div className="min-w-0 overflow-hidden rounded-xl border border-border/70 bg-card">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/70 px-3 py-3 sm:px-4">
        <div className="flex items-center gap-2 text-[12px] text-muted-foreground"><Server className="size-4" aria-hidden />{t('settings.machines.saved', 'Saved Machines')}</div>
        <div className="flex items-center gap-1.5">
          <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => void manager.refresh()} className="min-h-9 gap-1.5"><RefreshCw className={`size-3.5 ${manager.loading ? 'animate-spin motion-reduce:animate-none' : ''}`} aria-hidden />{t('settings.machines.refresh', 'Refresh')}</Button>
          <Button type="button" variant="outline" size="sm" disabled={manager.applying} onClick={add} className="min-h-9 gap-1.5"><Plus className="size-3.5" aria-hidden />{t('settings.machines.add', 'Add Machine')}</Button>
        </div>
      </div>

      {expanded === '@add' && <div className="border-b border-border/70 bg-secondary/25 px-3 py-4 sm:px-4">
        <h4 className="text-[13px] font-semibold">{t('settings.machines.addTitle', 'Add a Machine')}</h4>
        <p className="mt-1 text-[12px] text-muted-foreground">{t('settings.machines.probeOnly', 'Probe is read-only. Review any install, update, or start actions before they run.')}</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="min-w-0 text-[12px]">{t('settings.machines.sshTarget', 'SSH target')}<input className={`${inputClass} mt-1`} value={sshTarget} onChange={(event) => { setSshTarget(event.target.value); manager.clearPlan() }} placeholder="alice@server.example.com" autoComplete="off" /></label>
          <label className="min-w-0 text-[12px]">{t('settings.machines.label', 'Machine label')}<input className={`${inputClass} mt-1`} value={label} onChange={(event) => { setLabel(event.target.value); manager.clearPlan() }} placeholder="Cloud Linux" autoComplete="off" /></label>
          <label className="min-w-0 text-[12px]">{t('settings.machines.sshPort', 'SSH port')} <span className="text-muted-foreground">({t('settings.machines.optional', 'optional')})</span><input className={`${inputClass} mt-1`} type="number" min="1" max="65535" value={sshPort} onChange={(event) => { setSshPort(event.target.value); manager.clearPlan() }} placeholder="22" /></label>
          <label className="min-w-0 text-[12px]">{t('settings.machines.identityFile', 'Local SSH key path')} <span className="text-muted-foreground">({t('settings.machines.optional', 'optional')})</span><input className={`${inputClass} mt-1`} value={identityFile} onChange={(event) => { setIdentityFile(event.target.value); manager.clearPlan() }} placeholder="~/.ssh/id_ed25519" autoComplete="off" /></label>
        </div>
        <div className="mt-3 flex items-center justify-between gap-3">
          <span role="status" className="text-[12px] text-muted-foreground">{manager.probing ? t('settings.machines.probing', 'Checking SSH and remote Runtime…') : t('settings.machines.sshNote', 'Uses this computer’s OpenSSH configuration.')}</span>
          <Button type="button" size="sm" disabled={busy || !sshTarget.trim() || !label.trim() || Boolean(sshPort.trim() && (!Number.isInteger(Number(sshPort)) || Number(sshPort) < 1 || Number(sshPort) > 65535))} onClick={probeAdd} className="min-h-9 shrink-0">{manager.probing && <LoaderCircle className="mr-2 size-4 animate-spin motion-reduce:animate-none" aria-hidden />}{t('settings.machines.probe', 'Probe Machine')}</Button>
        </div>
        {manager.plan?.mode === 'add' && <MachinePlanReview plan={manager.plan} busy={manager.applying} onApply={apply} />}
      </div>}

      <div className="min-h-[4rem] divide-y divide-border/70" aria-busy={manager.loading}>
        {manager.loading && manager.fleet.length === 0 ? <p role="status" className="flex min-h-16 items-center gap-2 px-4 text-[12px] text-muted-foreground"><LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" aria-hidden />{t('settings.machines.finding', 'Checking saved Machines…')}</p> : manager.fleet.map((machine) => {
          const local = machine.key === 'local'
          const open = expanded === machine.key
          const online = machine.connection === 'online' || machine.connection === 'local'
          const current = manager.status?.target?.machine === machine.key
          const runningProjects = machine.projects.filter((project) => project.available && project.runtime.class === 'running')
          const selectedProject = runningProjects.find((project) => project.key === upgradeProjects[machine.key])
            ?? runningProjects.find((project) => current && project.key === manager.status?.target?.project)
            ?? runningProjects.find((project) => project.key === machine.defaultProject)
            ?? runningProjects[0]
          return <div key={machine.key} className="min-w-0">
            <button type="button" disabled={local || manager.applying} onClick={() => show(machine.key)} aria-expanded={local ? undefined : open} className="flex min-h-[4.25rem] w-full min-w-0 items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-secondary/50 focus-visible:outline-none focus-visible:[box-shadow:var(--oa-focus-shadow)] disabled:cursor-default sm:px-4">
              {local ? <Monitor className="size-4 shrink-0 text-muted-foreground" aria-hidden /> : <Server className="size-4 shrink-0 text-muted-foreground" aria-hidden />}
              <span className="min-w-0 flex-1"><span className="block truncate text-[13px] font-medium">{machine.displayName}{current && <span className="ml-2 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary">{t('settings.machines.current', 'Current')}</span>}</span><span className="block truncate text-[11px] text-muted-foreground">{machine.sshTarget ?? (local ? t('settings.backendConnection.thisMachine') : '')}</span></span>
              <span className={`shrink-0 text-[11px] ${online ? 'text-success' : 'text-muted-foreground'}`}><span className={`mr-1.5 inline-block size-1.5 rounded-full ${online ? 'bg-success' : 'bg-muted-foreground/60'}`} aria-hidden />{machine.connection}</span>
              {!local && <ChevronDown className={`size-4 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none ${open ? 'rotate-180' : ''}`} aria-hidden />}
            </button>
            {open && !local && <div className="border-t border-border/70 bg-secondary/20 px-3 py-4 sm:px-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2 text-[12px]"><p className="font-medium">{t('settings.machines.health', 'Health & installation')}</p><p className="flex justify-between gap-2"><span className="text-muted-foreground">SSH</span><span>{machine.connection}</span></p><p className="flex justify-between gap-2"><span className="text-muted-foreground">OpenAlice CLI</span><span>{machine.cliVersion ?? '—'}</span></p><p className="flex justify-between gap-2"><span className="text-muted-foreground">AliceProjects</span><span>{machine.projects.length}</span></p></div>
                <div className="flex min-w-0 flex-col justify-between gap-3"><div><p className="text-[12px] font-medium">{t('settings.machines.update', 'Check for update')}</p><p className="mt-1 text-[12px] text-muted-foreground">{t('settings.machines.updateDescription', 'Compare this Machine with the local OpenAlice release and review a safe plan.')}</p>{runningProjects.length > 0 && <label className="mt-2 block text-[12px] text-muted-foreground">AliceProject<select className={`${inputClass} mt-1`} value={selectedProject?.key ?? ''} onChange={(event) => { setUpgradeProjects((value) => ({ ...value, [machine.key]: event.target.value })); manager.clearPlan() }}>{runningProjects.map((project) => <option key={project.key} value={project.key}>{project.displayName}</option>)}</select></label>}</div><Button type="button" variant="outline" size="sm" disabled={busy} className="min-h-9 self-start" onClick={() => void manager.probe({ mode: 'upgrade', machineKey: machine.key, ...(selectedProject ? { projectKey: selectedProject.key } : {}) }).then(() => { claimUpgradeDialog('machines'); setUpgradeOpen(true) }).catch(() => undefined)}>{manager.probing ? <LoaderCircle className="mr-2 size-4 animate-spin motion-reduce:animate-none" aria-hidden /> : <RefreshCw className="mr-2 size-4" aria-hidden />}{t('settings.machines.checkUpdate', 'Probe and review')}</Button></div>
              </div>
              {machine.issue && <p role="status" className="mt-3 text-[12px] text-muted-foreground">{machine.issue.message}</p>}
            </div>}
          </div>
        })}
      </div>
      {manager.operationError && <p role="alert" className="flex gap-2 border-t border-border/70 px-3 py-3 text-[12px] text-destructive sm:px-4"><AlertCircle className="size-4 shrink-0" aria-hidden />{manager.operationError}</p>}
      {manager.error && <p role="alert" className="flex gap-2 border-t border-border/70 px-3 py-3 text-[12px] text-destructive sm:px-4"><AlertCircle className="size-4 shrink-0" aria-hidden />{manager.error}</p>}
      {!manager.loading && manager.fleet.length === 0 && !manager.error && <p className="px-4 py-3 text-[12px] text-muted-foreground">{t('settings.machines.none', 'No Machines found.')}</p>}
    </div>
    <MachineUpgradeDialog open={upgradeOpen} plan={manager.plan?.mode === 'upgrade' ? manager.plan : null} operation={manager.operation} busy={manager.applying} error={manager.operationError} onClose={() => { setUpgradeOpen(false); manager.clearPlan() }} onApply={apply} onRetry={() => {
      const plan = manager.plan
      if (plan?.mode === 'upgrade' && plan.machine.key) void manager.probe({ mode: 'upgrade', machineKey: plan.machine.key, ...(plan.project ? { projectKey: plan.project.key } : {}) }).catch(() => undefined)
    }} />
    <p className="mt-2 flex items-start gap-1.5 text-[11px] leading-relaxed text-muted-foreground"><ShieldCheck className="mt-0.5 size-3.5 shrink-0" aria-hidden />{t('settings.machines.localControl', 'Machine profiles and SSH actions belong to this computer; AliceProject data stays on its Runtime.')}</p>
  </ConfigSection>
}
