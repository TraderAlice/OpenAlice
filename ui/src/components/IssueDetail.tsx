import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { ArrowLeft, Hash, History, Inbox, ListChecks, RotateCcw, Settings, TrendingUp, X } from 'lucide-react'

import type { HeadlessTaskStatus } from '../api/headless'
import type { InboxEntry } from '../api/inbox'
import type {
  IssueDetail as IssueDetailData,
  IssueDetailIssue,
  IssueActivityRecord,
  IssuePriority,
  IssueProvenanceRecord,
  IssueRunRecord,
  IssueStatus,
  WikilinkIssueRef,
  WikilinkResolution,
} from '../api/issues'
import {
  getAgentReadiness,
  getWorkspaceSessionDirectory,
  type AgentCredentialReadiness,
  type AgentId,
  type WorkspaceSessionDirectoryEntry,
} from './workspace/api'
import { issuesApi } from '../api/issues'
import { inquiriesApi } from '../api/inquiries'
import { useIssueDetail } from '../hooks/useIssueDetail'
import { useWorkspaces } from '../contexts/workspaces-context'
import { formatRelativeTime } from '../lib/intl'
import { useInboxRead } from '../live/inbox-read'
import { useInboxSelection } from '../live/inbox-selection'
import { previewForEntry } from '../live/inbox-threads'
import { useWikilinkHandler } from '../live/wikilink'
import { useWorkspace } from '../tabs/store'
import { AutomationHealthPill, CadencePill, PriorityIndicator } from './IssuesBoard'
import { STATUS_META } from './issue-status-meta'
import { MarkdownContent } from './MarkdownContent'
import { MarkdownWhatEditor } from './MarkdownWhatEditor'
import { CenteredLoading } from './StateViews'
import { InquiryPanel } from './InquiryPanel'

// Run-status pill tints — mirrors AutomationRunsSection's STATUS_STYLE so the
// Activity feed reads the same as the headless-runs panel.
const RUN_STATUS_STYLE: Record<HeadlessTaskStatus, string> = {
  running: 'bg-blue-500/15 text-blue-400',
  done: 'bg-emerald-500/15 text-emerald-400',
  failed: 'bg-red-500/15 text-red-400',
  interrupted: 'bg-amber-500/15 text-amber-400',
}

// Dropdown ordering for the editable Properties rail. Mirrors the board's
// STATUS_ORDER (active work first) and the priority enum (most → least urgent).
const STATUS_OPTIONS: IssueStatus[] = ['in_progress', 'todo', 'backlog', 'done', 'canceled']
const PRIORITY_OPTIONS: IssuePriority[] = ['urgent', 'high', 'medium', 'low', 'none']

// Shared compact control styling for the rail's selects / inline input — the
// settings `inputClass`, trimmed for the narrow rail.
const railControl =
  'min-w-0 flex-1 rounded-md border border-border bg-bg px-2 py-1 text-[13px] text-text outline-none transition-colors focus:border-accent/60 focus:shadow-[0_0_0_1px_var(--color-accent-dim)] disabled:cursor-not-allowed disabled:opacity-50'

const CONFIGURABLE_AGENTS: readonly AgentId[] = ['claude', 'codex', 'opencode', 'pi']

function isConfigurableAgent(agent: string | null | undefined): agent is AgentId {
  return CONFIGURABLE_AGENTS.includes(agent as AgentId)
}

function fmtDuration(ms?: number): string {
  if (ms == null) return '—'
  if (ms < 1000) return `${ms}ms`
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  return `${Math.floor(s / 60)}m ${s % 60}s`
}

// ==================== Properties rail ====================

function PropRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 py-2">
      <span className="shrink-0 text-xs text-muted">{label}</span>
      <div className="min-w-0 text-right text-[13px] text-text">{children}</div>
    </div>
  )
}

/** Editable row: label on the left, an interactive control filling the right. */
function EditRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2">
      <span className="shrink-0 text-xs text-muted">{label}</span>
      <div className="flex min-w-0 flex-1 items-center justify-end gap-1.5">{children}</div>
    </div>
  )
}

function AssigneeEditor({
  value,
  scheduled,
  sessions,
  disabled,
  onChange,
}: {
  value: string
  scheduled: boolean
  sessions: readonly WorkspaceSessionDirectoryEntry[]
  disabled?: boolean
  onChange: (next: string) => void
}) {
  const sessionChoices = sessions.filter(
    (session) => session.resumeId && session.agent !== 'shell' && session.resumable,
  )
  const selectedResumeId = value.startsWith('@resume-') ? value.slice(1) : null
  const hasSelected = !selectedResumeId || sessionChoices.some((session) => session.resumeId === selectedResumeId)
  const labelFor = (session: WorkspaceSessionDirectoryEntry) => {
    const raw = session.interactive?.title
      || session.interactive?.name
      || session.latestExecution?.assistantPreview
      || session.resumeId
    const label = raw.length > 38 ? `${raw.slice(0, 37)}…` : raw
    return `${label} · ${session.agent}`
  }

  return (
    <select
      className={railControl}
      value={value}
      disabled={disabled}
      aria-label="Assignee"
      onChange={(event) => onChange(event.target.value)}
    >
      <option value="@workspace">{scheduled ? '@Workspace · new Session each run' : '@Workspace'}</option>
      {!scheduled && <option value="@human">Human</option>}
      {!scheduled && <option value="@unassigned">Unassigned</option>}
      <optgroup label="Workspace Sessions">
        {sessionChoices.map((session) => (
          <option key={session.resumeId} value={`@${session.resumeId}`}>
            {labelFor(session)}
          </option>
        ))}
        {!hasSelected && selectedResumeId && (
          <option value={value}>Signed Session · {selectedResumeId}</option>
        )}
      </optgroup>
    </select>
  )
}

