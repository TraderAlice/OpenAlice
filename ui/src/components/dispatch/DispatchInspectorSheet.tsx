import { useEffect, useState } from 'react'
import type { TFunction } from 'i18next'
import { useTranslation } from 'react-i18next'
import {
  AlertTriangle,
  ArrowRight,
  Clock,
  ExternalLink,
  FileText,
  GitFork,
  Inbox,
  MessageSquare,
  Terminal,
} from 'lucide-react'

import type {
  DispatchArtifact,
  DispatchBoardSnapshot,
  DispatchEdge,
  DispatchEdgeKind,
  DispatchLane,
  DispatchScheduleMarker,
  DispatchSpan,
  DispatchTemplateKind,
} from '../../api/dispatch'
import { useWorkspaces } from '../../contexts/workspaces-context'
import { formatRelativeTime } from '../../lib/intl'
import { useInboxRead } from '../../live/inbox-read'
import { useInboxSelection } from '../../live/inbox-selection'
import { useWorkspace } from '../../tabs/store'
import type { FileViewerSource } from '../../tabs/types'
import { MarkdownContent } from '../MarkdownContent'
import { ModelIdentity } from '../ModelIdentity'
import { ScheduleSkipPill } from '../ScheduleSkipState'
import { Button } from '../ui/button'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '../ui/sheet'
import {
  formatClockPoint,
  formatDurationMs,
  isDifferentCalendarDay,
  localeForLanguage,
  spanTriggerIdentity,
} from './layout'

export type DispatchSelectedItem =
  | { readonly kind: 'span'; readonly item: DispatchSpan }
  | { readonly kind: 'edge'; readonly item: DispatchEdge }
  | { readonly kind: 'artifact'; readonly item: DispatchArtifact }
  | { readonly kind: 'schedule'; readonly item: DispatchScheduleMarker }
  | null

function formatClock(ms: number, referenceMs: number, language?: string): string {
  return formatClockPoint(ms, {
    includeDate: isDifferentCalendarDay(ms, referenceMs),
    includeSeconds: true,
    locale: localeForLanguage(language),
  })
}

function fileViewerSourceForLane(kind: DispatchTemplateKind | undefined): FileViewerSource | undefined {
  if (kind === 'chat' || kind === 'auto-quant' || kind === 'prediction') return kind
  return undefined
}

function statusBadgeClass(status: DispatchSpan['status']): string {
  if (status === 'running') return 'border-primary/40 bg-primary/10 text-primary'
  if (status === 'failed') return 'border-destructive/40 bg-destructive/10 text-destructive'
  if (status === 'interrupted') return 'border-warning/40 bg-warning/10 text-warning'
  return 'border-success/40 bg-success/10 text-success'
}

export function edgeKindLabel(kind: DispatchEdgeKind, t: TFunction, full = false): string {
  switch (kind) {
    case 'dispatch':
      return t(full ? 'issues.dispatch.edgeDispatchFull' : 'issues.dispatch.edgeDispatch')
    case 'question':
      return t(full ? 'issues.dispatch.edgeQuestionFull' : 'issues.dispatch.edgeQuestion')
    case 'reply':
      return t(full ? 'issues.dispatch.edgeReplyFull' : 'issues.dispatch.edgeReply')
    case 'send':
      return t(full ? 'issues.dispatch.edgeSendFull' : 'issues.dispatch.edgeSend')
    case 'worker_done':
      return t(full ? 'issues.dispatch.edgeWorkerDoneFull' : 'issues.dispatch.edgeWorkerDone')
    case 'escalation':
      return t(full ? 'issues.dispatch.edgeEscalationFull' : 'issues.dispatch.edgeEscalation')
    case 'conversation':
      return t(full ? 'issues.dispatch.edgeConversationFull' : 'issues.dispatch.edgeConversation')
  }
}

