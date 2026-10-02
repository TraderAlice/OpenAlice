import { useTranslation } from 'react-i18next'
import { LoaderCircle } from 'lucide-react'
import { inputClass } from './form'
import { Button } from './ui/button'
import type { MachineOperation, MachinePlan } from '../lib/updates/machine-types'

export interface SshDraft { label: string; host: string; user: string; port: string; identity: string }

export function StartupSshForm({ value, onChange, onSubmit, busy }: { value: SshDraft; onChange: (next: SshDraft) => void; onSubmit: () => void; busy: boolean }) {
  const { t } = useTranslation()
  const field = (key: keyof SshDraft, label: string, placeholder: string) => <label className="block min-w-0 text-sm font-medium">{label}<input className={`${inputClass} mt-2 w-full`} value={value[key]} onChange={event => onChange({ ...value, [key]: event.target.value })} placeholder={placeholder} disabled={busy} autoComplete="off" /></label>
  const validPort = !value.port || Number.isInteger(Number(value.port)) && Number(value.port) > 0 && Number(value.port) <= 65535
  return <form className="mx-auto w-full max-w-xl space-y-5" onSubmit={event => { event.preventDefault(); if (!busy && validPort && value.host.trim() && value.label.trim()) onSubmit() }}>
    {field('label', t('settings.machines.label'), 'Research server')}
    {field('host', t('startup.host'), 'server.example.com or SSH alias')}
    <div className="grid grid-cols-2 gap-4">{field('user', t('startup.user'), 'alice')}{field('port', t('settings.machines.sshPort'), '22')}</div>
    {!validPort && <p role="alert" className="text-sm text-destructive">{t('startup.invalidPort')}</p>}
    <p className="text-sm text-muted-foreground">{t('startup.sshAuth')}</p>
    <details className="rounded-lg border border-border/70 p-4"><summary className="cursor-pointer text-sm">{t('startup.advanced')}</summary><div className="mt-4">{field('identity', t('settings.machines.identityFile'), '~/.ssh/id_ed25519')}</div></details>
    <p className="text-xs leading-relaxed text-muted-foreground">{t('startup.relaySsh')}</p>
    <div className="flex justify-end"><Button type="submit" disabled={busy || !validPort || !value.host.trim() || !value.label.trim()}>{t('startup.testSsh')}</Button></div>
  </form>
}

export function StartupMachineReview({ plan, operation, applying, onApply }: { plan: MachinePlan; operation: MachineOperation | null; applying: boolean; onApply: () => void }) {
  const { t } = useTranslation()
  return <div className="mx-auto w-full max-w-2xl space-y-5">
    <dl className="grid gap-4 rounded-xl border border-border/70 p-5 sm:grid-cols-2"><div><dt className="text-sm text-muted-foreground">{t('settings.backendConnection.machine')}</dt><dd className="mt-1 break-words font-semibold">{plan.machine.label}</dd><dd className="mt-1 break-all text-sm text-muted-foreground">{plan.machine.sshTarget}</dd></div><div><dt className="text-sm text-muted-foreground">OpenAlice</dt><dd className="mt-1 font-mono">{plan.installedVersion || '—'} → {plan.targetVersion}</dd></div></dl>
    <div className="rounded-xl border border-border/70 p-5"><h2 className="font-semibold">{t('settings.machines.plannedActions')}</h2><ul className="mt-4 space-y-3 text-sm">{(plan.actions.length ? plan.actions : [t('startup.saveMachine')]).map((action, i) => <li key={i} className="flex gap-3"><span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs">{i + 1}</span><span className="pt-0.5">{action}</span></li>)}</ul></div>
    {plan.blocker && <p role="alert" className="rounded-lg bg-destructive/10 p-4 text-sm text-destructive">{plan.blocker}</p>}
    {applying && <div role="status" className="flex items-center gap-3 rounded-lg bg-primary/5 p-4 text-sm"><LoaderCircle className="size-5 animate-spin motion-reduce:animate-none" aria-hidden />{t(`startup.stage.${operation?.stage ?? 'checking'}`)}</div>}
    <p className="text-sm text-muted-foreground">{t('startup.prepareNote')}</p>
    <div className="flex justify-end"><Button disabled={applying || Boolean(plan.blocker)} onClick={onApply}>{applying ? t('settings.machines.applying') : plan.actions.length ? t('startup.approvePrepare') : t('startup.saveMachine')}</Button></div>
  </div>
}

export function StartupProjectForm({ machine, name, home, busy, onName, onHome, onSubmit }: { machine: string; name: string; home: string; busy: boolean; onName: (next: string) => void; onHome: (next: string) => void; onSubmit: () => void }) {
  const { t } = useTranslation()
  const valid = /^[a-z][a-z0-9_-]{0,31}$/.test(name) && name !== 'default' && Boolean(home.trim())
  return <form className="mx-auto w-full max-w-xl space-y-5" onSubmit={event => { event.preventDefault(); if (!busy && valid) onSubmit() }}>
    <p className="text-sm text-muted-foreground">{machine}</p>
    <label className="block text-sm font-medium">{t('startup.projectKey')}<input className={`${inputClass} mt-2 w-full`} value={name} onChange={event => onName(event.target.value)} placeholder="research-lab" disabled={busy} autoComplete="off" /><span className="mt-2 block text-xs text-muted-foreground">{t('startup.projectKeyHelp')}</span></label>
    <label className="block text-sm font-medium">{t('startup.dataFolder')}<input className={`${inputClass} mt-2 w-full`} value={home} onChange={event => onHome(event.target.value)} placeholder="/srv/alice/research-lab" disabled={busy} autoComplete="off" /><span className="mt-2 block text-xs text-muted-foreground">{t('startup.emptyFolder')}</span></label>
    <p className="rounded-lg border border-border/70 p-4 text-sm text-muted-foreground">{t('startup.workspaceAsync')}</p>
    <div className="flex justify-end"><Button type="submit" disabled={busy || !valid}>{busy && <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" aria-hidden />}{t('startup.createOpen')}</Button></div>
  </form>
}
