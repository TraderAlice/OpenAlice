import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertCircle, ChevronDown, LoaderCircle, Monitor, Plus, RefreshCw, Server, ShieldCheck } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import type { RelayProject } from '../../hooks/useRelayConnection'
import { useUpdateLifecycle } from '../../hooks/useUpdateLifecycle'
import { Button } from '../ui/button'
import { inputClass } from '../form'
import { AddMachineDialog } from './AddMachineDialog'
import { MachineUpgradeDialog } from './MachineUpgradeDialog'
import { claimUpgradeDialog, shouldRestoreUpgradeDialog } from './upgrade-dialog-owner'

function isProjectRunnable(project: RelayProject): boolean {
  return (project.available && Boolean(project.runtime?.webEndpoint))
    || (project.key === '@electron-current' && Boolean(window.openAlice?.runtime))
}

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
  useEffect(() => {
    if (manager.operation?.mode === 'upgrade' && manager.operation.phase === 'running' && shouldRestoreUpgradeDialog('machines')) {
      setUpgradeOpen(true)
    }
  }, [manager.operation?.id, manager.operation?.phase, manager.operation?.mode])
  useEffect(() => {
    if (manager.operation?.mode === 'add' && manager.operation.phase === 'running') {
      setAddOpen(true)
    }
  }, [manager.operation?.id, manager.operation?.phase, manager.operation?.mode])

  const running = manager.applying || manager.operation?.phase === 'running'
  const switching = Boolean(manager.busy)
  const busy = manager.loading || manager.probing || running || switching
  const available = Boolean(manager.status || window.openAlice?.desktopConnection)

  const toggleExpanded = (key: string) => {
    manager.clearPlan()
    setExpanded((current) => current === key ? null : key)
  }
  const add = () => { manager.clearPlan(); setAdded(false); setAddOpen(true) }
  const apply = () => { void manager.apply().then(() => setExpanded(null)).catch(() => undefined) }

  return (
    <section aria-label={t('settings.machines.title')} className="@container min-w-0">
      <p className="mb-5 text-[13px] leading-5 text-muted-foreground">{t('settings.machines.description')}</p>
      {added && <p role="status" className="mb-3 text-xs text-success">{t('settings.machines.added')}</p>}
      <div className="min-w-0 overflow-hidden rounded-xl border border-border/70 bg-card">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/70 px-3 py-3 sm:px-4">
          <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
            <Server className="size-4" aria-hidden />
            {t('settings.machines.saved', 'Saved Machines')}
          </div>
          <div className="flex items-center gap-1.5">
            <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => void manager.refresh()} className="min-h-9 gap-1.5">
              <RefreshCw className={`size-3.5 ${manager.loading ? 'animate-spin motion-reduce:animate-none' : ''}`} aria-hidden />
              {t('settings.machines.refresh', 'Refresh')}
            </Button>
            <Button type="button" variant="outline" size="sm" ref={addRef} disabled={!available || busy} onClick={add} className="min-h-9 gap-1.5">
              <Plus className="size-3.5" aria-hidden />
              {t('settings.machines.add', 'Add Machine')}
            </Button>
          </div>
        </div>

        <div className="min-h-[4rem] divide-y divide-border/70" aria-busy={manager.loading}>
          {manager.loading && manager.fleet.length === 0 ? (
            <p role="status" className="flex min-h-16 items-center gap-2 px-4 text-[12px] text-muted-foreground">
              <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" aria-hidden />
              {t('settings.machines.finding', 'Checking saved Machines…')}
            </p>
          ) : manager.fleet.map((machine) => {
            const local = machine.key === 'local'
            const canExpand = !local || machine.projects.length > 0
            const open = canExpand && expanded === machine.key
            const online = machine.connection === 'online' || machine.connection === 'local'
            const current = manager.status?.target?.machine === machine.key
            const isDefault = manager.startup?.target?.machine === machine.key
            const runnableProjects = machine.projects.filter(isProjectRunnable)
            const canSwitch = !current && online && runnableProjects.length > 0
            const selectableProjects = machine.projects.filter(
              (project) => project.available && ['running', 'absent'].includes(project.runtime.class),
            )
            const selectedProject = selectableProjects.find((project) => project.key === upgradeProjects[machine.key])
              ?? selectableProjects.find((project) => current && project.key === manager.status?.target?.project)
              ?? selectableProjects.find((project) => project.key === machine.defaultProject)
              ?? selectableProjects[0]
            const subtitle = [
              machine.sshTarget ?? (local ? t('settings.backendConnection.thisMachine', 'This machine') : ''),
              machine.cliVersion ? `v${machine.cliVersion.replace(/^v/, '')}` : '',
            ].filter(Boolean).join(' · ')
            const statusColor = online
              ? 'text-success'
              : machine.connection === 'incompatible'
                ? 'text-warning'
                : 'text-muted-foreground'
            const statusDotColor = online
              ? 'bg-success'
              : machine.connection === 'incompatible'
                ? 'bg-warning'
                : 'bg-muted-foreground/60'

            const projectTarget = manager.status?.target?.project
            const sortedProjects = [...machine.projects].sort((a, b) => {
              const rank = (project: RelayProject) => (current && projectTarget === project.key ? 0 : isProjectRunnable(project) ? 1 : 2)
              return rank(a) - rank(b)
            })

            return (
              <div key={machine.key} className="min-w-0">
                <div className="flex min-h-[4.25rem] w-full min-w-0 items-center gap-2 px-3 py-2 transition-colors hover:bg-secondary/35 sm:px-4">
                  <button
                    type="button"
                    onClick={() => toggleExpanded(machine.key)}
                    disabled={!canExpand || busy}
                    aria-expanded={canExpand ? open : undefined}
                    className="-mx-1.5 flex min-w-0 flex-1 items-center gap-3 rounded-md px-1.5 py-1 text-left focus-visible:outline-none focus-visible:[box-shadow:var(--oa-focus-shadow)] disabled:cursor-default"
                  >
                    {local
                      ? <Monitor className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                      : <Server className="size-4 shrink-0 text-muted-foreground" aria-hidden />}
                    <span className="min-w-0 flex-1">
                      <span className="flex min-w-0 flex-wrap items-center gap-1.5 text-[13px] font-medium">
                        <span className="truncate">{machine.displayName}</span>
                        {current && (
                          <span className="shrink-0 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary">
                            {t('settings.machines.current', 'Current')}
                          </span>
                        )}
                        {isDefault && (
                          <span className="shrink-0 rounded-full border border-border bg-secondary px-1.5 py-0.5 text-[10px] text-muted-foreground">
                            {t('settings.machines.defaultBadge', 'Default')}
                          </span>
                        )}
                      </span>
                      {subtitle && (
                        <span className="block truncate text-[11px] text-muted-foreground">{subtitle}</span>
                      )}
                    </span>
                    <span className={`shrink-0 text-[11px] ${statusColor}`}>
                      <span className={`mr-1.5 inline-block size-1.5 rounded-full ${statusDotColor}`} aria-hidden />
                      {machine.connection}
                    </span>
                  </button>
                  <div className="flex shrink-0 items-center gap-1.5">
                    {canSwitch && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={busy}
                        onClick={() => {
                          if (runnableProjects.length === 1) {
                            void manager.connect?.(machine.key, runnableProjects[0].key).catch(() => undefined)
                          } else {
                            manager.clearPlan()
                            setExpanded(machine.key)
                          }
                        }}
                      >
                        {switching
                          ? t('settings.machines.switching', 'Switching…')
                          : t('settings.machines.switch', 'Switch')}
                      </Button>
                    )}
                    {canExpand ? (
                      <button
                        type="button"
                        onClick={() => toggleExpanded(machine.key)}
                        disabled={busy}
                        aria-expanded={open}
                        aria-label={open ? t('common.close', 'Close') : t('settings.versions.details', 'Details')}
                        className="inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:[box-shadow:var(--oa-focus-shadow)] disabled:opacity-50"
                      >
                        <ChevronDown
                          className={`size-4 transition-transform motion-reduce:transition-none ${open ? 'rotate-180' : ''}`}
                          aria-hidden
                        />
                      </button>
                    ) : (
                      <span className="size-8 shrink-0" aria-hidden />
                    )}
                  </div>
                </div>

                {open && (
                  <div className="space-y-4 border-t border-border/70 bg-secondary/20 px-3 py-4 sm:px-4">
                    {sortedProjects.length > 0 && (
                      <div className="space-y-2">
                        <h4 className="text-[12px] font-medium text-foreground">
                          {t('settings.machines.projectsHeading', 'AliceProjects on this Machine')}
                        </h4>
                        <ul className="divide-y divide-border/60 overflow-hidden rounded-lg border border-border/70 bg-background/70">
                          {sortedProjects.map((project) => {
                            const projectRunnable = isProjectRunnable(project)
                            const isCurrentProject = current && manager.status?.target?.project === project.key
                            return (
                              <li
                                key={project.key}
                                className="flex min-w-0 flex-wrap items-center justify-between gap-2 px-3 py-2.5"
                              >
                                <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                                  <span className="truncate text-[13px] font-medium text-foreground" title={project.home ?? project.key}>
                                    {project.displayName}
                                  </span>
                                  <span
                                    className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] ${
                                      isCurrentProject
                                        ? 'bg-primary/10 text-primary'
                                        : projectRunnable
                                          ? 'bg-success/10 text-success'
                                          : 'bg-secondary text-muted-foreground'
                                    }`}
                                  >
                                    {isCurrentProject
                                      ? t('settings.backendConnection.connected', 'Connected')
                                      : projectRunnable
                                        ? t('settings.backendConnection.running', 'Running')
                                        : t('settings.backendConnection.notRunning', 'Not running · start from CLI first')}
                                  </span>
                                </div>
                                {online && projectRunnable && !isCurrentProject && (
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    disabled={busy}
                                    onClick={() => void manager.connect?.(machine.key, project.key).catch(() => undefined)}
                                  >
                                    {t('settings.backendConnection.connect', 'Connect')}
                                  </Button>
                                )}
                              </li>
                            )
                          })}
                        </ul>
                      </div>
                    )}

                    {!local && (
                      <div className="grid gap-4 @lg:grid-cols-2">
                        <div className="space-y-2 text-[12px]">
                          <p className="font-medium">{t('settings.machines.health', 'Health & installation')}</p>
                          <p className="flex justify-between gap-2">
                            <span className="text-muted-foreground">SSH</span>
                            <span>{machine.connection}</span>
                          </p>
                          <p className="flex justify-between gap-2">
                            <span className="text-muted-foreground">OpenAlice CLI</span>
                            <span>{machine.cliVersion ?? '—'}</span>
                          </p>
                          <p className="flex justify-between gap-2">
                            <span className="text-muted-foreground">AliceProjects</span>
                            <span>{machine.projects.length}</span>
                          </p>
                        </div>
                        <div className="flex min-w-0 flex-col justify-between gap-3">
                          <div>
                            <p className="text-[12px] font-medium">{t('settings.machines.update', 'Check for update')}</p>
                            <p className="mt-1 text-[12px] text-muted-foreground">
                              {t('settings.machines.updateDescription', 'Check this Machine’s update channel and review the installation and activation plan.')}
                            </p>
                            {selectableProjects.length > 0 && (
                              <label className="mt-2 block text-[12px] text-muted-foreground">
                                AliceProject
                                <select
                                  className={`${inputClass} mt-1`}
                                  value={selectedProject?.key ?? ''}
                                  onChange={(event) => {
                                    setUpgradeProjects((value) => ({ ...value, [machine.key]: event.target.value }))
                                    manager.clearPlan()
                                  }}
                                >
                                  {selectableProjects.map((project) => (
                                    <option key={project.key} value={project.key}>{project.displayName}</option>
                                  ))}
                                </select>
                              </label>
                            )}
                          </div>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={busy}
                            className="min-h-9 self-start"
                            onClick={() => void manager.probe({
                              mode: 'upgrade',
                              machineKey: machine.key,
                              ...(selectedProject ? { projectKey: selectedProject.key } : {}),
                            }).then(() => { claimUpgradeDialog('machines'); setUpgradeOpen(true) }).catch(() => undefined)}
                          >
                            {manager.probing
                              ? <LoaderCircle className="mr-2 size-4 animate-spin motion-reduce:animate-none" aria-hidden />
                              : <RefreshCw className="mr-2 size-4" aria-hidden />}
                            {t('settings.machines.checkUpdate', 'Probe and review')}
                          </Button>
                        </div>
                      </div>
                    )}

                    {machine.issue && (
                      <p role="status" className="text-[12px] text-muted-foreground">{machine.issue.message}</p>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {!addOpen && manager.operationError && (
          <p role="alert" className="flex gap-2 border-t border-border/70 px-3 py-3 text-[12px] text-destructive sm:px-4">
            <AlertCircle className="size-4 shrink-0" aria-hidden />
            {manager.operationError}
          </p>
        )}
        {manager.error && (
          <p role="alert" className="flex gap-2 border-t border-border/70 px-3 py-3 text-[12px] text-destructive sm:px-4">
            <AlertCircle className="size-4 shrink-0" aria-hidden />
            {manager.error}
          </p>
        )}
        {available && !manager.loading && manager.fleet.length === 0 && !manager.error && (
          <p className="px-4 py-3 text-[12px] text-muted-foreground">{t('settings.machines.none', 'No Machines found.')}</p>
        )}
      </div>

      {!available && !manager.loading && (
        <p role="status" className="mt-3 text-xs text-muted-foreground">{t('settings.machines.unavailable')}</p>
      )}
      {addOpen && <AddMachineDialog manager={manager} onClose={() => setAddOpen(false)} onAdded={onAdded} restoreFocusRef={addRef} />}
      <MachineUpgradeDialog
        open={upgradeOpen}
        plan={manager.plan?.mode === 'upgrade' ? manager.plan : null}
        operation={manager.operation}
        busy={manager.applying}
        error={manager.operationError}
        onClose={() => { setUpgradeOpen(false); manager.clearPlan() }}
        onApply={apply}
        onRetry={() => {
          const plan = manager.plan
          if (plan?.mode === 'upgrade' && plan.machine.key) {
            void manager.probe({
              mode: 'upgrade',
              machineKey: plan.machine.key,
              ...(plan.project ? { projectKey: plan.project.key } : {}),
            }).catch(() => undefined)
          }
        }}
      />
      <p className="mt-2 flex items-start gap-1.5 text-[11px] leading-relaxed text-muted-foreground">
        <ShieldCheck className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        {t('settings.machines.localControl', 'Machine profiles and SSH actions belong to this computer; AliceProject data stays on its Runtime.')}
      </p>
    </section>
  )
}
