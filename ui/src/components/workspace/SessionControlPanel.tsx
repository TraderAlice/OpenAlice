import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LoaderCircle, ShieldAlert, Square } from 'lucide-react'
import type { useSessionControl } from '../../hooks/useSessionControl'
import { Button } from '../ui/button'
import { inputClass } from '../form'

/** Shared by running-session and details dialogs; all state comes from one hook. */
export function SessionControlPanel({ control, compact = false, sessionName }: { control: ReturnType<typeof useSessionControl>; compact?: boolean; sessionName?: string }) {
  const { t, i18n } = useTranslation()
  const [seconds, setSeconds] = useState('600')
  const [pendingExecutionId, setPendingExecutionId] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  const cancelRef = useRef<HTMLButtonElement>(null)
  const interruptRef = useRef<HTMLButtonElement>(null)
  const hadPendingRef = useRef(false)
  useEffect(() => { if (control.data) setSeconds(String(control.data.cooldownSeconds)) }, [control.data?.cooldownSeconds])
  const data = control.data
  const run = data?.execution
  const stopping = run?.phase === 'stopping'
  useEffect(() => {
    if (pendingExecutionId && run?.executionId !== pendingExecutionId) setPendingExecutionId(null)
  }, [pendingExecutionId, run?.executionId])
  useEffect(() => {
    if (pendingExecutionId) cancelRef.current?.focus()
    else if (hadPendingRef.current) interruptRef.current?.focus()
    hadPendingRef.current = Boolean(pendingExecutionId)
  }, [pendingExecutionId])
  const cancelConfirmation = () => setPendingExecutionId(null)
  const confirmInterruption = async () => {
    if (!pendingExecutionId || confirming) return
    setConfirming(true)
    try { await control.interrupt(pendingExecutionId) }
    finally { setConfirming(false); setPendingExecutionId(null) }
  }
  const cooldownMinutes = Math.round((data?.cooldownSeconds ?? 600) / 60 * 10) / 10
  return <section className={compact ? `space-y-3 border-t border-border px-5 py-4 transition-colors duration-[var(--motion-fast)] motion-reduce:transition-none sm:px-7 ${pendingExecutionId ? 'bg-destructive/5' : 'bg-muted/35'}` : 'space-y-3 border-t border-border pt-4'} aria-label={t('sessionControl.title')}
    onKeyDownCapture={event => { if (event.key === 'Escape' && pendingExecutionId && !confirming) { event.stopPropagation(); cancelConfirmation() } }}>
    {pendingExecutionId && run?.executionId === pendingExecutionId ? <div role="group" aria-label={t('sessionControl.confirmTitle', { session: sessionName ?? t('workspace.sessionBusy.session') })} className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-5">
      <div className="min-w-0 space-y-1">
        <p className="text-sm font-semibold text-destructive">{t('sessionControl.confirmTitle', { session: sessionName ?? t('workspace.sessionBusy.session') })}</p>
        <p className="text-xs leading-relaxed text-muted-foreground">{t('sessionControl.confirmDescription', { minutes: cooldownMinutes })}</p>
      </div>
      <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
        <Button ref={cancelRef} variant="outline" size="sm" disabled={confirming} onClick={cancelConfirmation}>{t('common.cancel')}</Button>
        <Button variant="destructive" size="sm" disabled={confirming || control.busy} onClick={() => void confirmInterruption()}>
          {confirming ? <LoaderCircle size={14} className="animate-spin motion-reduce:animate-none" /> : <Square size={14} />}
          {t(confirming ? 'sessionControl.stopping' : 'sessionControl.confirmAction')}
        </Button>
      </div>
    </div> : <div className="flex flex-wrap items-center justify-between gap-3">
      <h3 className={compact ? 'sr-only' : 'text-sm font-semibold'}>{t('sessionControl.title')}</h3>
      {compact && run && <p className="max-w-md flex-1 text-xs leading-relaxed text-muted-foreground">{t('sessionControl.explanation', { minutes: cooldownMinutes })}</p>}
      {run && <Button ref={interruptRef} variant="destructive" size="sm" disabled={control.busy || (stopping && !run.stopError)}
        className={compact ? 'order-2 ml-auto' : undefined} onClick={() => {
          if (run.stopError) void control.interrupt(run.executionId)
          else setPendingExecutionId(run.executionId)
        }}>
        {stopping && !run.stopError ? <LoaderCircle size={14} className="animate-spin motion-reduce:animate-none" /> : <Square size={14} />}
        {t(stopping && !run.stopError ? 'sessionControl.stopping' : run.stopError ? 'sessionControl.retry' : 'sessionControl.interrupt')}
      </Button>}
    </div>}
    {!compact && run && !pendingExecutionId && <p className="text-xs leading-relaxed text-muted-foreground">{t('sessionControl.explanation', { minutes: cooldownMinutes })}</p>}
    {run?.stopError && <p role="alert" className="text-sm text-destructive">{t('sessionControl.unconfirmed')} {run.stopError}</p>}
    {control.error && <p role="alert" className="break-words text-sm text-destructive">{control.error}</p>}
    {!data && !control.error && <p role="status" className="text-sm text-muted-foreground">{t('common.loading')}</p>}
    {data?.blocks.map(block => <div key={block.id} className="space-y-2 border-l-2 border-border pl-3">
      <div className="flex items-center gap-2 text-sm font-medium"><ShieldAlert size={15} aria-hidden />{t(block.kind === 'user-cooldown' ? 'sessionControl.cooldown' : 'sessionControl.fault')}</div>
      <p className="text-xs leading-relaxed text-muted-foreground">{t(block.kind === 'user-cooldown' ? 'sessionControl.cooldownDescription' : 'sessionControl.faultDescription')}</p>
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <span className="tabular-nums text-muted-foreground">{block.expiresAt
          ? t('sessionControl.until', { time: new Date(block.expiresAt).toLocaleTimeString(i18n.language), seconds: Math.max(0, Math.ceil((block.expiresAt - data.serverNow) / 1000)) })
          : t('sessionControl.manual')}</span>
        <Button variant="outline" size="sm" disabled={control.busy || Boolean(pendingExecutionId)} onClick={() => void control.release(block.id)}>{t('sessionControl.release')}</Button>
      </div>
      <details className="text-xs text-muted-foreground"><summary className="cursor-pointer">{t('sessionControl.reason')}</summary><p className="mt-1 break-words">{block.reason}</p><p>{block.actor.entry} · {new Date(block.createdAt).toLocaleString(i18n.language)}</p></details>
    </div>)}
    {data && !run && data.blocks.length === 0 && <p className="text-sm text-muted-foreground">{t('sessionControl.ready')}</p>}
    {data && <details className="text-xs text-muted-foreground">
      <summary className="cursor-pointer">{t('sessionControl.settings')}</summary>
      <form className="mt-3 flex flex-wrap items-end gap-2" onSubmit={event => { event.preventDefault(); void control.configure(Number(seconds)) }}>
        <label className="space-y-1">{t('sessionControl.seconds')}<input className={`${inputClass} w-28`} type="number" min={10} max={86400} required disabled={Boolean(pendingExecutionId)} value={seconds} onChange={event => setSeconds(event.target.value)} /></label>
        <Button type="submit" size="sm" variant="outline" disabled={control.busy || Boolean(pendingExecutionId)}>{t('common.save')}</Button>
      </form>
      <p className="mt-2">{t('sessionControl.settingsHint')}</p>
    </details>}
  </section>
}
