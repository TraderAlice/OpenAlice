import { useEffect, useId, useState } from 'react'
import { ArrowRightLeft, Clock3, ExternalLink, LoaderCircle } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { awaitingTakeover, useSessionTakeovers, type TakeoverRequest } from '../../hooks/useSessionTakeovers'
import { useWorkspace } from '../../tabs/store'
import { Button } from '../ui/button'
import { inputClass } from '../form'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../ui/dialog'

export function SessionTakeoverBubble() {
  const data = useSessionTakeovers()
  const { t } = useTranslation()
  const rows = data?.requests.filter(awaitingTakeover) ?? []
  if (!rows.length) return null
  return <Button data-takeover-control variant="ghost" size="sm" className="gap-1.5 rounded-full bg-primary/10 text-primary" onClick={() => data?.select(rows[0].id)} aria-label={t('takeover.pending', { count: rows.length })} title={t('takeover.pending', { count: rows.length })}>
    <ArrowRightLeft size={14} aria-hidden /><span className="tabular-nums text-xs">{rows.length}</span>
  </Button>
}

function Countdown({ row, offset }: { row: TakeoverRequest; offset: number }) {
  const { t } = useTranslation()
  const [now, setNow] = useState(Date.now())
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 250); return () => clearInterval(timer) }, [])
  const seconds = Math.max(0, Math.ceil((row.deadline - now - offset) / 1000))
  const waiting = row.blocker === 'queued' ? 'queued' : row.blocker === 'terminal' ? 'terminal' : row.state === 'waiting-idle' ? 'working' : null
  return <div className="space-y-3 rounded-xl bg-muted/60 p-4">
    <div className="flex items-center gap-2 text-sm font-medium"><Clock3 size={16} className="text-muted-foreground" aria-hidden />{waiting ? t(`takeover.${waiting}`) : t('takeover.countdown', { seconds })}</div>
    {!waiting && <div className="h-1 overflow-hidden rounded-full bg-border" aria-hidden><div className="h-full rounded-full bg-primary/60 transition-[width] duration-300 motion-reduce:transition-none" style={{ width: `${Math.min(100, seconds / row.idleSeconds * 100)}%` }} /></div>}
    <p className="text-xs leading-relaxed text-muted-foreground">{t(waiting === 'terminal' ? 'takeover.terminalHelp' : 'takeover.idleHelp')}</p>
  </div>
}

export function SessionTakeoverSettings() {
  const data = useSessionTakeovers()
  const { t } = useTranslation()
  const [value, setValue] = useState(String(data?.idleSeconds ?? 60))
  const [saved, setSaved] = useState(false)
  const fieldId = useId()
  useEffect(() => { setValue(String(data?.idleSeconds ?? 60)) }, [data?.idleSeconds])
  if (!data) return null
  const valid = /^\d+$/.test(value) && Number(value) >= 10 && Number(value) <= 3600
  return <div className="space-y-2">
    <label className="text-sm font-medium" htmlFor={fieldId}>{t('takeover.setting')}</label>
    <div className="flex items-center gap-2"><input id={fieldId} className={`${inputClass} w-24`} type="number" min={10} max={3600} value={value} onChange={e => { setValue(e.target.value); setSaved(false) }} /><span className="text-sm text-muted-foreground">{t('takeover.seconds')}</span><Button variant="outline" size="sm" disabled={!valid || data.busy} onClick={() => void data.configure(Number(value)).then(() => setSaved(true)).catch(() => {})}>{saved ? t('takeover.saved') : t('common.save')}</Button></div>
    <p className="text-xs leading-relaxed text-muted-foreground">{t('takeover.settingHelp')}</p>
    {data.error && <p role="alert" className="text-xs text-destructive">{data.error}</p>}
  </div>
}

export function SessionTakeoverDialogHost() {
  const data = useSessionTakeovers()
  const { t, i18n } = useTranslation()
  const openOrFocus = useWorkspace(s => s.openOrFocus)
  const row = data?.requests.find(item => item.id === data.selected)
  if (!data || !row) return null
  const pending = awaitingTakeover(row)
  const source = row.origin.issueId ? `Issue · ${row.origin.issueId}` : row.origin.entry
  return <Dialog open onOpenChange={open => { if (!open) data.select(null) }}>
    <DialogContent data-takeover-control className="max-h-[85dvh] overflow-y-auto sm:max-w-md" closeLabel={t('common.close')}>
      <DialogHeader><div className="mb-1 flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary"><ArrowRightLeft size={20} aria-hidden /></div><DialogTitle>{t(pending ? 'takeover.title' : row.state === 'running' || row.state === 'handoff' ? 'takeover.handedOff' : 'takeover.finished')}</DialogTitle><DialogDescription>{pending ? t('takeover.description', { session: row.sessionTitle }) : row.sessionTitle}</DialogDescription></DialogHeader>
      <div className="space-y-3 border-y border-border py-4 text-sm"><div className="flex items-start justify-between gap-4"><span className="shrink-0 text-muted-foreground">{t('takeover.requestedBy')}</span><span className="min-w-0 break-words text-right font-medium">{source}</span></div><div className="flex justify-between gap-4 text-xs text-muted-foreground"><span>{t('takeover.purpose')}</span><span className="break-words text-right">{row.origin.entry}</span></div><div className="flex justify-between gap-4 text-xs text-muted-foreground"><span>{t('takeover.requestedAt')}</span><time>{new Date(row.requestedAt).toLocaleTimeString(i18n.language)}</time></div>
      {row.origin.issueId && <Button variant="link" className="h-auto p-0 text-xs" onClick={() => { data.select(null); openOrFocus({ kind: 'issue-detail', params: { wsId: row.origin.workspaceId ?? row.workspaceId, id: row.origin.issueId! } }) }}>{t('takeover.viewIssue')}<ExternalLink size={12} /></Button>}</div>
      {pending ? <Countdown row={row} offset={data.offset} /> : <p role="status" className="text-sm text-muted-foreground">{t(row.state === 'running' || row.state === 'handoff' ? 'takeover.runningHelp' : 'takeover.doneHelp')}</p>}
      {data.error && <p role="alert" className="text-sm text-destructive">{data.error}</p>}
      {pending && <div className="flex flex-wrap justify-end gap-2"><Button variant="outline" disabled={data.busy} onClick={() => void data.decide(row.id, 'reject')}>{t('takeover.keepUsing')}</Button><Button disabled={data.busy || row.decision === 'approved'} onClick={() => void data.decide(row.id, 'approve')}>{data.busy && <LoaderCircle size={14} className="animate-spin motion-reduce:animate-none" />}{t(row.decision === 'approved' ? 'takeover.approved' : 'takeover.approve')}</Button></div>}
      <details className="border-t border-border pt-3"><summary className="cursor-pointer text-xs text-muted-foreground">{t('takeover.timing')}</summary><div className="pt-3"><SessionTakeoverSettings /></div></details>
    </DialogContent>
  </Dialog>
}