function AgentEditor({
  value,
  issueDefaultAgent,
  defaultAgent,
  options,
  readiness,
  disabled,
  onChange,
  onConfigure,
}: {
  value?: string
  issueDefaultAgent: string | null
  defaultAgent: string | null
  options: readonly { id: string; displayName: string; installed?: boolean }[]
  readiness: Readonly<Record<string, AgentCredentialReadiness>>
  disabled?: boolean
  onChange: (next: string | null) => void
  onConfigure: (agent: AgentId) => void
}) {
  const selected = value ?? ''
  const issueDefaultInOptions = issueDefaultAgent && options.some((a) => a.id === issueDefaultAgent) ? issueDefaultAgent : null
  const defaultInOptions = defaultAgent && options.some((a) => a.id === defaultAgent) ? defaultAgent : null
  const effectiveAgent = value || issueDefaultInOptions || defaultInOptions || options[0]?.id || null
  const canConfigure = isConfigurableAgent(effectiveAgent)
  const defaultLabel = issueDefaultInOptions
    ? `Default (${options.find((a) => a.id === issueDefaultInOptions)?.displayName ?? issueDefaultInOptions})`
    : defaultInOptions
    ? `Default (${options.find((a) => a.id === defaultInOptions)?.displayName ?? defaultInOptions}, workspace)`
    : 'Default'

  return (
    <>
      <select
        className={railControl}
        value={selected}
        disabled={disabled}
        onChange={(e) => {
          const next = e.target.value
          onChange(next ? next : null)
        }}
      >
        <option value="">{defaultLabel}</option>
        {options.map((agent) => {
          const row = readiness[agent.id]
          const suffix =
            agent.installed === false ? ' (missing)'
            : row?.requiresCredential && !row.ready ? ' (needs cred)'
            : ''
          return (
            <option key={agent.id} value={agent.id}>
              {agent.displayName}{suffix}
            </option>
          )
        })}
        {value && !options.some((agent) => agent.id === value) && (
          <option value={value}>{value}</option>
        )}
      </select>
      <button
        type="button"
        disabled={!canConfigure}
        onClick={() => {
          if (canConfigure) onConfigure(effectiveAgent)
        }}
        title={canConfigure ? `Configure ${effectiveAgent}` : 'No configurable runtime selected'}
        aria-label={canConfigure ? `Configure ${effectiveAgent}` : 'No configurable runtime selected'}
        className="shrink-0 rounded-md border border-border bg-bg px-2 py-1 text-muted transition-colors hover:border-accent/50 hover:text-text disabled:cursor-not-allowed disabled:opacity-40"
      >
        <Settings size={14} aria-hidden />
      </button>
    </>
  )
}

function PropertySection({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children: ReactNode
}) {
  return (
    <section className="rounded-lg border border-border bg-bg p-3">
      <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted/70">{title}</h3>
      {description && <p className="mt-1 text-[11px] leading-snug text-muted">{description}</p>}
      <div className="mt-2 divide-y divide-border/60">{children}</div>
    </section>
  )
}

