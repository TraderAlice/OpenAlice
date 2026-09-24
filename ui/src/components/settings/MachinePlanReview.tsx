import { AlertCircle, LoaderCircle } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import type { MachinePlan } from '../../hooks/useMachineManagement'
import { Button } from '../ui/button'

export function MachinePlanReview({ plan, busy, onApply }: { plan: MachinePlan; busy: boolean; onApply: () => void }) {
  const { t } = useTranslation()
  const upgrade = plan.mode === 'upgrade'
  return <div className="mt-4 min-w-0 rounded-lg border border-border bg-background/70 p-3 sm:p-4" aria-live="polite">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="text-[13px] font-semibold">{t('settings.machines.review', 'Review Machine plan')}</p>
        <p className="mt-1 break-all text-[12px] text-muted-foreground">{plan.machine.label} · {plan.machine.sshTarget} · {plan.platform}</p>
        {plan.project && <p className="mt-1 text-[12px] text-muted-foreground">AliceProject · {plan.project.displayName}</p>}
      </div>
      <span className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground">
        {plan.installedVersion} → {plan.targetVersion}
      </span>
    </div>
    <dl className="mt-3 grid gap-2 text-[12px] sm:grid-cols-2">
      <div><dt className="text-muted-foreground">{t('settings.machines.runtime', 'Runtime')}</dt><dd className="mt-0.5">{plan.runtime}</dd></div>
      <div><dt className="text-muted-foreground">{t('settings.machines.plannedActions', 'Planned actions')}</dt><dd className="mt-0.5">{plan.actions.length ? plan.actions.join(' · ') : t('settings.machines.noChanges', 'No remote changes')}</dd></div>
    </dl>
    {plan.blocker ? <p role="alert" className="mt-3 flex gap-2 rounded-md bg-destructive/10 p-2.5 text-[12px] text-destructive"><AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />{plan.blocker}</p>
      : plan.deferredUpdate ? <p className="mt-3 text-[12px] text-muted-foreground">{t('settings.machines.deferred', 'This Runtime can be reused, but its update cannot be activated safely.')}</p>
        : plan.actions.some((action) => /restart|stop|take over|replace/i.test(action)) ? <p className="mt-3 text-[12px] text-muted-foreground">{t('settings.machines.restartNotice', 'Running sessions may disconnect while the remote Runtime restarts.')}</p> : null}
    {!plan.blocker && (plan.mode === 'add' || plan.actions.length > 0) && <div className="mt-4 flex justify-end">
      <Button type="button" size="sm" disabled={busy} onClick={onApply} className="min-h-9">
        {busy && <LoaderCircle className="mr-2 size-4 animate-spin motion-reduce:animate-none" aria-hidden />}
        {busy ? t('settings.machines.applying', 'Applying and verifying…') : upgrade ? t('settings.machines.approveUpgrade', 'Approve update') : t('settings.machines.approveAdd', 'Approve and add Machine')}
      </Button>
    </div>}
  </div>
}
