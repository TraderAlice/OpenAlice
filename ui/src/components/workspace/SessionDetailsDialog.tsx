import { useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowUpRight, RefreshCw } from 'lucide-react'
import { useSessionControl } from '../../hooks/useSessionControl'
import { useSessionDetails } from '../../hooks/useSessionDetails'
import { AgentRuntimeIcon } from '../../lib/agentRuntimeIcon'
import { useWorkspace } from '../../tabs/store'
import { Button } from '../ui/button'
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '../ui/dialog'
import type { SessionRecord } from './api'
import { sessionCoworkerLabel } from './display'
import { SessionControlPanel } from './SessionControlPanel'
import { useSessionDetailsDialog } from './session-details-store'

export function SessionDetailsDialog({ record, onClose }: { record: SessionRecord; onClose(): void }) {
  const titleRef = useRef<HTMLHeadingElement>(null)
  const { t, i18n } = useTranslation()
  const control = useSessionControl(record.wsId, record.id)
  const data = useSessionDetails(record.wsId, record.id, record.resumeId)
  const openOrFocus = useWorkspace(state => state.openOrFocus)
  const text = (key: 'title' | 'unknown' | 'state' | 'workspace' | 'runtime' | 'configuration' | 'surface' | 'created' | 'started' | 'ended' | 'active' | 'provider' | 'credential' | 'model' | 'effort' | 'createdBy' | 'running' | 'issues' | 'none' | 'history' | 'noHistory' | 'partial' | 'source' | 'reason' | 'identifiers') => t(`workspace.sessionDetails.${key}`)
  const unknown = text('unknown')
  const date = (value?: string | number | null) => {
    if (value === undefined || value === null || value === '') return unknown
    const parsed = new Date(value)
    return Number.isNaN(parsed.getTime()) ? unknown : parsed.toLocaleString(i18n.language)
  }
  const last = data.executions[0]
  const fallback = data.entry?.latestExecution
  const live = last ? ['starting', 'running', 'stopping'].includes(last.phase) : record.state === 'running'
  const config = data.entry?.runtime ?? record.runtime
  const status = last?.phase ?? record.state
  const boundIssues = data.issues?.workspaces.flatMap(ws => ws.issues.filter(issue => issue.assignee === `@${record.resumeId}`).map(issue => ({ wsId: ws.wsId, issue }))) ?? []
  const facts = [
    [text('created'), date(record.createdAt)],
    [text('started'), date(last ? last.startedAt : fallback?.startedAt ?? record.startedAt)],
    [text('active'), date(data.entry?.interactive?.lastActiveAt ?? record.lastActiveAt)],
  ]
  const configuration = [
    [text('runtime'), record.agent],
    [text('provider'), config?.credentialSource ?? last?.configuration.credentialSource ?? unknown],
    [text('model'), (config ? config.model : last?.configuration.model) ?? unknown],
    [text('effort'), (config ? config.reasoningEffort : last?.configuration.effort) ?? unknown],
  ]
  const diagnostics = [
    [text('workspace'), record.wsId],
    [text('surface'), last?.surface ?? record.surface ?? unknown],
    [text('ended'), live ? text('running') : date(last ? last.finishedAt : fallback?.finishedAt)],
    [text('credential'), (config ? config.credentialSlug : last?.configuration.credentialSlug) ?? unknown],
    [text('createdBy'), data.entry?.createdBy?.kind === 'issue' ? `Issue ${data.entry.createdBy.workspaceId}/${data.entry.createdBy.issueId}` : data.entry?.createdBy?.kind ?? unknown],
  ]
  const openIssue = (wsId: string, id: string) => {
    onClose()
    openOrFocus({ kind: 'issue-detail', params: { wsId, id } })
  }
  return <Dialog open onOpenChange={open => { if (!open) onClose() }}>
    <DialogContent initialFocus={titleRef} className="flex max-h-[90dvh] min-h-0 flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl" closeButtonClassName="top-4 right-4" closeLabel={t('common.close')}>
      <header className="flex min-w-0 items-center gap-3 border-b border-border py-4 pl-5 pr-16 sm:pl-7 sm:pr-16">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-foreground"><AgentRuntimeIcon agentId={record.agent} className="size-5" /></span>
        <div className="min-w-0">
          <DialogTitle ref={titleRef} tabIndex={-1} className="truncate outline-none text-base font-semibold leading-tight">{sessionCoworkerLabel(record)}</DialogTitle>
          <DialogDescription className="mt-0.5 text-xs">{text('title')}</DialogDescription>
        </div>
        <span className="ml-auto inline-flex shrink-0 items-center gap-2 rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
          {live && <span className="relative size-2 rounded-full bg-primary live-pulse motion-reduce:animate-none" aria-hidden />}
          {status}
        </span>
      </header>

      <div className="min-h-0 space-y-6 overflow-y-auto px-5 py-6 sm:px-7">
        {data.loading && <p role="status" className="text-sm text-muted-foreground">{t('common.loading')}</p>}
        {data.errors.length > 0 && <p role="alert" className="text-sm text-destructive">{text('partial')}</p>}
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground">{text('state')}</p>
          <p className="text-xl font-semibold capitalize">{status}</p>
          {live && <div className="oa-session-running-line h-0.5 max-w-sm overflow-hidden rounded-full bg-border" aria-hidden />}
        </div>
        <dl className="grid gap-x-5 gap-y-4 border-t border-border pt-5 text-sm sm:grid-cols-3">
          {facts.map(([label, value]) => <div key={label} className="min-w-0"><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-1 break-words tabular-nums">{value}</dd></div>)}
        </dl>
        <section className="border-t border-border pt-5">
          <h3 className="mb-3 text-sm font-semibold">{text('configuration')}</h3>
          <dl className="grid gap-x-5 gap-y-4 text-sm sm:grid-cols-2">
            {configuration.map(([label, value]) => <div key={label} className="min-w-0"><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-1 break-words">{value}</dd></div>)}
          </dl>
        </section>
        <section className="border-t border-border pt-5">
          <h3 className="mb-3 text-sm font-semibold">{text('issues')}</h3>
          {!data.loading && boundIssues.length === 0 && <p className="text-sm text-muted-foreground">{data.issues ? text('none') : unknown}</p>}
          {boundIssues.map(({ wsId, issue }) => <Button key={`${wsId}:${issue.id}`} variant="outline" className="h-auto max-w-full justify-start whitespace-normal text-left" onClick={() => openIssue(wsId, issue.id)}>
            {issue.title} · {issue.status}<ArrowUpRight size={14} aria-hidden />
          </Button>)}
        </section>
        <section className="border-t border-border pt-5">
          <h3 className="mb-3 text-sm font-semibold">{text('history')}</h3>
          {!data.loading && data.executions.length === 0 && <p className="text-sm text-muted-foreground">{text('noHistory')}</p>}
          <div className="space-y-2">{data.executions.map(run => <details key={run.executionId} className="rounded-lg border border-border px-3 py-2 text-sm">
            <summary className="cursor-pointer break-words py-1">{date(run.startedAt ?? run.requestedAt)} · {run.phase} · {run.origin.kind}</summary>
            <div className="mt-2 space-y-2 border-t border-border pt-3 text-muted-foreground">
              <p>{text('source')}: {run.origin.entry}</p>
              <p>{text('started')}: {date(run.startedAt)}</p><p>{text('ended')}: {date(run.finishedAt)}</p>
              <p>{text('reason')}: {run.reason ?? run.activity ?? unknown}</p>
              {run.origin.issueId && <Button variant="link" onClick={() => openIssue(run.origin.workspaceId ?? record.wsId, run.origin.issueId!)}>Issue {run.origin.issueId}</Button>}
              <p className="break-all font-mono text-xs">{run.executionId}{run.pid ? ` · PID ${run.pid}` : ''}</p>
            </div>
          </details>)}</div>
        </section>
        <details className="border-t border-border pt-4 text-xs text-muted-foreground">
          <summary className="cursor-pointer">{text('identifiers')}</summary>
          <dl className="mt-3 grid gap-2 sm:grid-cols-[9rem_minmax(0,1fr)]">
            {diagnostics.map(([label, value]) => <div key={label} className="contents"><dt>{label}</dt><dd className="break-all">{value}</dd></div>)}
            <dt>Session ID</dt><dd className="break-all">{record.id}</dd><dt>Resume ID</dt><dd className="break-all">{record.resumeId}</dd>
          </dl>
        </details>
      </div>
      <footer className="max-h-[45dvh] shrink-0 overflow-y-auto">
        <div className="border-t border-border px-5 py-2 sm:px-7"><Button variant="ghost" size="sm" disabled={data.loading} onClick={data.refresh}><RefreshCw size={15} aria-hidden />{t('workspace.sessionBusy.refresh')}</Button></div>
        <SessionControlPanel control={control} compact sessionName={sessionCoworkerLabel(record)} />
      </footer>
    </DialogContent>
  </Dialog>
}

export function SessionDetailsDialogHost() {
  const { record, close } = useSessionDetailsDialog()
  return record ? <SessionDetailsDialog key={`${record.wsId}:${record.id}`} record={record} onClose={close} /> : null
}