function PropertiesRail({
  issue,
  agentOptions,
  issueDefaultAgent,
  defaultAgent,
  agentReadiness,
  sessions,
  saving,
  retrying,
  error,
  canRetry,
  onPatch,
  onRetry,
  onConfigureAgent,
}: {
  issue: IssueDetailIssue
  agentOptions: readonly { id: string; displayName: string; installed?: boolean }[]
  issueDefaultAgent: string | null
  defaultAgent: string | null
  agentReadiness: Readonly<Record<string, AgentCredentialReadiness>>
  sessions: readonly WorkspaceSessionDirectoryEntry[]
  saving: boolean
  retrying: boolean
  error: string | null
  canRetry: boolean
  onPatch: (patch: { status?: IssueStatus; priority?: IssuePriority; assignee?: string; agent?: string | null; what?: string }) => void
  onRetry: () => void
  onConfigureAgent: (agent: AgentId) => void
}) {
  const meta = STATUS_META[issue.status]
  const issueDefaultInOptions = issueDefaultAgent && agentOptions.some((a) => a.id === issueDefaultAgent) ? issueDefaultAgent : null
  const defaultInOptions = defaultAgent && agentOptions.some((a) => a.id === defaultAgent) ? defaultAgent : null
  const ownerResumeId = issue.assignee.startsWith('@resume-')
    ? issue.assignee.slice(1)
    : null
  const ownerSession = ownerResumeId
    ? sessions.find((session) => session.resumeId === ownerResumeId)
    : undefined
  const effectiveAgent = ownerSession?.agent || issue.agent || issueDefaultInOptions || defaultInOptions || agentOptions[0]?.id || null
  const selectedReadiness = effectiveAgent ? agentReadiness[effectiveAgent] : undefined
  const agentNeedsCredential = selectedReadiness?.requiresCredential === true && !selectedReadiness.ready
  return (
    <aside className="w-full shrink-0 space-y-3 lg:col-start-2 lg:row-start-1 lg:row-span-2">
      <PropertySection title="Work item" description="Ownership and schedule are part of this Issue.">
        <EditRow label="Status">
          <meta.Icon size={14} className={`shrink-0 ${meta.className}`} />
          <select
            className={railControl}
            value={issue.status}
            disabled={saving}
            onChange={(e) => onPatch({ status: e.target.value as IssueStatus })}
          >
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {STATUS_META[s].label}
              </option>
            ))}
          </select>
        </EditRow>
        <EditRow label="Priority">
          <PriorityIndicator priority={issue.priority} />
          <select
            className={`${railControl} capitalize`}
            value={issue.priority}
            disabled={saving}
            onChange={(e) => onPatch({ priority: e.target.value as IssuePriority })}
          >
            {PRIORITY_OPTIONS.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </EditRow>
        <EditRow label="Assignee">
          <AssigneeEditor
            value={issue.assignee}
            scheduled={Boolean(issue.when)}
            sessions={sessions}
            disabled={saving}
            onChange={(assignee) => onPatch({ assignee })}
          />
        </EditRow>
        {issue.when && (
          <>
          <PropRow label="Cadence"><CadencePill when={issue.when} /></PropRow>
          {ownerResumeId ? (
            <PropRow label="Runtime">
              <span title="The responsible Session determines its runtime">
                {ownerSession?.agent ?? 'Session-owned'}
              </span>
            </PropRow>
          ) : (
            <EditRow label="Runtime">
              <AgentEditor
                value={issue.agent}
                issueDefaultAgent={issueDefaultAgent}
                defaultAgent={defaultAgent}
                options={agentOptions}
                readiness={agentReadiness}
                disabled={saving}
                onChange={(agent) => onPatch({ agent })}
                onConfigure={onConfigureAgent}
              />
            </EditRow>
          )}
          {agentNeedsCredential && (
            <p className="py-2 text-right text-[11px] leading-snug text-amber-400">AI credential missing.</p>
          )}
          {issue.automationHealth && (
            <PropRow label="Health">
              <div className="flex flex-col items-end gap-1">
                <AutomationHealthPill health={issue.automationHealth} />
                <span className="max-w-44 text-[11px] leading-snug text-muted">
                  {issue.automationHealth.message}
                </span>
                {canRetry && (
                  <button
                    type="button"
                    disabled={retrying}
                    onClick={onRetry}
                    className="oa-pressable mt-1 inline-flex items-center gap-1.5 rounded-md border border-amber-500/30 bg-amber-500/10 px-2.5 py-1.5 text-[11px] font-medium text-amber-400 transition-colors hover:border-amber-500/60 hover:bg-amber-500/15 disabled:cursor-wait disabled:opacity-50"
                  >
                    <RotateCcw size={12} aria-hidden />
                    {retrying ? 'Retrying…' : 'Retry now'}
                  </button>
                )}
              </div>
            </PropRow>
          )}
          <PropRow label="Last run">
            {issue.lastFiredAtMs ? formatRelativeTime(issue.lastFiredAtMs) : <span className="text-muted">never</span>}
          </PropRow>
          <PropRow label="Next run">
            {issue.nextDueAtMs ? formatRelativeTime(issue.nextDueAtMs) : <span className="text-muted">—</span>}
          </PropRow>
          </>
        )}
      </PropertySection>
      {error && <p className="mt-2 text-[11px] leading-snug text-red-400">{error}</p>}
    </aside>
  )
}

// ==================== Comment composer ====================

/**
 * Human comment composer. Comments are markdown, but persist in the structured
 * per-Issue JSON sidecar rather than the agent-editable What document.
 */
function CommentComposer({
  wsId,
  id,
  onPosted,
}: {
  wsId: string
  id: string
  onPosted: (next: IssueDetailData) => void
}) {
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = useCallback(async () => {
    const body = text.trim()
    if (!body || sending) return
    setSending(true)
    setError(null)
    try {
      const next = await issuesApi.addComment(wsId, id, body)
      onPosted(next)
      setText('')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSending(false)
    }
  }, [text, sending, wsId, id, onPosted])

  return (
    <section className="mt-8">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted/70">Add comment</h3>
      <textarea
        rows={3}
        value={text}
        disabled={sending}
        placeholder="Leave a comment…  (⌘↵ / Ctrl↵ to send)"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
            e.preventDefault()
            void submit()
          }
        }}
        className="w-full resize-y rounded-lg border border-border bg-bg px-3 py-2 text-[13px] text-text outline-none transition-colors focus:border-accent/60 focus:shadow-[0_0_0_1px_var(--color-accent-dim)] disabled:opacity-50"
      />
      {error && <p className="mt-1.5 text-xs text-red-400">{error}</p>}
      <div className="mt-2 flex justify-end">
        <button
          type="button"
          onClick={() => void submit()}
          disabled={sending || text.trim().length === 0}
          className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-bg transition-colors hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {sending ? 'Sending…' : 'Comment'}
        </button>
      </div>
    </section>
  )
}

