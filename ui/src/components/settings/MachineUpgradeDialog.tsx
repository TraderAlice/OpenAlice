import { useState } from 'react'
import { AlertCircle, Check, LoaderCircle, Server } from 'lucide-react'

import type { MachineOperation, MachinePlan } from '../../lib/updates/machine-types'
import { Button } from '../ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../ui/dialog'
import { useHideBackendOutageOverlay } from '../../auth/BackendOutageOverlayContext'

const stages = [
  { key: 'checking', label: 'Check' },
  { key: 'installing', label: 'Install CLI' },
  { key: 'restarting', label: 'Restart' },
  { key: 'verifying', label: 'Verify' },
] as const

function stageIndex(stage: MachineOperation['stage']): number {
  if (stage === 'installing' || stage === 'verifying-install' || stage === 'preparing-source') return 1
  if (stage === 'restarting') return 2
  if (stage === 'verifying') return 3
  return 0
}

export function MachineUpgradeDialog({ open, plan, operation, busy, checking = false, error, onClose, onApply, onRetry }: {
  open: boolean
  plan: MachinePlan | null
  operation: MachineOperation | null
  busy: boolean
  checking?: boolean
  error: string | null
  onClose: () => void
  onApply: () => void
  onRetry: () => void
}) {
  const [approvedPlanId, setApprovedPlanId] = useState<string | null>(null)
  const current = operation?.mode === 'upgrade' && (operation.phase === 'running' || (operation.planId === approvedPlanId && (!plan || plan.id === approvedPlanId))) ? operation : null
  const working = busy || current?.phase === 'running'
  useHideBackendOutageOverlay(open && working)
  const progress = current?.phase === 'running' || current?.phase === 'failed' || current?.phase === 'succeeded' || (approvedPlanId !== null && (busy || (Boolean(error) && (!plan || plan.id === approvedPlanId))))
  const step = current ? stageIndex(current.stage) : 0
  const failure = current?.phase === 'failed' ? current.error : error
  const title = plan?.project?.displayName ?? plan?.machine.label ?? 'remote backend'

  return <Dialog open={open} onOpenChange={(next) => { if (!next && !working) onClose() }}>
    <DialogContent showCloseButton={!working} className="flex max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] flex-col gap-0 overflow-hidden p-0" style={{ maxWidth: 880 }}>
      <div className="border-b border-border px-5 py-5 pr-14 sm:px-7">
        <div className="mb-3 flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary"><Server className="size-5" aria-hidden /></div>
        <DialogTitle className="text-xl font-semibold">{progress ? current?.phase === 'succeeded' ? 'Backend updated' : failure ? 'Update needs attention' : 'Updating backend' : 'Review backend update'}</DialogTitle>
        <DialogDescription className="mt-2 leading-6">{current?.phase === 'succeeded' ? `${title} responded after the update.` : failure ? `The update for ${title} could not finish. Completed steps are kept. Review the result before approving another attempt.` : progress ? `Updating ${title}. Keep this window open while the remote backend is restarted and verified.` : `Check the target and actions before updating ${title}.`}</DialogDescription>
      </div>
      <div className="min-h-0 overflow-y-auto px-5 py-6 sm:px-7">
        {!plan && !progress && !error && <div className="flex items-center gap-3 py-8 text-muted-foreground" role="status"><LoaderCircle className="size-5 animate-spin motion-reduce:animate-none"/>Preparing the update plan…</div>}
        {plan && <div className="grid gap-3 rounded-xl border border-border bg-secondary/35 p-4 text-sm sm:grid-cols-2">
          <div className="min-w-0"><p className="text-xs text-muted-foreground">Machine · AliceProject</p><p className="mt-1 font-medium">{plan.machine.label}{plan.project ? ` · ${plan.project.displayName}` : ''}</p></div>
          <div><p className="text-xs text-muted-foreground">Running → Target</p><p className="mt-1 font-mono tabular-nums">{plan.activeVersion ?? 'Stopped / unreported'} → {plan.targetVersion}</p><p className="mt-1 text-xs text-muted-foreground">Installed: {plan.installedVersion}{plan.installedVersion === plan.targetVersion && plan.activeVersion !== plan.targetVersion ? ' · ready to activate' : ''}</p></div>
        </div>}
        {progress ? <div className="mt-6" role="status" aria-live="polite">
          <div className="grid grid-cols-4 gap-2" aria-label="Update stages">
            {stages.map((stage, index) => {
              const active = current?.phase === 'running' && index === step
              const done = current?.phase === 'succeeded' || (current && index < step)
              return <div key={stage.key} className="min-w-0">
                <div className={`mb-2 flex size-8 items-center justify-center rounded-full border text-xs font-semibold ${done ? 'border-success bg-success text-white' : active ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground'}`}>
                  {done ? <Check className="size-4" aria-hidden /> : active ? <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" aria-hidden /> : index + 1}
                </div>
                <p className={`text-xs leading-4 ${active ? 'font-semibold text-foreground' : 'text-muted-foreground'}`}>{stage.label}</p>
              </div>
            })}
          </div>
          {working && <div className="mt-5 h-1 overflow-hidden rounded-full bg-primary/10" role="progressbar" aria-label="Backend update in progress">
            <div className="h-full w-full animate-pulse rounded-full bg-primary/60 motion-reduce:animate-none" />
          </div>}
          {working && (current?.stage === 'restarting' || current?.stage === 'verifying') && <p className="mt-4 rounded-lg bg-primary/5 p-3 text-sm text-muted-foreground">A brief disconnect is expected. The local update controller is still running.</p>}
          <p className="mt-3 text-xs text-muted-foreground">{current?.phase === 'succeeded' ? 'The backend responded after the update.' : failure ? 'The operation stopped. Review the error before trying again.' : current?.stage === 'verifying-install' ? 'Checking the installed CLI before restarting…' : current?.stage === 'preparing-source' ? 'Preparing runtime source…' : current?.stage === 'restarting' ? 'Restarting the remote backend…' : current?.stage === 'verifying' ? 'Checking backend health…' : current?.stage === 'installing' ? 'Installing the CLI over SSH…' : 'Checking the Machine and reviewed plan…'}</p>
        </div> : plan && <div className="mt-5 text-sm">
          <p className="font-medium">Planned changes</p>
          <ul className="mt-2 space-y-1.5 text-muted-foreground">{plan.actions.map((action) => <li key={action} className="flex gap-2"><Check className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />{action}</li>)}</ul>
          <p className="mt-4 rounded-lg bg-primary/5 p-3 text-xs leading-5 text-muted-foreground">Running sessions may disconnect during restart. This location is unavailable for switching until the operation finishes.</p>
        </div>}
        {(plan?.blocker || failure) && <p role="alert" className="mt-4 flex gap-2 rounded-lg bg-destructive/10 p-3 text-sm text-destructive"><AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />{plan?.blocker ?? failure}</p>}
      </div>
      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border bg-secondary/20 px-5 py-4 sm:px-7">
        {working ? <span className="flex items-center gap-2 text-xs text-muted-foreground"><LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" aria-hidden />Update in progress · controls are paused</span> : <>
          <Button variant="outline" onClick={onClose}>{progress ? 'Close' : 'Cancel'}</Button>
          {failure && <Button disabled={checking} onClick={onRetry}>Review again</Button>}
          {!progress && plan && !plan.blocker && plan.actions.length > 0 && <Button disabled={checking || !!failure} onClick={() => { setApprovedPlanId(plan.id); onApply() }}>Approve update</Button>}
        </>}
      </div>
    </DialogContent>
  </Dialog>
}
