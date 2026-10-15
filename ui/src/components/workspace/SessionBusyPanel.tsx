import { useEffect, useRef, useState, type RefObject } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowUpRight, CalendarDays, Clock3, RefreshCw } from 'lucide-react'
import { useSessionControl } from '../../hooks/useSessionControl'
import { useWorkspaceSessionDirectory } from '../../hooks/useWorkspaceSessionDirectory'
import { AgentRuntimeIcon } from '../../lib/agentRuntimeIcon'
import { useWorkspace } from '../../tabs/store'
import { Button } from '../ui/button'
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '../ui/dialog'
import type { SessionRecord } from './api'
import { sessionCoworkerLabel } from './display'
import { isHeadlessOccupying } from './harness-sessions'
import { SessionControlPanel } from './SessionControlPanel'
import { useSessionBusyDialog } from './session-busy-store'

function elapsedClock(startedAt: number, now: number): string {
  const seconds = Math.max(0, Math.floor((now - startedAt) / 1000))
  const minutes = Math.floor(seconds / 60)
  return minutes < 60
    ? `${minutes}:${String(seconds % 60).padStart(2, '0')}`
    : `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
}

function SessionBusyPanel({ record, workspaceId, onClose, onOpen, titleRef }: {
  titleRef: RefObject<HTMLHeadingElement | null>
  record: SessionRecord
  workspaceId: string
  onClose(): void
  onOpen(): void
}) {
  const { t, i18n } = useTranslation()
  const control = useSessionControl(workspaceId, record.id)
  const blocked = Boolean(control.data?.blocks.length)
  const { directory, loading, error, refresh } = useWorkspaceSessionDirectory(workspaceId)
  const openOrFocus = useWorkspace(s => s.openOrFocus)
  const [refreshing, setRefreshing] = useState(false)
  const [now, setNow] = useState(Date.now)
  const entry = directory?.sessions.find(row => row.resumeId === record.resumeId)
  const run = entry?.latestExecution
  const ended = Boolean(entry && !entry.active && !error && !loading && !isHeadlessOccupying(record, entry))
  const outcome = !ended ? 'running' : run?.status === 'interrupted' ? 'interrupted' : run?.status === 'failed' ? 'failed' : 'ended'
  const unknown = t('workspace.sessionBusy.unknown')

  useEffect(() => {
    if (!run?.startedAt || ended) return
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [run?.startedAt, ended])

  async function check() {
    setRefreshing(true)
    try { await refresh() } finally { setRefreshing(false) }
  }

  return <>
    <header className="flex min-w-0 items-center gap-3 border-b border-border py-4 pl-5 pr-16 sm:pl-7 sm:pr-16">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-foreground">
        <AgentRuntimeIcon agentId={record.agent} className="size-5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-base font-semibold leading-tight">{sessionCoworkerLabel(record)}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">{record.agent}</p>
      </div>
      <span className="inline-flex shrink-0 items-center gap-2 rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
        {!ended && <span className="relative size-2 rounded-full bg-primary live-pulse motion-reduce:animate-none" aria-hidden />}
        <span className="sm:hidden">{t(outcome === 'ended' ? 'workspace.sessionBusy.finishedShort' : outcome === 'running' ? 'workspace.sessionDetails.running' : `workspace.sessionBusy.${outcome}Short`)}</span>
        <span className="hidden sm:inline">{t(outcome === 'ended' ? 'workspace.sessionBusy.finishedShort' : `workspace.sessionBusy.${outcome}`)}</span>
      </span>
    </header>

    <div className="min-h-0 overflow-y-auto px-5 py-6 sm:px-7 sm:py-7">
      <div className="mx-auto max-w-xl text-center">
        <DialogTitle ref={titleRef} tabIndex={-1} className="outline-none text-xl font-semibold leading-tight sm:text-2xl">
          {outcome === 'running' ? t('workspace.sessionBusy.workingOn', { session: sessionCoworkerLabel(record) }) : t(`workspace.sessionBusy.${outcome}`)}
        </DialogTitle>
        {!ended && <div className="oa-session-running-line mx-auto my-5 h-0.5 max-w-sm overflow-hidden rounded-full bg-border" aria-hidden />}
        <p className="mt-3 flex flex-wrap items-baseline justify-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
          <span>{run?.issueId ? `Issue ${run.issueId}` : unknown}</span>
          <span aria-hidden>·</span>
          <span className="tabular-nums">{run?.startedAt ? elapsedClock(run.startedAt, run.finishedAt ?? now) : unknown}</span>
          <span>{t(ended ? 'workspace.sessionBusy.total' : 'workspace.sessionBusy.elapsed')}</span>
        </p>
        <DialogDescription className="mx-auto mt-3 max-w-lg leading-relaxed">
          {t(blocked ? 'sessionControl.blockedDescription' : outcome === 'ended' ? 'workspace.sessionBusy.endedDescription' : outcome === 'running' ? 'workspace.sessionBusy.description' : `workspace.sessionBusy.${outcome}Description`)}
        </DialogDescription>
      </div>

      <dl className="mt-7 grid gap-x-5 gap-y-4 border-t border-border pt-5 text-sm sm:grid-cols-3">
        <div className="min-w-0"><dt className="text-xs text-muted-foreground">{t('workspace.sessionBusy.runtime')}</dt><dd className="mt-1 truncate font-medium">{record.agent}</dd></div>
        <div className="min-w-0"><dt className="flex items-center gap-1.5 text-xs text-muted-foreground"><CalendarDays size={13} aria-hidden />{t('workspace.sessionBusy.started')}</dt><dd className="mt-1 tabular-nums">{run?.startedAt ? new Date(run.startedAt).toLocaleString(i18n.language) : unknown}</dd></div>
        <div className="min-w-0"><dt className="flex items-center gap-1.5 text-xs text-muted-foreground"><Clock3 size={13} aria-hidden />{t('workspace.sessionBusy.source')}</dt><dd className="mt-1 truncate">{run?.issueId ? `Issue ${run.issueId}` : unknown}</dd></div>
      </dl>
      {loading && <p role="status" className="mt-4 text-xs text-muted-foreground">{t('workspace.sessionBusy.loading')}</p>}
      {error && <p role="alert" className="mt-4 text-xs text-destructive">{t('workspace.sessionBusy.unavailable')}</p>}
      <details className="mt-5 text-xs text-muted-foreground">
        <summary className="cursor-pointer py-1">{t('workspace.sessionBusy.details')}</summary>
        <p className="break-all py-1">{t('workspace.sessionBusy.identity')}: {record.resumeId}</p>
        <p className="break-all py-1">{t('workspace.sessionBusy.task')}: {run?.taskId ?? unknown}</p>
      </details>
    </div>

    <footer className="max-h-[45dvh] shrink-0 overflow-y-auto">
      <div className="flex flex-wrap items-center gap-2 border-t border-border px-5 py-3 sm:px-7">
        {ended && !blocked && <Button onClick={onOpen}>{t('workspace.sessionBusy.open')}</Button>}
        {run?.issueId && <Button variant="ghost" size="sm" onClick={() => { onClose(); openOrFocus({ kind: 'issue-detail', params: { wsId: workspaceId, id: run.issueId! } }) }}>
          {t('workspace.sessionBusy.issue')}<ArrowUpRight size={15} aria-hidden />
        </Button>}
        <Button variant="ghost" size="sm" disabled={refreshing || loading} onClick={() => void check()}>
          <RefreshCw size={15} aria-hidden className={refreshing ? 'animate-spin motion-reduce:animate-none' : ''} />{t('workspace.sessionBusy.refresh')}
        </Button>
      </div>
      <SessionControlPanel control={control} compact sessionName={sessionCoworkerLabel(record)} />
    </footer>
  </>
}

export function SessionBusyDialogHost() {
  const titleRef = useRef<HTMLHeadingElement>(null)
  const { target, close } = useSessionBusyDialog()
  const openOrFocus = useWorkspace(s => s.openOrFocus)
  const { t } = useTranslation()
  return <Dialog open={target !== null} onOpenChange={open => { if (!open) close() }}>
    <DialogContent initialFocus={titleRef} className="flex max-h-[90dvh] min-h-0 flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl" closeButtonClassName="top-4 right-4" closeLabel={t('common.close')}>
      {target && <SessionBusyPanel key={`${target.workspaceId}:${target.record.resumeId}`}
        titleRef={titleRef} record={target.record} workspaceId={target.workspaceId} onClose={close}
        onOpen={() => {
          close()
          openOrFocus({ kind: 'workspace', params: { wsId: target.workspaceId, sessionId: target.record.id, source: target.source } })
        }} />}
    </DialogContent>
  </Dialog>
}