// ==================== Canonical What editor ====================

function WhatEditor({
  value,
  scheduled,
  onSave,
}: {
  value: string
  scheduled: boolean
  onSave: (what: string) => Promise<boolean>
}) {
  return (
    <section className="mt-4 border-t border-border/60 pt-4">
      <div className="mb-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted/80">What</h2>
        <p className="mt-1 text-[11px] leading-snug text-muted/65">
          {scheduled ? 'This exact markdown is sent to the agent on every scheduled run.' : 'The canonical markdown definition of this work item.'}
        </p>
      </div>
      <MarkdownWhatEditor value={value} onSave={onSave} />
    </section>
  )
}

function IssueComments({ comments }: { comments: NonNullable<IssueDetailData['comments']> }) {
  if (comments.length === 0) return null
  return (
    <section className="mt-8">
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted/70">Comments</h2>
      <div className="space-y-3">
        {comments.map((comment) => (
          <article key={comment.id} className="rounded-lg border border-border bg-bg-secondary px-4 py-3">
            <div className="mb-2 flex items-center justify-between gap-3 text-[11px] text-muted">
              <span className="font-medium text-text/80">{comment.author}</span>
              <time dateTime={comment.at}>{new Date(comment.at).toLocaleString()}</time>
            </div>
            <MarkdownContent text={comment.markdown} />
          </article>
        ))}
      </div>
    </section>
  )
}

// ==================== Activity feed (headless runs) ====================

function RunRow({ run, onAsk }: { run: IssueRunRecord; onAsk: (run: IssueRunRecord) => void }) {
  const displayStatus = run.failure?.kind === 'system_paused' || run.failure?.kind === 'launcher_restarted'
    ? 'interrupted'
    : run.status
  return (
    <li className="rounded-lg border border-border bg-bg-secondary px-3 py-2.5">
      <div className="flex items-center gap-2">
        <span
          className={`inline-block rounded px-1.5 py-0.5 text-[11px] font-medium ${RUN_STATUS_STYLE[displayStatus]}`}
        >
          {displayStatus}
        </span>
        <span className="text-xs text-muted">{run.agent}</span>
        <span className="ml-auto text-xs text-muted" title={new Date(run.startedAt).toLocaleString()}>
          {formatRelativeTime(run.startedAt)}
        </span>
        <span className="text-xs text-muted/70">· {fmtDuration(run.durationMs)}</span>
        <button
          type="button"
          onClick={() => onAsk(run)}
          disabled={!run.resumable || run.status === 'running'}
          title={run.resumable ? 'Ask the Session behind this run' : 'This run did not capture a resumable Session'}
          className="rounded-md border border-border px-2 py-1 text-[11px] text-muted transition-colors hover:border-accent/50 hover:text-text disabled:cursor-not-allowed disabled:opacity-40"
        >
          Ask run
        </button>
      </div>
      {run.prompt && (
        <p className="mt-1.5 line-clamp-2 text-[12px] leading-snug text-text/80" title={run.prompt}>
          {run.prompt}
        </p>
      )}
      {run.output?.assistantPreview && (
        <p className="mt-1.5 line-clamp-2 border-l-2 border-accent/25 pl-2 text-[12px] leading-snug text-muted" title={run.output.assistantPreview}>
          {run.output.assistantPreview}
        </p>
      )}
      {run.output && (run.output.toolCalls > 0 || run.output.toolFailures > 0) && (
        <p className={`mt-1 text-[11px] ${run.output.toolFailures > 0 ? 'text-red-400' : 'text-muted/60'}`}>
          {run.output.toolCalls} tool {run.output.toolCalls === 1 ? 'call' : 'calls'}
          {run.output.toolFailures > 0 ? ` · ${run.output.toolFailures} failed` : ''}
        </p>
      )}
      {run.failure && (
        <div className={`mt-2 rounded-md border px-2.5 py-2 ${
          run.failure.kind === 'system_paused' || run.failure.kind === 'launcher_restarted'
            ? 'border-amber-500/25 bg-amber-500/10'
            : 'border-red-500/25 bg-red-500/10'
        }`}>
          <p className={`text-[12px] font-medium ${
            run.failure.kind === 'system_paused' || run.failure.kind === 'launcher_restarted'
              ? 'text-amber-400'
              : 'text-red-400'
          }`}>
            {run.failure.title}
          </p>
          <p className="mt-0.5 text-[11px] leading-snug text-muted">{run.failure.message}</p>
        </div>
      )}
      {run.error && <p className="mt-1 text-[12px] text-red-400">{run.error}</p>}
    </li>
  )
}

// ==================== Inbox reports (issue → inbox) ====================

