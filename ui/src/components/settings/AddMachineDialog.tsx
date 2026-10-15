import { useEffect, useId, useRef, useState, type RefObject } from 'react'
import { AlertCircle, LoaderCircle, Server } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { UpdateLifecycle } from '../../hooks/useUpdateLifecycle'
import type { MachinePlan } from '../../lib/updates/machine-types'
import { inputClass } from '../form'
import { Button } from '../ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../ui/dialog'

type Controls = UpdateLifecycle['machines']
type Phase = 'form' | 'review' | 'applying' | 'failed'

/** One temporary decision. The provider owns probes and mutations across navigation. */
export function AddMachineDialog({ manager, onClose, onAdded, restoreFocusRef }: {
  manager: Controls
  onClose: () => void
  onAdded: () => void
  restoreFocusRef: RefObject<HTMLButtonElement | null>
}) {
  const { t } = useTranslation()
  const id = useId()
  const targetRef = useRef<HTMLInputElement>(null)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const [sshTarget, setSshTarget] = useState('')
  const [label, setLabel] = useState('')
  const [sshPort, setSshPort] = useState('')
  const [identityFile, setIdentityFile] = useState('')
  const restored = manager.operation?.mode === 'add' && manager.operation.phase === 'running' ? manager.operation : null
  // A surviving apply() flight already refreshes the fleet. A replacement
  // renderer only polls the operation and must refresh after registration.
  const refreshRestoredCompletion = useRef(Boolean(restored && !manager.applying))
  const completedOperation = useRef<string | null>(null)
  const [approvedId, setApprovedId] = useState<string | null>(restored?.planId ?? null)
  const [phase, setPhase] = useState<Phase>(restored ? 'applying' : 'form')
  const [reviewed, setReviewed] = useState<MachinePlan | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [submitted, setSubmitted] = useState(false)
  const live = useRef(true)
  const applying = useRef(Boolean(restored))
  const request = useRef(0)
  const operation = manager.operation?.mode === 'add' && manager.operation.planId === approvedId ? manager.operation : null
  const working = manager.applying || Boolean(restored)
  const displayPhase = working ? 'applying' : phase
  applying.current = working
  const currentPlan = manager.plan?.mode === 'add' && manager.plan.id === reviewed?.id ? manager.plan : null
  const invalidPort = Boolean(sshPort.trim() && (!/^\d+$/.test(sshPort.trim()) || Number(sshPort) < 1 || Number(sshPort) > 65535))
  const clearPlan = manager.clearPlan

  useEffect(() => {
    live.current = true
    return () => {
      live.current = false
      request.current++
      if (!applying.current) clearPlan()
    }
  }, [clearPlan])
  useEffect(() => {
    // Operation discovery may finish after the user has opened the form.
    // Adopt only a currently running add, never an old result or an upgrade.
    if (!restored || restored.planId === approvedId) return
    request.current++
    refreshRestoredCompletion.current = !manager.applying
    completedOperation.current = null
    if (!manager.applying) clearPlan()
    setApprovedId(restored.planId)
    setReviewed(null)
    setError(null)
    setPhase('applying')
  }, [restored?.id, restored?.planId, approvedId, manager.applying, clearPlan])
  useEffect(() => {
    if ((phase !== 'applying' && phase !== 'failed') || manager.applying) return
    if (operation?.phase === 'failed') {
      setError(operation.error)
      setPhase('failed')
    } else if (operation?.phase === 'succeeded' && completedOperation.current !== operation.id) {
      completedOperation.current = operation.id
      if (refreshRestoredCompletion.current) {
        refreshRestoredCompletion.current = false
        void manager.refresh().then(() => {
          if (live.current && completedOperation.current === operation.id) onAdded()
        })
      } else onAdded()
    }
  }, [phase, manager.applying, manager.refresh, operation?.id, operation?.phase, operation?.error, onAdded])
  useEffect(() => { if (phase !== 'form') headingRef.current?.focus() }, [phase])

  const close = () => {
    if (working || applying.current) return
    request.current++
    clearPlan()
    onClose()
  }
  const edit = (setter: (value: string) => void, value: string) => {
    setter(value)
    setError(null)
    clearPlan()
  }
  const probe = async () => {
    if (manager.probing || working) return
    setSubmitted(true)
    if (!sshTarget.trim() || !label.trim() || invalidPort) return
    const generation = ++request.current
    setError(null)
    clearPlan()
    try {
      const plan = await manager.probe({ mode: 'add', sshTarget: sshTarget.trim(), label: label.trim(),
        ...(sshPort.trim() ? { sshPort: Number(sshPort) } : {}),
        ...(identityFile.trim() ? { identityFile: identityFile.trim() } : {}),
      })
      if (!live.current || request.current !== generation) return
      setReviewed(plan)
      setApprovedId(null)
      setPhase('review')
    } catch (cause) {
      if (live.current && request.current === generation) setError(cause instanceof Error ? cause.message : String(cause))
    }
  }
  const approve = async () => {
    if (!currentPlan || currentPlan.blocker || applying.current) return
    applying.current = true
    refreshRestoredCompletion.current = false
    completedOperation.current = null
    setApprovedId(currentPlan.id)
    setPhase('applying')
    setError(null)
    try {
      await manager.apply()
      if (live.current) onAdded()
    } catch (cause) {
      if (live.current) {
        setError(cause instanceof Error ? cause.message : String(cause))
        setPhase('failed')
      }
    } finally { applying.current = false }
  }
  const back = () => {
    clearPlan()
    setReviewed(null)
    setApprovedId(null)
    setError(null)
    setPhase('form')
    requestAnimationFrame(() => targetRef.current?.focus())
  }
  const title = displayPhase === 'applying' ? t('settings.machines.adding') : displayPhase === 'failed' ? t('settings.machines.addFailed')
    : displayPhase === 'review' ? t('settings.machines.review') : t('settings.machines.addTitle')

  return <Dialog open onOpenChange={(open) => { if (!open) close() }}>
    <DialogContent initialFocus={restored ? headingRef : targetRef} finalFocus={restoreFocusRef}
      showCloseButton={!working} closeLabel={t('common.close')}
      className="flex max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] flex-col gap-0 overflow-hidden p-0" style={{ maxWidth: 640 }}>
      <div className="shrink-0 border-b border-border/70 px-5 py-5 pr-12 sm:px-6">
        <DialogTitle ref={headingRef} tabIndex={-1} className="text-lg font-semibold outline-none">{title}</DialogTitle>
        <DialogDescription className="mt-2 text-xs leading-5">{displayPhase === 'form' ? t('settings.machines.probeOnly')
          : displayPhase === 'review' ? t('settings.machines.reviewDescription')
            : displayPhase === 'failed' ? t('settings.machines.partialFailure') : t('settings.machines.keepOpen')}</DialogDescription>
      </div>
      <div className="min-h-0 overflow-y-auto px-5 py-5 sm:px-6">
        {error && <p role="alert" className="mb-4 flex gap-2 break-words rounded-lg bg-destructive/10 p-3 text-xs text-destructive"><AlertCircle className="size-4 shrink-0" aria-hidden />{error}</p>}
        {displayPhase === 'form' && <form id={`${id}-form`} onSubmit={(event) => { event.preventDefault(); void probe() }} noValidate>
          <fieldset disabled={manager.probing} className="grid min-w-0 gap-4 sm:grid-cols-2">
            <div className="min-w-0"><label htmlFor={`${id}-target`} className="text-xs">{t('settings.machines.sshTarget')}</label>
              <input id={`${id}-target`} ref={targetRef} className={`${inputClass} mt-1.5`} value={sshTarget} onChange={event => edit(setSshTarget, event.target.value)} placeholder="alice@server.example.com" autoComplete="off" required aria-invalid={submitted && !sshTarget.trim()} aria-describedby={submitted && !sshTarget.trim() ? `${id}-target-error` : undefined} />
              {submitted && !sshTarget.trim() && <p id={`${id}-target-error`} className="mt-1 text-xs text-destructive">{t('settings.machines.targetRequired')}</p>}
            </div>
            <div className="min-w-0"><label htmlFor={`${id}-label`} className="text-xs">{t('settings.machines.label')}</label>
              <input id={`${id}-label`} className={`${inputClass} mt-1.5`} value={label} onChange={event => edit(setLabel, event.target.value)} placeholder="Cloud Linux" autoComplete="off" required aria-invalid={submitted && !label.trim()} aria-describedby={submitted && !label.trim() ? `${id}-label-error` : undefined} />
              {submitted && !label.trim() && <p id={`${id}-label-error`} className="mt-1 text-xs text-destructive">{t('settings.machines.labelRequired')}</p>}
            </div>
            <div className="min-w-0"><label htmlFor={`${id}-port`} className="text-xs">{t('settings.machines.sshPort')} <span className="text-muted-foreground">({t('settings.machines.optional')})</span></label>
              <input id={`${id}-port`} className={`${inputClass} mt-1.5`} inputMode="numeric" value={sshPort} onChange={event => edit(setSshPort, event.target.value)} placeholder="22" aria-invalid={invalidPort} aria-describedby={`${id}-port-help`} />
              <p id={`${id}-port-help`} className={`mt-1.5 text-xs ${invalidPort ? 'text-destructive' : 'text-muted-foreground'}`}>{t(invalidPort ? 'settings.machines.invalidPort' : 'settings.machines.portHelp')}</p>
            </div>
            <div className="min-w-0"><label htmlFor={`${id}-identity`} className="text-xs">{t('settings.machines.identityFile')} <span className="text-muted-foreground">({t('settings.machines.optional')})</span></label>
              <input id={`${id}-identity`} className={`${inputClass} mt-1.5`} value={identityFile} onChange={event => edit(setIdentityFile, event.target.value)} placeholder="~/.ssh/id_ed25519" autoComplete="off" />
            </div>
          </fieldset>
          <p role="status" className="mt-5 flex items-center gap-2 text-xs text-muted-foreground">{manager.probing && <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" aria-hidden />}{t(manager.probing ? 'settings.machines.probing' : 'settings.machines.sshNote')}</p>
        </form>}
        {displayPhase !== 'form' && reviewed && <div className="min-w-0 rounded-lg border border-border bg-secondary/25 p-4">
          <div className="flex min-w-0 gap-3"><Server className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden /><div className="min-w-0"><p className="break-words text-sm font-medium">{reviewed.machine.label}</p><p className="mt-1 break-all text-xs text-muted-foreground">{reviewed.machine.sshTarget}</p></div></div>
          <dl className="mt-4 grid gap-3 text-xs sm:grid-cols-2">
            <div><dt className="text-muted-foreground">{t('settings.machines.platform')}</dt><dd className="mt-1 break-words">{reviewed.platform}</dd></div>
            <div><dt className="text-muted-foreground">{t('settings.machines.runtime')}</dt><dd className="mt-1 break-words">{reviewed.runtime}</dd></div>
            <div><dt className="text-muted-foreground">{t('settings.machines.runningTarget')}</dt><dd className="mt-1 break-words">{reviewed.activeVersion ?? t('settings.machines.unreported')} → {reviewed.targetVersion}</dd></div>
            <div><dt className="text-muted-foreground">{t('settings.machines.installed')}</dt><dd className="mt-1 break-words">{reviewed.installedVersion}</dd></div>
          </dl>
          {reviewed.project && <p className="mt-3 break-words text-xs">AliceProject · {reviewed.project.displayName}</p>}
        </div>}
        {displayPhase === 'review' && reviewed && <div className="mt-5 text-xs leading-5">
          <p className="font-medium">{t('settings.machines.plannedActions')}</p>
          {reviewed.actions.length ? <ul className="mt-2 list-disc space-y-1 break-words pl-4 text-muted-foreground">{reviewed.actions.map((action, index) => <li key={index}>{action}</li>)}</ul> : <p className="mt-2 rounded-lg border border-border p-3 text-muted-foreground">{t('settings.machines.noChanges')}</p>}
          {reviewed.blocker ? <p role="alert" className="mt-3 break-words rounded-lg border border-warning-border bg-warning-background p-3 text-warning">{reviewed.blocker}</p>
            : reviewed.deferredUpdate ? <p className="mt-3 text-muted-foreground">{t('settings.machines.deferred')}</p>
              : reviewed.actions.some(action => /restart|stop|take over|replace/i.test(action)) ? <p className="mt-3 text-muted-foreground">{t('settings.machines.restartNotice')}</p> : null}
          {!reviewed.blocker && <p className="mt-4 text-muted-foreground">{t('settings.machines.saveProfile')}</p>}
          <p className="mt-4 border-t border-border pt-4 text-muted-foreground">{t('settings.machines.noSwitch')}</p>
        </div>}
        {displayPhase === 'applying' && <div role="status" className="flex flex-col items-center gap-3 py-6 text-center text-sm"><LoaderCircle className="size-7 animate-spin text-primary motion-reduce:animate-none" aria-hidden />{t('settings.machines.applying')}{operation && <p className="text-xs text-muted-foreground">{t(`startup.stage.${operation.stage}`)}</p>}{manager.operationError && <p className="text-xs text-destructive">{manager.operationError}</p>}</div>}
      </div>
      <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-border/70 bg-secondary/20 px-5 py-4 sm:px-6">
        {displayPhase === 'form' && <><Button variant="outline" onClick={close}>{t('common.cancel')}</Button><Button type="submit" form={`${id}-form`} disabled={manager.probing || invalidPort}>{t(error ? 'settings.machines.retryProbe' : 'settings.machines.probe')}</Button></>}
        {displayPhase === 'review' && <><Button variant="outline" className="mr-auto" onClick={back}>{t('common.back')}</Button>{reviewed?.blocker ? <Button variant="outline" onClick={close}>{t('common.close')}</Button> : <Button disabled={!currentPlan || manager.probing || manager.applying} onClick={() => void approve()} className="h-auto min-h-9 max-w-[70%] whitespace-normal">{t('settings.machines.approveAdd')}</Button>}</>}
        {displayPhase === 'failed' && <><Button variant="outline" onClick={close}>{t('common.close')}</Button><Button disabled={manager.probing} onClick={() => { if (sshTarget && label) void probe(); else back() }}>{t('settings.machines.reviewAgain')}</Button></>}
        {displayPhase === 'applying' && <p className="text-xs text-muted-foreground">{t('settings.machines.keepOpen')}</p>}
      </div>
    </DialogContent>
  </Dialog>
}