export function DispatchInspectorSheet({
  selected,
  snapshot,
  onSelect,
  onClose,
}: {
  selected: DispatchSelectedItem
  snapshot: DispatchBoardSnapshot | null
  onSelect: (next: DispatchSelectedItem) => void
  onClose: () => void
}) {
  const { t, i18n } = useTranslation()
  const referenceMs = snapshot?.toMs ?? Date.now()
  const { openHeadlessRun } = useWorkspaces()
  const openOrFocus = useWorkspace((s) => s.openOrFocus)
  const setSidebar = useWorkspace((s) => s.setSidebar)
  const selectInboxEntry = useInboxSelection((s) => s.select)
  const markInboxRead = useInboxRead((s) => s.markRead)
  const [promptTab, setPromptTab] = useState<'delivered' | 'original'>('delivered')

  useEffect(() => {
    setPromptTab('delivered')
  }, [selected?.kind, selected?.item])

  const laneById = new Map<string, DispatchLane>(
    (snapshot?.lanes ?? []).map((lane) => [lane.workspaceId, lane]),
  )

  const laneLabel = (wsId: string) => laneById.get(wsId)?.label ?? wsId

  const openSession = (wsId: string, resumeId: string, title?: string) => {
    setSidebar('chat')
    void openHeadlessRun(wsId, resumeId, title ? { title } : undefined)
  }

  const openIssue = (wsId: string, issueId: string) => {
    setSidebar('issue')
    openOrFocus({ kind: 'issue-detail', params: { wsId, id: issueId } })
  }

  const openInbox = (entryId: string) => {
    selectInboxEntry(entryId)
    markInboxRead(entryId)
    setSidebar('inbox')
    openOrFocus({ kind: 'inbox', params: {} })
  }

  const openReport = (wsId: string, path: string) => {
    const source = fileViewerSourceForLane(laneById.get(wsId)?.templateKind)
    openOrFocus({
      kind: 'file-viewer',
      params: { wsId, path, ...(source ? { source } : {}) },
    })
  }

  const title = !selected
    ? ''
    : selected.kind === 'span'
      ? t('issues.dispatch.inspectorRunTitle')
      : selected.kind === 'edge'
        ? t('issues.dispatch.inspectorEdgeTitle')
        : selected.kind === 'artifact'
          ? t('issues.dispatch.inspectorArtifactTitle')
          : t('issues.dispatch.inspectorScheduleTitle')

  const subtitle = !selected
    ? ''
    : selected.kind === 'span'
      ? `${laneLabel(selected.item.workspaceId)} · ${selected.item.sessionLabel || selected.item.resumeId}`
      : selected.kind === 'edge'
        ? `${laneLabel(selected.item.fromWorkspaceId)} → ${laneLabel(selected.item.toWorkspaceId)}`
        : selected.kind === 'artifact'
          ? `${laneLabel(selected.item.workspaceId)} · ${formatClock(selected.item.at, referenceMs, i18n.language)}`
          : `${laneLabel(selected.item.workspaceId)} · #${selected.item.issueId}`

  return (
    <Sheet open={selected !== null} onOpenChange={(next) => { if (!next) onClose() }}>
      <SheetContent
        side="right"
        className="w-full overflow-y-auto p-0 sm:max-w-lg"
        aria-label={title || t('issues.dispatch.inspectorRunTitle')}
      >
        {selected && (
          <div className="flex min-h-full flex-col">
            <SheetHeader className="border-b border-border/70 px-5 py-4 pr-12">
              <SheetTitle className="text-sm font-semibold">{title}</SheetTitle>
              <SheetDescription className="truncate text-xs">{subtitle}</SheetDescription>
            </SheetHeader>

            <div className="flex-1 space-y-5 p-5 text-xs">
              {selected.kind === 'span' && (
                <SpanDetail
                  span={selected.item}
                  snapshot={snapshot}
                  referenceMs={referenceMs}
                  laneLabel={laneLabel}
                  promptTab={promptTab}
                  onPromptTab={setPromptTab}
                  onSelect={onSelect}
                  onOpenSession={openSession}
                  onOpenIssue={openIssue}
                  onOpenInbox={openInbox}
                  onOpenReport={openReport}
                />
              )}

              {selected.kind === 'edge' && (
                <EdgeDetail
                  edge={selected.item}
                  laneLabel={laneLabel}
                  promptTab={promptTab}
                  onPromptTab={setPromptTab}
                  onOpenSession={openSession}
                  onOpenReport={openReport}
                />
              )}

              {selected.kind === 'artifact' && (
                <ArtifactDetail
                  artifact={selected.item}
                  laneLabel={laneLabel}
                  onOpenInbox={openInbox}
                  onOpenReport={openReport}
                  onOpenIssue={openIssue}
                  onOpenSession={openSession}
                />
              )}

              {selected.kind === 'schedule' && (
                <ScheduleDetail
                  marker={selected.item}
                  referenceMs={referenceMs}
                  laneLabel={laneLabel}
                  onOpenIssue={openIssue}
                />
              )}
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}

function MetaRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 break-words text-xs font-medium text-foreground">{value}</dd>
    </div>
  )
}

function SpanDetail({
  span,
  snapshot,
  referenceMs,
  laneLabel,
  promptTab,
  onPromptTab,
  onSelect,
  onOpenSession,
  onOpenIssue,
  onOpenInbox,
  onOpenReport,
}: {
  span: DispatchSpan
  snapshot: DispatchBoardSnapshot | null
  referenceMs: number
  laneLabel: (wsId: string) => string
  promptTab: 'delivered' | 'original'
  onPromptTab: (tab: 'delivered' | 'original') => void
  onSelect: (next: DispatchSelectedItem) => void
  onOpenSession: (wsId: string, resumeId: string, title?: string) => void
  onOpenIssue: (wsId: string, issueId: string) => void
  onOpenInbox: (entryId: string) => void
  onOpenReport: (wsId: string, path: string) => void
}) {
  const { t, i18n } = useTranslation()

  const triggerIdentity = spanTriggerIdentity(span)
  const siblingRuns = (snapshot?.spans ?? [])
    .filter((s) => s.workspaceId === span.workspaceId && spanTriggerIdentity(s) === triggerIdentity)
    .sort((a, b) => b.startedAt - a.startedAt || a.id.localeCompare(b.id))
  const siblingIndex = siblingRuns.findIndex((s) => s.id === span.id)

  const triggerText = (() => {
    switch (span.trigger.kind) {
      case 'scheduled-issue':
        return `${t('issues.dispatch.triggerScheduled')}: ${span.trigger.issueTitle || `#${span.trigger.issueId}`}`
      case 'orchestration':
        return `${t('issues.dispatch.triggerOrchestration')} (${laneLabel(span.trigger.parentWorkspaceId)})`
      case 'conversation':
        return `${t('issues.dispatch.triggerConversation')}${span.trigger.callerWorkspaceId ? ` (${laneLabel(span.trigger.callerWorkspaceId)})` : ''}`
      case 'inquiry':
        return `${t('issues.dispatch.triggerInquiry')}: ${span.trigger.question}`
      case 'interactive':
        return `${t('issues.dispatch.triggerInteractive')} (${span.trigger.surface})`
      case 'manual':
        return t('issues.dispatch.triggerManual')
    }
  })()

  const relatedEdges = (snapshot?.edges ?? []).filter((edge) =>
    edge.taskId === span.id
    || (span.trigger.kind === 'orchestration' && edge.dispatchId === span.trigger.dispatchId)
    || (edge.fromWorkspaceId === span.workspaceId && edge.fromResumeId === span.resumeId)
    || (edge.toWorkspaceId === span.workspaceId && edge.toResumeId === span.resumeId),
  )

  const relatedArtifacts = (snapshot?.artifacts ?? []).filter((art) =>
    art.runId === span.id
    || (art.workspaceId === span.workspaceId && art.resumeId === span.resumeId),
  )

  const statusText = span.status === 'running'
    ? t('issues.dispatch.statusRunning')
    : span.status === 'failed'
      ? t('issues.dispatch.statusFailed')
      : span.status === 'interrupted'
        ? t('issues.dispatch.statusInterrupted')
        : t('issues.dispatch.statusDone')

  const displayedPrompt = promptTab === 'original' && span.originalPrompt ? span.originalPrompt : span.prompt

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${statusBadgeClass(span.status)}`}>
            {span.status === 'running' && (
              <span className="size-1.5 rounded-full bg-current animate-pulse motion-reduce:animate-none" aria-hidden />
            )}
            {statusText}
          </span>
          <span className="text-[11px] tabular-nums text-muted-foreground">
            {formatClock(span.startedAt, referenceMs, i18n.language)}
            {span.finishedAt ? ` – ${formatClock(span.finishedAt, referenceMs, i18n.language)}` : ' – …'}
          </span>
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-7 gap-1.5 text-xs"
          onClick={() => onOpenSession(span.workspaceId, span.resumeId, span.sessionLabel || span.id)}
        >
          <Terminal size={12} aria-hidden />
          {t('issues.dispatch.openSession')}
        </Button>
      </div>

      {siblingRuns.length > 1 && siblingIndex !== -1 && (
        <div className="flex items-center justify-between gap-2 rounded-lg border border-border/70 bg-muted/20 px-3 py-1.5 text-[11px]">
          <span className="text-muted-foreground tabular-nums">
            {t('issues.dispatch.runsInSequence', { index: siblingIndex + 1, total: siblingRuns.length })}
          </span>
          <div className="flex items-center gap-1">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-6 px-2 text-[11px]"
              disabled={siblingIndex >= siblingRuns.length - 1}
              onClick={() => onSelect({ kind: 'span', item: siblingRuns[siblingIndex + 1]! })}
            >
              {t('issues.dispatch.previousRun')}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-6 px-2 text-[11px]"
              disabled={siblingIndex <= 0}
              onClick={() => onSelect({ kind: 'span', item: siblingRuns[siblingIndex - 1]! })}
            >
              {t('issues.dispatch.nextRun')}
            </Button>
          </div>
        </div>
      )}

      <dl className="grid grid-cols-2 gap-3 rounded-lg border border-border/70 bg-muted/30 p-3">
        <MetaRow label={t('issues.dispatch.workspaceLabel')} value={laneLabel(span.workspaceId)} />
        <MetaRow label={t('issues.dispatch.sessionLabel')} value={span.sessionLabel || span.resumeId} />
        <MetaRow
          label={t('issues.dispatch.agentLabel')}
          value={
            span.model ? (
              <span className="inline-flex flex-wrap items-center gap-1.5">
                <span>{span.agent}</span>
                <span className="text-muted-foreground">·</span>
                <ModelIdentity model={span.model} />
              </span>
            ) : (
              span.agent
            )
          }
        />
        <MetaRow label={t('issues.dispatch.durationLabel')} value={formatDurationMs(span.durationMs)} />
        <MetaRow
          label={t('issues.dispatch.toolsLabel')}
          value={t('issues.dispatch.toolsSummary', { calls: span.toolCalls, failures: span.toolFailures })}
        />
        <MetaRow
          label={t('issues.dispatch.triggerLabel')}
          value={
            <div className="flex items-center gap-1.5">
              <span>{triggerText}</span>
              {span.trigger.kind === 'scheduled-issue' && (
                <button
                  type="button"
                  onClick={() => onOpenIssue(span.trigger.kind === 'scheduled-issue' ? span.trigger.workspaceId : span.workspaceId, span.trigger.kind === 'scheduled-issue' ? span.trigger.issueId : '')}
                  className="inline-flex items-center gap-0.5 text-primary hover:underline"
                >
                  {t('issues.dispatch.openIssue')}
                  <ExternalLink size={10} aria-hidden />
                </button>
              )}
            </div>
          }
        />
      </dl>

      {span.error && (
        <div role="alert" className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-destructive">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden />
          <p className="min-w-0 break-words whitespace-pre-wrap">{span.error}</p>
        </div>
      )}

      {span.delivery && (
        <div className="rounded-lg border border-border/70 p-3">
          <p className="mb-1 text-[11px] font-medium text-muted-foreground">{t('issues.dispatch.deliveryLabel')}</p>
          {span.delivery.kind === 'connector' ? (
            <p className="text-foreground">
              {span.delivery.connectorId} · {span.delivery.source} · {span.delivery.state}
              {span.delivery.error ? ` (${span.delivery.error})` : ''}
            </p>
          ) : (
            <button
              type="button"
              onClick={() => onOpenIssue(span.delivery!.kind !== 'connector' ? span.delivery!.workspaceId : span.workspaceId, span.delivery!.kind !== 'connector' ? span.delivery!.issueId : '')}
              className="inline-flex items-center gap-1 text-primary hover:underline"
            >
              {span.delivery.kind} · #{span.delivery.issueId}
              <ExternalLink size={10} aria-hidden />
            </button>
          )}
        </div>
      )}

      {displayedPrompt && (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <h4 className="font-medium text-foreground">{t('issues.dispatch.promptSection')}</h4>
            {span.originalPrompt && (
              <div className="inline-flex rounded-md border border-border bg-muted/40 p-0.5" role="group">
                <button
                  type="button"
                  onClick={() => onPromptTab('original')}
                  aria-pressed={promptTab === 'original'}
                  className={`rounded px-2 py-0.5 text-[11px] ${promptTab === 'original' ? 'bg-background font-medium text-foreground shadow-xs' : 'text-muted-foreground'}`}
                >
                  {t('issues.dispatch.promptOriginal')}
                </button>
                <button
                  type="button"
                  onClick={() => onPromptTab('delivered')}
                  aria-pressed={promptTab === 'delivered'}
                  className={`rounded px-2 py-0.5 text-[11px] ${promptTab === 'delivered' ? 'bg-background font-medium text-foreground shadow-xs' : 'text-muted-foreground'}`}
                >
                  {t('issues.dispatch.promptDelivered')}
                </button>
              </div>
            )}
          </div>
          <pre className="max-h-56 overflow-y-auto whitespace-pre-wrap break-words rounded-lg border border-border/70 bg-muted/30 p-3 font-mono text-[11px] leading-relaxed text-foreground">
            {displayedPrompt}
          </pre>
        </div>
      )}

      {span.assistantPreview && (
        <div className="space-y-1.5">
          <h4 className="font-medium text-foreground">{t('issues.dispatch.outputTitle')}</h4>
          <div className="rounded-lg border border-border/70 bg-background p-3">
            <MarkdownContent text={span.assistantPreview} />
          </div>
        </div>
      )}

      {relatedEdges.length > 0 && (
        <div className="space-y-2">
          <h4 className="font-medium text-foreground">{t('issues.dispatch.relatedMessagesTitle')}</h4>
          <div className="space-y-1.5">
            {relatedEdges.map((edge) => (
              <button
                key={edge.id}
                type="button"
                onClick={() => onSelect({ kind: 'edge', item: edge })}
                className="flex w-full items-start justify-between gap-2 rounded-lg border border-border/70 bg-muted/20 px-3 py-2 text-left hover:bg-muted/50"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 font-medium text-foreground">
                    <GitFork size={11} className="shrink-0 text-primary" aria-hidden />
                    <span>{edgeKindLabel(edge.kind, t, true)}</span>
                    <span className="text-muted-foreground">·</span>
                    <span className="truncate text-muted-foreground">
                      {laneLabel(edge.fromWorkspaceId)} → {laneLabel(edge.toWorkspaceId)}
                    </span>
                  </div>
                  {(edge.subject || edge.body || edge.spec) && (
                    <p className="mt-1 line-clamp-2 text-[11px] text-muted-foreground">
                      {edge.subject || edge.body || edge.spec}
                    </p>
                  )}
                </div>
                <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                  {formatClock(edge.at, referenceMs, i18n.language)}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {relatedArtifacts.length > 0 && (
        <div className="space-y-2">
          <h4 className="font-medium text-foreground">{t('issues.dispatch.producedOutputsTitle')}</h4>
          <div className="space-y-1.5">
            {relatedArtifacts.map((art) => (
              <button
                key={art.id}
                type="button"
                onClick={() => onSelect({ kind: 'artifact', item: art })}
                className="flex w-full items-center justify-between gap-2 rounded-lg border border-border/70 bg-muted/20 px-3 py-2 text-left hover:bg-muted/50"
              >
                <div className="flex min-w-0 items-center gap-2">
                  {art.kind === 'inbox' ? (
                    <Inbox size={13} className="shrink-0 text-primary" aria-hidden />
                  ) : (
                    <FileText size={13} className="shrink-0 text-muted-foreground" aria-hidden />
                  )}
                  <span className="truncate font-medium text-foreground">
                    {art.kind === 'inbox' ? art.title : art.path}
                  </span>
                </div>
                <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                  {formatClock(art.at, referenceMs, i18n.language)}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {relatedArtifacts.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {relatedArtifacts.filter((art) => art.kind === 'inbox').slice(0, 1).map((art) => (
            <Button
              key={art.id}
              type="button"
              size="sm"
              variant="outline"
              onClick={() => onOpenInbox(art.kind === 'inbox' ? art.entryId : '')}
            >
              <Inbox size={12} aria-hidden />
              {t('issues.dispatch.openInbox')}
            </Button>
          ))}
          {relatedArtifacts.filter((art) => art.kind === 'report').slice(0, 1).map((art) => (
            <Button
              key={art.id}
              type="button"
              size="sm"
              variant="outline"
              onClick={() => onOpenReport(art.workspaceId, art.kind === 'report' ? art.path : '')}
            >
              <FileText size={12} aria-hidden />
              {t('issues.dispatch.openReport')}
            </Button>
          ))}
        </div>
      )}
    </>
  )
}

function EdgeDetail({
  edge,
  laneLabel,
  promptTab,
  onPromptTab,
  onOpenSession,
  onOpenReport,
}: {
  edge: DispatchEdge
  laneLabel: (wsId: string) => string
  promptTab: 'delivered' | 'original'
  onPromptTab: (tab: 'delivered' | 'original') => void
  onOpenSession: (wsId: string, resumeId: string, title?: string) => void
  onOpenReport: (wsId: string, path: string) => void
}) {
  const { t } = useTranslation()

  const deliveryLabel = edge.deliveryStatus === 'unread'
    ? t('issues.dispatch.mailboxUnread')
    : edge.deliveryStatus === 'leased'
      ? t('issues.dispatch.mailboxLeased')
      : edge.deliveryStatus === 'acked'
        ? t('issues.dispatch.mailboxAcked')
        : null

  const deliverables = edge.deliverables ?? edge.metadata?.deliverables ?? []

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/50 px-2.5 py-0.5 text-[11px] font-medium text-foreground">
          <MessageSquare size={11} className="text-primary" aria-hidden />
          {edgeKindLabel(edge.kind, t, true)}
        </span>
        {deliveryLabel && (
          <span className="text-[11px] text-muted-foreground">
            {deliveryLabel}
            {edge.ackedAt ? ` · ${formatDurationMs(edge.ackedAt - edge.at)}` : ''}
          </span>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border/70 bg-muted/30 p-3">
        <div className="min-w-0">
          <span className="block text-[10px] text-muted-foreground">{t('issues.dispatch.fromLabel')}</span>
          <span className="font-medium text-foreground">{laneLabel(edge.fromWorkspaceId)}</span>
          {edge.fromResumeId && (
            <button
              type="button"
              onClick={() => onOpenSession(edge.fromWorkspaceId, edge.fromResumeId!)}
              className="ml-1.5 text-[11px] text-primary hover:underline"
            >
              {edge.fromResumeId}
            </button>
          )}
        </div>
        <ArrowRight size={13} className="shrink-0 text-muted-foreground" aria-hidden />
        <div className="min-w-0">
          <span className="block text-[10px] text-muted-foreground">{t('issues.dispatch.toLabel')}</span>
          <span className="font-medium text-foreground">{laneLabel(edge.toWorkspaceId)}</span>
          <button
            type="button"
            onClick={() => onOpenSession(edge.toWorkspaceId, edge.toResumeId)}
            className="ml-1.5 text-[11px] text-primary hover:underline"
          >
            {edge.toResumeId}
          </button>
        </div>
      </div>

      {edge.spec && (
        <div className="space-y-1.5">
          <h4 className="font-medium text-foreground">{t('issues.dispatch.specTitle')}</h4>
          <div className="rounded-lg border border-border/70 bg-muted/20 p-3">
            <MarkdownContent text={edge.spec} />
          </div>
        </div>
      )}

      {(edge.subject || edge.body) && (
        <div className="space-y-1.5">
          <h4 className="font-medium text-foreground">{edge.subject || t('issues.dispatch.messageBodyTitle')}</h4>
          {edge.body && (
            <div className="rounded-lg border border-border/70 bg-background p-3">
              <MarkdownContent text={edge.body} />
            </div>
          )}
        </div>
      )}

      {edge.kind === 'conversation' && (edge.originalPrompt || edge.deliveredPrompt) && (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <h4 className="font-medium text-foreground">{t('issues.dispatch.promptSection')}</h4>
            {edge.originalPrompt && edge.deliveredPrompt && edge.originalPrompt !== edge.deliveredPrompt && (
              <div className="inline-flex rounded-md border border-border bg-muted/40 p-0.5" role="group">
                <button
                  type="button"
                  onClick={() => onPromptTab('original')}
                  aria-pressed={promptTab === 'original'}
                  className={`rounded px-2 py-0.5 text-[11px] ${promptTab === 'original' ? 'bg-background font-medium text-foreground shadow-xs' : 'text-muted-foreground'}`}
                >
                  {t('issues.dispatch.promptOriginal')}
                </button>
                <button
                  type="button"
                  onClick={() => onPromptTab('delivered')}
                  aria-pressed={promptTab === 'delivered'}
                  className={`rounded px-2 py-0.5 text-[11px] ${promptTab === 'delivered' ? 'bg-background font-medium text-foreground shadow-xs' : 'text-muted-foreground'}`}
                >
                  {t('issues.dispatch.promptDelivered')}
                </button>
              </div>
            )}
          </div>
          <pre className="max-h-56 overflow-y-auto whitespace-pre-wrap break-words rounded-lg border border-border/70 bg-muted/30 p-3 font-mono text-[11px] leading-relaxed">
            {promptTab === 'original' && edge.originalPrompt ? edge.originalPrompt : edge.deliveredPrompt || edge.originalPrompt}
          </pre>
        </div>
      )}

      {edge.assistantText && (
        <div className="space-y-1.5">
          <h4 className="font-medium text-foreground">{t('issues.dispatch.outputTitle')}</h4>
          <div className="rounded-lg border border-border/70 bg-background p-3">
            <MarkdownContent text={edge.assistantText} />
          </div>
        </div>
      )}

      {(edge.summary || edge.evidence || edge.metadata?.evidence) && (
        <div className="space-y-2 rounded-lg border border-border/70 bg-muted/20 p-3">
          {edge.summary && <p className="text-foreground">{edge.summary}</p>}
          {(edge.evidence || edge.metadata?.evidence) && (
            <div>
              <span className="block text-[11px] text-muted-foreground">{t('issues.dispatch.evidenceTitle')}</span>
              <p className="mt-0.5 whitespace-pre-wrap text-foreground">{edge.evidence || edge.metadata?.evidence}</p>
            </div>
          )}
        </div>
      )}

      {deliverables.length > 0 && (
        <div className="space-y-2">
          <h4 className="font-medium text-foreground">{t('issues.dispatch.deliverablesTitle')}</h4>
          <div className="space-y-1.5">
            {deliverables.map((del) => {
              const targetWs = del.workspaceId || edge.fromWorkspaceId
              return (
                <button
                  key={`${targetWs}:${del.path}`}
                  type="button"
                  onClick={() => onOpenReport(targetWs, del.path)}
                  className="flex w-full items-center justify-between gap-2 rounded-lg border border-border/70 bg-muted/20 px-3 py-2 text-left hover:bg-muted/50"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 font-mono text-[11px] text-foreground">
                      <FileText size={12} className="shrink-0 text-primary" aria-hidden />
                      <span className="truncate">{del.path}</span>
                    </div>
                    {del.summary && <p className="mt-0.5 text-[11px] text-muted-foreground">{del.summary}</p>}
                  </div>
                  <ExternalLink size={12} className="shrink-0 text-muted-foreground" aria-hidden />
                </button>
              )
            })}
          </div>
        </div>
      )}
    </>
  )
}

function ArtifactDetail({
  artifact,
  laneLabel,
  onOpenInbox,
  onOpenReport,
  onOpenIssue,
  onOpenSession,
}: {
  artifact: DispatchArtifact
  laneLabel: (wsId: string) => string
  onOpenInbox: (entryId: string) => void
  onOpenReport: (wsId: string, path: string) => void
  onOpenIssue: (wsId: string, issueId: string) => void
  onOpenSession: (wsId: string, resumeId: string, title?: string) => void
}) {
  const { t } = useTranslation()

  if (artifact.kind === 'report') {
    return (
      <>
        <dl className="grid grid-cols-2 gap-3 rounded-lg border border-border/70 bg-muted/30 p-3">
          <MetaRow label={t('issues.dispatch.workspaceLabel')} value={laneLabel(artifact.workspaceId)} />
          <MetaRow label={t('issues.dispatch.deliverablesTitle')} value={<span className="font-mono text-[11px]">{artifact.path}</span>} />
        </dl>
        {artifact.summary && (
          <p className="rounded-lg border border-border/70 bg-background p-3 text-foreground">{artifact.summary}</p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" onClick={() => onOpenReport(artifact.workspaceId, artifact.path)}>
            <FileText size={13} aria-hidden />
            {t('issues.dispatch.openReport')}
          </Button>
          {artifact.resumeId && (
            <Button type="button" size="sm" variant="outline" onClick={() => onOpenSession(artifact.workspaceId, artifact.resumeId!, artifact.path)}>
              <Terminal size={13} aria-hidden />
              {t('issues.dispatch.openSession')}
            </Button>
          )}
        </div>
      </>
    )
  }

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${artifact.unread ? 'border-primary/40 bg-primary/10 text-primary' : 'border-border bg-muted/40 text-muted-foreground'}`}>
          <Inbox size={11} aria-hidden />
          {artifact.unread ? t('issues.dispatch.inboxUnread') : t('issues.dispatch.inboxRead')}
        </span>
        <span className="text-[11px] text-muted-foreground">{formatRelativeTime(artifact.at)}</span>
      </div>

      <div className="rounded-lg border border-border/70 bg-background p-3.5">
        <MarkdownContent
          text={artifact.body}
          onFileReference={(path) => onOpenReport(artifact.workspaceId, path)}
        />
      </div>

      {artifact.files.length > 0 && (
        <div className="space-y-1.5">
          <h4 className="font-medium text-foreground">{t('issues.dispatch.referencedFilesTitle')}</h4>
          <div className="space-y-1">
            {artifact.files.map((path) => (
              <button
                key={path}
                type="button"
                onClick={() => onOpenReport(artifact.workspaceId, path)}
                className="flex w-full items-center justify-between gap-2 rounded-md border border-border/70 bg-muted/20 px-3 py-1.5 font-mono text-[11px] hover:bg-muted/50"
              >
                <span className="truncate">{path}</span>
                <ExternalLink size={11} className="shrink-0 text-muted-foreground" aria-hidden />
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" onClick={() => onOpenInbox(artifact.entryId)}>
          <Inbox size={13} aria-hidden />
          {t('issues.dispatch.openInbox')}
        </Button>
        {artifact.resumeId && (
          <Button type="button" size="sm" variant="outline" onClick={() => onOpenSession(artifact.workspaceId, artifact.resumeId!, artifact.title)}>
            <Terminal size={13} aria-hidden />
            {t('issues.dispatch.openSession')}
          </Button>
        )}
        {artifact.issueId && (
          <Button type="button" size="sm" variant="outline" onClick={() => onOpenIssue(artifact.workspaceId, artifact.issueId!)}>
            <Clock size={13} aria-hidden />
            {t('issues.dispatch.openIssue')}
          </Button>
        )}
      </div>
    </>
  )
}

function ScheduleDetail({
  marker,
  referenceMs,
  laneLabel,
  onOpenIssue,
}: {
  marker: DispatchScheduleMarker
  referenceMs: number
  laneLabel: (wsId: string) => string
  onOpenIssue: (wsId: string, issueId: string) => void
}) {
  const { t, i18n } = useTranslation()
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-foreground">{marker.title}</h3>
        {marker.skipState && <ScheduleSkipPill skipState={marker.skipState} />}
      </div>
      <dl className="grid grid-cols-2 gap-3 rounded-lg border border-border/70 bg-muted/30 p-3">
        <MetaRow label={t('issues.dispatch.workspaceLabel')} value={laneLabel(marker.workspaceId)} />
        <MetaRow label={t('issues.dispatch.scheduleLabel')} value={`#${marker.issueId}`} />
        <MetaRow
          label={t('issues.dispatch.nextDue')}
          value={marker.nextDueAtMs ? `${formatClock(marker.nextDueAtMs, referenceMs, i18n.language)} (${formatRelativeTime(marker.nextDueAtMs)})` : '—'}
        />
        <MetaRow
          label={t('issues.dispatch.lastFired')}
          value={marker.lastFiredAtMs ? `${formatClock(marker.lastFiredAtMs, referenceMs, i18n.language)} (${formatRelativeTime(marker.lastFiredAtMs)})` : t('issues.dispatch.neverFired')}
        />
      </dl>
      <Button type="button" size="sm" onClick={() => onOpenIssue(marker.workspaceId, marker.issueId)}>
        <ExternalLink size={13} aria-hidden />
        {t('issues.dispatch.openIssue')}
      </Button>
    </>
  )
}