/**
 * The inbox reports this issue produced — the issue→inbox direction of the
 * cross-link (each entry's server-stamped `origin.issueId` is this issue). The
 * run→issue direction is the unified Activity feed. Each row jumps to the Inbox,
 * selecting + marking-read that entry. Rendered only when there are reports
 * (the Activity feed already establishes the run history; an empty inbox list
 * would just be noise).
 */
function InboxReportsSection({
  reports,
  onOpen,
}: {
  reports: InboxEntry[]
  onOpen: (entryId: string) => void
}) {
  if (reports.length === 0) return null
  return (
    <section className="mt-8">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted/70">Inbox reports</h3>
      <ul className="space-y-2">
        {reports.map((entry) => (
          <li key={entry.id}>
            <button
              type="button"
              onClick={() => onOpen(entry.id)}
              title="Open in Inbox"
              className="group flex w-full items-center gap-2.5 rounded-lg border border-border bg-bg-secondary px-3 py-2.5 text-left transition-colors hover:border-accent/40 hover:bg-bg-tertiary"
            >
              <Inbox size={14} className="shrink-0 text-muted/70 transition-colors group-hover:text-accent" aria-hidden />
              <span className="min-w-0 flex-1 truncate text-[12px] text-text/80">
                {previewForEntry(entry) || '(empty push)'}
              </span>
              <span
                className="ml-auto shrink-0 text-xs text-muted"
                title={new Date(entry.ts).toLocaleString()}
              >
                {formatRelativeTime(entry.ts)}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}

// ==================== Issue activity (attribution + runs) ====================

const PROVENANCE_ACTION_LABEL: Record<IssueProvenanceRecord['action'], string> = {
  created: 'Created',
  updated: 'Updated',
  commented: 'Commented',
  sent: 'Sent',
  decided: 'Decided',
  reconstructed: 'Reconstructed',
}

function IssueActivity({
  activity,
  onContinue,
  onAskRun,
}: {
  activity: IssueActivityRecord[]
  onContinue: (record: IssueProvenanceRecord) => Promise<void>
  onAskRun: (run: IssueRunRecord) => void
}) {
  const [continuingId, setContinuingId] = useState<string | null>(null)
  const [continueError, setContinueError] = useState<string | null>(null)

  const continueSession = async (record: IssueProvenanceRecord) => {
    setContinuingId(record.id)
    setContinueError(null)
    try {
      await onContinue(record)
    } catch (err) {
      setContinueError(err instanceof Error ? err.message : String(err))
    } finally {
      setContinuingId(null)
    }
  }

  return (
    <section className="mt-8">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted/70">Activity</h3>
      {activity.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-4 py-4 text-center text-xs text-muted">
          No activity has been recorded for this issue yet.
        </p>
      ) : (
        <ul className="space-y-2">
          {activity.map((item) => {
            if (item.kind === 'run') {
              return <RunRow key={`run:${item.run.taskId}`} run={item.run} onAsk={onAskRun} />
            }
            const record = item
            const origin = record.origin
            const isSession = origin.kind === 'session'
            const originLabel = isSession
              ? `${origin.agent} · ${origin.resumeId}`
              : origin.kind === 'human'
                ? 'Human'
                : origin.kind === 'external'
                  ? `External · ${origin.system}`
                  : `Unknown · ${origin.reason}`
            return (
              <li key={`provenance:${record.id}`} className="flex items-center gap-2.5 rounded-lg border border-border bg-bg-secondary px-3 py-2.5">
                <History size={14} className="shrink-0 text-muted/70" aria-hidden />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-text">{PROVENANCE_ACTION_LABEL[record.action]}</span>
                    <span className="text-xs text-muted" title={new Date(record.at).toLocaleString()}>
                      {formatRelativeTime(record.at)}
                    </span>
                  </div>
                  <p className="mt-0.5 truncate font-mono text-[11px] text-muted" title={originLabel}>
                    {originLabel}
                  </p>
                </div>
                {isSession && (
                  <button
                    type="button"
                    onClick={() => void continueSession(record)}
                    disabled={continuingId !== null}
                    className="shrink-0 rounded-md border border-border px-2 py-1 text-[11px] text-muted transition-colors hover:border-accent/50 hover:text-text disabled:cursor-wait disabled:opacity-50"
                  >
                    {continuingId === record.id ? 'Opening…' : 'Continue'}
                  </button>
                )}
              </li>
            )
          })}
        </ul>
      )}
      {continueError && <p className="mt-2 text-xs text-red-400">Could not continue Session: {continueError}</p>}
    </section>
  )
}

// ==================== Wikilink disambiguation picker ====================

/**
 * Inline picker shown when a `[[name]]` in the body resolves to MORE THAN ONE
 * target (entity + issue(s), or the same name claimed by issues in >1
 * workspace). A name is a global handle, so the click can't pick for the user —
 * this enumerates the candidates by workspace (the "wsId-precise" affordance).
 * A unique token never reaches here (the handler navigates straight through).
 */
function WikilinkPicker({
  resolution,
  onClose,
  onEntity,
  onIssue,
}: {
  resolution: WikilinkResolution
  onClose: () => void
  onEntity: (name: string) => void
  onIssue: (ref: WikilinkIssueRef) => void
}) {
  const EntityIcon = resolution.entity?.type === 'asset' ? TrendingUp : Hash
  return (
    <div
      role="presentation"
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm rounded-lg border border-border bg-bg-secondary p-4 shadow-xl"
      >
        <div className="mb-1 flex items-start justify-between gap-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted/70">
            <span className="font-mono normal-case text-text">[[{resolution.name}]]</span> matches several
          </h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="-mr-1 -mt-0.5 shrink-0 rounded p-0.5 text-muted transition-colors hover:text-text"
          >
            <X size={14} />
          </button>
        </div>
        <p className="mb-3 text-[12px] leading-snug text-muted">
          This name is a global handle pointing at more than one thing — pick the one you meant.
        </p>
        <ul className="space-y-1.5">
          {resolution.entity && (
            <li>
              <button
                type="button"
                onClick={() => onEntity(resolution.entity!.name)}
                title={`Open tracked entity ${resolution.entity.name}`}
                className="group flex w-full items-center gap-2.5 rounded-lg border border-border bg-bg-tertiary/30 px-3 py-2 text-left transition-colors hover:border-accent/40 hover:bg-bg-tertiary"
              >
                <EntityIcon size={14} className="shrink-0 text-muted/70 transition-colors group-hover:text-accent" aria-hidden />
                <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-text">
                  {resolution.entity.name}
                </span>
                <span className="shrink-0 rounded-full bg-bg-tertiary px-2 py-0.5 text-[11px] uppercase tracking-wide text-muted">
                  {resolution.entity.type}
                </span>
              </button>
            </li>
          )}
          {resolution.issues.map((iss) => (
            <li key={`${iss.wsId}:${iss.id}`}>
              <button
                type="button"
                onClick={() => onIssue(iss)}
                title={`Open ${iss.id} in ${iss.wsTag}`}
                className="group flex w-full items-center gap-2.5 rounded-lg border border-border bg-bg-tertiary/30 px-3 py-2 text-left transition-colors hover:border-accent/40 hover:bg-bg-tertiary"
              >
                <ListChecks size={14} className="shrink-0 text-muted/70 transition-colors group-hover:text-accent" aria-hidden />
                <span className="min-w-0 flex-1 truncate text-[12px] text-text">{iss.title}</span>
                <span
                  className="shrink-0 rounded-full bg-bg-tertiary px-2 py-0.5 text-[11px] text-muted"
                  title={`Workspace: ${iss.wsTag} (${iss.wsId.slice(0, 8)})`}
                >
                  {iss.wsTag}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

// ==================== Detail view ====================

/**
 * Linear-style issue detail (Phase 2b — interactive). Main column = title +
 * editable canonical What + structured markdown comments +
 * Activity feed + a comment composer. Right rail = Properties, with status /
 * priority / assignee editable inline (each write PATCHes and applies the
 * server-returned detail — authoritative, refetch-free). The scheduled agent
 * runtime is editable because it is operational routing; schedule cadence and
 * fire prompt remain file-owned frontmatter.
 */
interface IssueDetailProps {
  wsId: string
  id: string
  backLabel?: string
  onBack?: () => void
  onOpenIssue?: (ref: WikilinkIssueRef) => void
}

type IssueInquiryTarget =
  | { relation: 'creator' }
  | { relation: 'owner' }
  | { relation: 'run'; runId: string }

export function IssueDetail({
  wsId,
  id,
  backLabel = 'Issues',
  onBack,
  onOpenIssue,
}: IssueDetailProps) {
  const { data, error, loading, mutate } = useIssueDetail(wsId, id)
  const { agents, defaultAgent, issueDefaultAgent, openAgentConfig, openHeadlessRun, workspaces } = useWorkspaces()
  const openOrFocus = useWorkspace((s) => s.openOrFocus)
  const setSidebar = useWorkspace((s) => s.setSidebar)
  const selectInboxEntry = useInboxSelection((s) => s.select)
  const markInboxRead = useInboxRead((s) => s.markRead)
  // Reuse the canonical `[[name]]` navigation (jump to Tracked + select the
  // entity) — see live/wikilink. We only override the click to first RESOLVE
  // the token across both namespaces (entity + issues).
  const gotoEntity = useWikilinkHandler()

  const [saving, setSaving] = useState(false)
  const [retrying, setRetrying] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [agentReadiness, setAgentReadiness] = useState<Record<string, AgentCredentialReadiness>>({})
  const [sessionDirectory, setSessionDirectory] = useState<readonly WorkspaceSessionDirectoryEntry[]>([])
  const [inquiryTarget, setInquiryTarget] = useState<IssueInquiryTarget>({ relation: 'creator' })
  // Set when a clicked `[[name]]` resolves to >1 target — drives the picker.
  const [picker, setPicker] = useState<WikilinkResolution | null>(null)

  useEffect(() => {
    let live = true
    getAgentReadiness(wsId)
      .then((bundle) => {
        if (live) setAgentReadiness(bundle.agents)
      })
      .catch(() => {
        if (live) setAgentReadiness({})
      })
    return () => { live = false }
  }, [wsId])

  useEffect(() => {
    setInquiryTarget({ relation: 'creator' })
  }, [wsId, id])

  useEffect(() => {
    let live = true
    getWorkspaceSessionDirectory(wsId)
      .then((directory) => {
        if (live) setSessionDirectory(Array.isArray(directory.sessions) ? directory.sessions : [])
      })
      .catch(() => {
        if (live) setSessionDirectory([])
      })
    return () => { live = false }
  }, [wsId])

  const gotoIssue = useCallback(
    (ref: WikilinkIssueRef) => {
      if (onOpenIssue) {
        onOpenIssue(ref)
        return
      }
      setSidebar('issue')
      openOrFocus({ kind: 'issue-detail', params: { wsId: ref.wsId, id: ref.id } })
    },
    [onOpenIssue, openOrFocus, setSidebar],
  )

  // Open the Inbox at a specific entry (the issue→inbox cross-link). Mirrors the
  // sidebar's select-and-read, then surfaces the Inbox tab + sidebar.
  const gotoInbox = useCallback(
    (entryId: string) => {
      selectInboxEntry(entryId)
      markInboxRead(entryId)
      setSidebar('inbox')
      openOrFocus({ kind: 'inbox', params: {} })
    },
    [selectInboxEntry, markInboxRead, setSidebar, openOrFocus],
  )

  const continueProvenanceSession = useCallback(
    async (record: IssueProvenanceRecord) => {
      if (record.origin.kind !== 'session') return
      setSidebar('workspaces')
      await openHeadlessRun(record.origin.workspaceId, record.origin.resumeId, {
        title: `${data?.issue.title ?? id} · ${record.action}`,
      })
    },
    [data?.issue.title, id, openHeadlessRun, setSidebar],
  )

  // Clicking a `[[name]]` in the body resolves it across BOTH namespaces. A
  // unique target navigates straight through (entity → Tracked, issue →
  // wsId-precise detail); a collision opens the disambiguation picker. The key
  // arrives lowercased from MarkdownContent (entity keys + the resolver match
  // are both case-insensitive). On resolver failure we fall back to the
  // default Tracked jump.
  const onWikilink = useCallback(
    async (key: string) => {
      try {
        const res = await issuesApi.resolveWikilink(key)
        const count = (res.entity ? 1 : 0) + res.issues.length
        if (count > 1) {
          setPicker(res)
        } else if (res.entity) {
          gotoEntity(res.entity.name)
        } else if (res.issues[0]) {
          gotoIssue(res.issues[0])
        } else {
          gotoEntity(key) // nothing resolved — preserve prior behaviour
        }
      } catch {
        gotoEntity(key)
      }
    },
    [gotoEntity, gotoIssue],
  )

  const workspace = workspaces.find((w) => w.id === wsId) ?? null
  const agentOptions = agents.filter(
    (agent) =>
      agent.kind !== 'utility' &&
      (workspace ? workspace.agents.includes(agent.id) : true),
  )

  const onPatch = useCallback(
    async (patch: { status?: IssueStatus; priority?: IssuePriority; assignee?: string; agent?: string | null; what?: string }): Promise<boolean> => {
      setSaving(true)
      setActionError(null)
      try {
        const next = await issuesApi.update(wsId, id, patch)
        mutate(next)
        return true
      } catch (e) {
        // The selects are bound to the (unchanged) server data, so they revert
        // on their own; we just surface why.
        setActionError(e instanceof Error ? e.message : String(e))
        return false
      } finally {
        setSaving(false)
      }
    },
    [wsId, id, mutate],
  )

  const onRetry = useCallback(async () => {
    if (retrying) return
    setRetrying(true)
    setActionError(null)
    try {
      mutate(await issuesApi.retry(wsId, id))
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e))
    } finally {
      setRetrying(false)
    }
  }, [retrying, wsId, id, mutate])

  const loadInquiries = useCallback(
    () => inquiriesApi.forIssue(wsId, id),
    [wsId, id],
  )

  const askIssue = useCallback(
    (prompt: string) => inquiriesApi.askIssue(wsId, id, {
      prompt,
      relation: inquiryTarget.relation,
      ...(inquiryTarget.relation === 'run' ? { runId: inquiryTarget.runId } : {}),
    }),
    [wsId, id, inquiryTarget],
  )

  const backToBoard = (
    <button
      type="button"
      onClick={() => {
        if (onBack) {
          onBack()
          return
        }
        setSidebar('issue')
        openOrFocus({ kind: 'issue', params: {} })
      }}
      className="mb-4 inline-flex items-center gap-1.5 text-xs text-muted transition-colors hover:text-text"
    >
      <ArrowLeft size={13} /> {backLabel}
    </button>
  )

  const stableOwnerResumeId = data?.issue.assignee.startsWith('@resume-')
    ? data.issue.assignee.slice(1)
    : null

  useEffect(() => {
    if (inquiryTarget.relation === 'owner' && !stableOwnerResumeId) {
      setInquiryTarget({ relation: 'creator' })
    }
  }, [stableOwnerResumeId, inquiryTarget.relation])

  if (!data) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-5 md:px-6">
        {backToBoard}
        {loading ? (
          <CenteredLoading />
        ) : (
          <div className="rounded-lg border border-border bg-bg-secondary px-6 py-12 text-center">
            <ListChecks size={24} className="mx-auto text-muted/50" />
            <p className="mt-3 text-sm text-red-400">Failed to load issue: {error}</p>
            <p className="mt-1 font-mono text-xs text-muted/70">
              {wsId.slice(0, 8)} / {id}
            </p>
          </div>
        )}
      </div>
    )
  }

  const { issue, runs } = data
  const latestRun = runs[0]
  const canRetry = Boolean(
    issue.when
    && latestRun?.failure?.retryable
    && (latestRun.status === 'failed' || latestRun.status === 'interrupted'),
  )
  const comments = data.comments ?? []
  const inboxReports = data.inboxReports ?? []
  const provenance = data.provenance ?? []
  const activity = data.activity ?? [
    ...provenance.map((record) => ({ ...record, kind: 'change' as const })),
    ...runs.map((run) => ({ kind: 'run' as const, id: run.taskId, at: run.startedAt, run })),
  ].sort((a, b) => b.at - a.at)
  const inquiryDescription = inquiryTarget.relation === 'owner'
    ? 'Continue the Session assigned to this Issue.'
    : inquiryTarget.relation === 'run'
      ? `Continue the exact Session behind run ${inquiryTarget.runId}.`
      : 'Ask the attributable creator why this Issue exists. Legacy human-created Issues may require Workspace reconstruction.'

  return (
    <div className="mx-auto max-w-4xl px-4 py-5 md:px-6">
      {backToBoard}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem] lg:items-start">
        <main className="min-w-0 lg:col-start-1 lg:row-start-1">
          <div className="mb-1 flex items-center gap-2">
            <span className="font-mono text-[11px] text-muted/70">{id}</span>
            {issue.when && <CadencePill when={issue.when} />}
          </div>
          <h1 className="text-xl font-semibold text-text">{issue.title}</h1>
          <WhatEditor
            key={`${wsId}:${id}`}
            value={issue.what}
            scheduled={Boolean(issue.when)}
            onSave={(what) => onPatch({ what })}
          />
          <InquiryPanel
            title="Ask about this Issue"
            description={inquiryDescription}
            actionLabel={inquiryTarget.relation === 'owner' ? 'Ask owner' : inquiryTarget.relation === 'run' ? 'Ask run' : 'Ask creator'}
            placeholder="What do you want to clarify?"
            load={loadInquiries}
            ask={askIssue}
            controls={(
              <div className="inline-flex rounded-lg border border-border bg-bg p-1 text-[11px]">
                <button
                  type="button"
                  onClick={() => setInquiryTarget({ relation: 'creator' })}
                  className={`rounded-md px-2 py-1 transition-colors ${inquiryTarget.relation === 'creator' ? 'bg-bg-tertiary text-text' : 'text-muted hover:text-text'}`}
                >
                  Creator
                </button>
                {stableOwnerResumeId && (
                  <button
                    type="button"
                    onClick={() => setInquiryTarget({ relation: 'owner' })}
                    className={`rounded-md px-2 py-1 transition-colors ${inquiryTarget.relation === 'owner' ? 'bg-bg-tertiary text-text' : 'text-muted hover:text-text'}`}
                  >
                    Owner
                  </button>
                )}
                {inquiryTarget.relation === 'run' && (
                  <button type="button" className="rounded-md bg-bg-tertiary px-2 py-1 text-text">
                    Run {inquiryTarget.runId}
                  </button>
                )}
              </div>
            )}
          />
          <IssueComments comments={comments} />
          <CommentComposer wsId={wsId} id={id} onPosted={mutate} />
        </main>
        <PropertiesRail
          issue={issue}
          agentOptions={agentOptions}
          issueDefaultAgent={issueDefaultAgent}
          defaultAgent={defaultAgent}
          agentReadiness={agentReadiness}
          sessions={sessionDirectory}
          saving={saving}
          retrying={retrying}
          error={actionError}
          canRetry={canRetry}
          onPatch={onPatch}
          onRetry={() => void onRetry()}
          onConfigureAgent={(agent) => openAgentConfig(wsId, agent)}
        />
        <div className="min-w-0 lg:col-start-1 lg:row-start-2">
          <IssueActivity
            activity={activity}
            onContinue={continueProvenanceSession}
            onAskRun={(run) => {
              setInquiryTarget({ relation: 'run', runId: run.taskId })
              window.requestAnimationFrame(() => document.getElementById('inquiries')?.scrollIntoView({ behavior: 'smooth', block: 'center' }))
            }}
          />
          <InboxReportsSection reports={inboxReports} onOpen={gotoInbox} />
        </div>
      </div>
      {picker && (
        <WikilinkPicker
          resolution={picker}
          onClose={() => setPicker(null)}
          onEntity={(name) => {
            setPicker(null)
            gotoEntity(name)
          }}
          onIssue={(ref) => {
            setPicker(null)
            gotoIssue(ref)
          }}
        />
      )}
    </div>
  )
}
