import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { ArrowLeft, History, Inbox, ListChecks, MessageSquare, RotateCcw, Settings } from 'lucide-react'

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
} from '../api/issues'
import {
  getAgentReadiness,
  getWorkspaceSessionDirectory,
  type AgentCredentialReadiness,
  type AgentId,
  type WorkspaceSessionDirectoryEntry,
} from './workspace/api'
import { issuesApi } from '../api/issues'
import { useIssueDetail } from '../hooks/useIssueDetail'
import { useWorkspaces } from '../contexts/workspaces-context'
import { formatRelativeTime } from '../lib/intl'
import { useInboxRead } from '../live/inbox-read'
import { useInboxSelection } from '../live/inbox-selection'
import { previewForEntry } from '../live/inbox-threads'
import { useWorkspace } from '../tabs/store'
import { AutomationHealthPill, CadencePill, PriorityIndicator } from './IssuesBoard'
import { STATUS_META } from './issue-status-meta'
import { MarkdownContent } from './MarkdownContent'
import { MarkdownWhatEditor } from './MarkdownWhatEditor'
import { CenteredLoading } from './StateViews'

// Run-status pill tints — mirrors AutomationRunsSection's STATUS_STYLE so the
// Issue's independent operational history stays consistent with Automation.
const RUN_STATUS_STYLE: Record<HeadlessTaskStatus, string> = {
  running: 'bg-[var(--color-issue-detail-info-bg-subtle)] text-[var(--color-issue-detail-info-text)]',
  done: 'bg-[var(--color-issue-detail-success-bg-subtle)] text-[var(--color-issue-detail-success-text)]',
  failed: 'bg-[var(--color-issue-detail-danger-bg-subtle-alpha-15)] text-[var(--color-issue-detail-danger-text)]',
  interrupted: 'bg-[var(--color-issue-detail-warning-bg-subtle-alpha-15)] text-[var(--color-issue-detail-warning-text)]',
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
      {scheduled && <option value="@new">New Session · assign after first run</option>}
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
    <aside className="min-w-0 w-full shrink-0 space-y-3 lg:col-start-2 lg:row-start-1 lg:row-span-2">
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
            <p className="py-2 text-right text-[11px] leading-snug text-[var(--color-issue-detail-warning-text)]">AI credential missing.</p>
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
                    className="oa-pressable mt-1 inline-flex items-center gap-1.5 rounded-md border border-[var(--color-issue-detail-warning-border-subtle-alpha-30)] bg-[var(--color-issue-detail-warning-bg-subtle-alpha-10)] px-2.5 py-1.5 text-[11px] font-medium text-[var(--color-issue-detail-warning-text)] transition-colors hover:border-[var(--color-issue-detail-warning-border-subtle-alpha-60)] hover:bg-[var(--color-issue-detail-warning-bg-subtle-alpha-15)] disabled:cursor-wait disabled:opacity-50"
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
      {error && <p className="mt-2 text-[11px] leading-snug text-[var(--color-issue-detail-danger-text)]">{error}</p>}
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
  ownerResumeId,
  assignee,
  onPosted,
}: {
  wsId: string
  id: string
  ownerResumeId: string | null
  assignee: string
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
    <div className="rounded-xl border border-border bg-bg px-3 py-3 shadow-sm transition-colors focus-within:border-accent/45">
      <textarea
        rows={3}
        value={text}
        disabled={sending}
        placeholder={ownerResumeId ? `Comment to @${ownerResumeId}…` : 'Leave a comment…'}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
            e.preventDefault()
            void submit()
          }
        }}
        className="min-h-20 w-full resize-y bg-[var(--color-issue-detail-neutral-dark-bg)] px-1 py-1 text-[13px] leading-relaxed text-text outline-none placeholder:text-muted/60 disabled:opacity-50"
      />
      {error && <p className="mt-1.5 text-xs text-[var(--color-issue-detail-danger-text)]">{error}</p>}
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-border/60 pt-2">
        <p className="min-w-0 flex-1 basis-full break-words text-[11px] leading-snug text-muted sm:basis-auto">
          {ownerResumeId
            ? <>The assigned Session <span className="font-mono text-text/75">@{ownerResumeId}</span> will reply here.</>
            : assignee === '@new'
              ? 'The first scheduled run will assign a Session; until then this is a timeline note.'
              : 'No fixed Session owner — this comment is recorded as a timeline note.'}
        </p>
        <button
          type="button"
          onClick={() => void submit()}
          disabled={sending || text.trim().length === 0}
          className="oa-pressable rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-bg transition-colors hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {sending ? 'Sending…' : ownerResumeId ? 'Comment & notify' : 'Comment'}
        </button>
      </div>
    </div>
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

// ==================== Run history ====================

function RunRow({ run, onOpen }: { run: IssueRunRecord; onOpen: (run: IssueRunRecord) => void }) {
  const displayStatus = run.failure?.kind === 'system_paused' || run.failure?.kind === 'launcher_restarted'
    ? 'interrupted'
    : run.status
  return (
    <li className="min-w-0 overflow-hidden rounded-lg border border-border bg-bg-secondary px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-2">
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
          onClick={() => onOpen(run)}
          disabled={!run.resumable || run.status === 'running'}
          title={run.resumable ? 'Open the Session behind this run' : 'This run did not capture a resumable Session'}
          className="rounded-md border border-border px-2 py-1 text-[11px] text-muted transition-colors hover:border-accent/50 hover:text-text disabled:cursor-not-allowed disabled:opacity-40"
        >
          Open conversation
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
        <p className={`mt-1 text-[11px] ${run.output.toolFailures > 0 ? 'text-[var(--color-issue-detail-danger-text)]' : 'text-muted/60'}`}>
          {run.output.toolCalls} tool {run.output.toolCalls === 1 ? 'call' : 'calls'}
          {run.output.toolFailures > 0 ? ` · ${run.output.toolFailures} failed` : ''}
        </p>
      )}
      {run.failure && (
        <div className={`mt-2 rounded-md border px-2.5 py-2 ${
          run.failure.kind === 'system_paused' || run.failure.kind === 'launcher_restarted'
            ? 'border-[var(--color-issue-detail-warning-border-subtle-alpha-25)] bg-[var(--color-issue-detail-warning-bg-subtle-alpha-10)]'
            : 'border-[var(--color-issue-detail-danger-border-subtle)] bg-[var(--color-issue-detail-danger-bg-subtle-alpha-10)]'
        }`}>
          <p className={`text-[12px] font-medium ${
            run.failure.kind === 'system_paused' || run.failure.kind === 'launcher_restarted'
              ? 'text-[var(--color-issue-detail-warning-text)]'
              : 'text-[var(--color-issue-detail-danger-text)]'
          }`}>
            {run.failure.title}
          </p>
          <p className="mt-0.5 text-[11px] leading-snug text-muted">{run.failure.message}</p>
        </div>
      )}
      {run.error && <p className="mt-1 text-[12px] text-[var(--color-issue-detail-danger-text)]">{run.error}</p>}
    </li>
  )
}

// ==================== Inbox reports (issue → inbox) ====================

/**
 * The inbox reports this issue produced — the issue→inbox direction of the
 * cross-link (each entry's server-stamped `origin.issueId` is this issue).
 * Each row jumps to the Inbox, selecting + marking-read that entry. Rendered
 * only when there are reports; an empty report list would just be noise beside
 * the independent collaboration Activity and operational Runs sections.
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

// ==================== Issue activity (changes + comments) ====================

const PROVENANCE_ACTION_LABEL: Record<IssueProvenanceRecord['action'], string> = {
  created: 'created the Issue',
  updated: 'updated the Issue',
  commented: 'commented',
  sent: 'sent the Issue',
  decided: 'recorded a decision',
  reconstructed: 'reconstructed the Issue context',
}

const MUTATION_FIELD_LABEL: Record<string, string> = {
  title: 'Title',
  status: 'Status',
  priority: 'Priority',
  assignee: 'Assignee',
  schedule: 'Schedule',
  runtime: 'Runtime',
  what: 'What',
}

function unknownOriginLabel(reason: string): string {
  if (reason === 'direct-file-edit') return 'Direct file edit'
  if (reason === 'concurrent-workspace-edit') return 'Concurrent Workspace edit · author unknown'
  return `Unknown · ${reason.replaceAll('-', ' ')}`
}

function mutationValue(field: string, value: string): string {
  if (field === 'assignee') {
    if (value === '@new') return 'New Session, then keep owner'
    if (value === '@workspace') return 'New Session each run'
    if (value === '@human') return 'Human'
    if (value === '@unassigned') return 'Unassigned'
  }
  if (field === 'status' || field === 'priority') return value.replaceAll('_', ' ')
  if (field === 'schedule') {
    try {
      const schedule = JSON.parse(value) as { kind?: string; at?: string; every?: string; cron?: string; timezone?: string }
      if (schedule.kind === 'at') return `Once · ${schedule.at}`
      if (schedule.kind === 'every') return `Every ${schedule.every}`
      if (schedule.kind === 'cron') return `${schedule.cron}${schedule.timezone ? ` · ${schedule.timezone}` : ''}`
    } catch {
      // Older audit rows can still carry a hand-written value; show it safely.
    }
  }
  return value
}

function mutationSummary(change: { field: string; before?: string; after?: string }): string {
  const label = MUTATION_FIELD_LABEL[change.field] ?? change.field
  if (change.before === undefined && change.after === undefined) return `edited ${label}`
  if (change.before === undefined) return `set ${label} to ${mutationValue(change.field, change.after!)}`
  if (change.after === undefined) return `cleared ${label}`
  return `changed ${label} from ${mutationValue(change.field, change.before)} to ${mutationValue(change.field, change.after)}`
}

function IssueActivity({
  activity,
  onContinue,
  wsId,
  issueId,
  ownerResumeId,
  assignee,
  onPosted,
}: {
  activity: IssueActivityRecord[]
  onContinue: (record: IssueProvenanceRecord) => Promise<void>
  wsId: string
  issueId: string
  ownerResumeId: string | null
  assignee: string
  onPosted: (next: IssueDetailData) => void
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
      <div className="mb-3 flex items-baseline justify-between gap-3 border-t border-border/60 pt-5">
        <h2 className="text-sm font-semibold text-text">Activity</h2>
        <span className="hidden text-[11px] text-muted sm:inline">Changes and conversation</span>
      </div>
      {activity.length === 0 ? (
        <p className="mb-3 rounded-lg border border-dashed border-border px-4 py-4 text-center text-xs text-muted">
          No changes or comments have been recorded yet.
        </p>
      ) : (
        <ul className="relative mb-4 space-y-3 before:absolute before:bottom-3 before:left-[11px] before:top-3 before:w-px before:bg-border">
          {activity.map((item) => {
            if (item.kind === 'comment') {
              const { comment } = item
              const delivery = comment.delivery
              return (
                <li key={`comment:${comment.id}`} className="relative pl-8">
                  <span className="absolute left-[3px] top-3 z-10 grid h-[18px] w-[18px] place-items-center rounded-full border border-border bg-bg text-accent">
                    <MessageSquare size={10} aria-hidden />
                  </span>
                  <article className={`rounded-xl border bg-bg-secondary px-4 py-3 ${comment.replyTo ? 'ml-3 border-accent/25' : 'border-border'}`}>
                    <div className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted">
                      <span className="font-medium text-text/85">{comment.author}</span>
                      {comment.replyTo && <span className="rounded bg-bg-tertiary px-1.5 py-0.5">reply</span>}
                      <time className="ml-auto" dateTime={comment.at} title={new Date(comment.at).toLocaleString()}>
                        {formatRelativeTime(item.at)}
                      </time>
                    </div>
                    <MarkdownContent text={comment.markdown} />
                    {delivery?.state === 'pending' && (
                      <p className="mt-3 border-t border-border/60 pt-2 text-[11px] text-muted">
                        Waiting for <span className="font-mono text-text/75">@{delivery.targetResumeId}</span> to reply…
                      </p>
                    )}
                    {delivery?.state === 'failed' && (
                      <p className="mt-3 rounded-md border border-[var(--color-issue-detail-warning-border-subtle-alpha-25)] bg-[var(--color-issue-detail-warning-bg-subtle-alpha-10)] px-2.5 py-2 text-[11px] leading-snug text-[var(--color-issue-detail-warning-text)]">
                        The comment is saved, but the owner could not be reached: {delivery.error}
                      </p>
                    )}
                  </article>
                </li>
              )
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
                  : unknownOriginLabel(origin.reason)
            return (
              <li key={`provenance:${record.id}`} className="relative flex min-w-0 items-start gap-2.5 py-1 pl-8">
                <span className="absolute left-[3px] top-2 z-10 grid h-[18px] w-[18px] place-items-center rounded-full border border-border bg-bg text-muted">
                  <History size={10} aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[12px] text-muted">
                    <span className="font-medium text-text/80">{originLabel}</span>{' '}
                    {PROVENANCE_ACTION_LABEL[record.action]} ·{' '}
                    <span title={new Date(record.at).toLocaleString()}>{formatRelativeTime(record.at)}</span>
                  </p>
                  {record.mutation && (
                    <ul className="mt-1 space-y-0.5 text-[11px] leading-relaxed text-muted/80">
                      {record.mutation.fields.map((change) => (
                        <li key={change.field}>{mutationSummary(change)}</li>
                      ))}
                    </ul>
                  )}
                </div>
                {isSession && (
                  <button
                    type="button"
                    onClick={() => void continueSession(record)}
                    disabled={continuingId !== null}
                    className="oa-pressable shrink-0 rounded-md border border-border px-2 py-1 text-[11px] text-muted transition-colors hover:border-accent/50 hover:text-text disabled:cursor-wait disabled:opacity-50"
                  >
                    {continuingId === record.id ? 'Opening…' : 'Continue'}
                  </button>
                )}
              </li>
            )
          })}
        </ul>
      )}
      {continueError && <p className="mt-2 text-xs text-[var(--color-issue-detail-danger-text)]">Could not continue Session: {continueError}</p>}
      <CommentComposer
        wsId={wsId}
        id={issueId}
        ownerResumeId={ownerResumeId}
        assignee={assignee}
        onPosted={onPosted}
      />
    </section>
  )
}

function RunsSection({
  runs,
  onOpen,
}: {
  runs: IssueRunRecord[]
  onOpen: (run: IssueRunRecord) => void
}) {
  const [expanded, setExpanded] = useState(false)
  if (runs.length === 0) return null
  const visible = expanded ? runs : runs.slice(0, 4)
  return (
    <section className="mt-8 rounded-xl border border-border bg-bg-secondary/45 px-3 py-3 sm:px-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-text">Runs</h2>
          <p className="mt-0.5 text-[11px] text-muted">Operational execution history</p>
        </div>
        <span className="rounded-full bg-bg-tertiary px-2 py-0.5 text-[11px] text-muted">{runs.length}</span>
      </div>
      <ul className="space-y-2">
        {visible.map((run) => <RunRow key={run.taskId} run={run} onOpen={onOpen} />)}
      </ul>
      {runs.length > 4 && (
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="oa-pressable mt-3 w-full rounded-md px-3 py-2 text-xs text-muted transition-colors hover:bg-bg-tertiary hover:text-text"
        >
          {expanded ? 'Show recent runs' : `Show ${runs.length - 4} more runs`}
        </button>
      )}
    </section>
  )
}

// ==================== Detail view ====================

/**
 * Linear-style issue detail (Phase 2b — interactive). Main column = title +
 * editable canonical What + a Linear-style Activity timeline where comments
 * and changes share one flow. Runs stay in an independent operational section.
 * Right rail = Properties, with status /
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
}

export function IssueDetail({
  wsId,
  id,
  backLabel = 'Issues',
  onBack,
}: IssueDetailProps) {
  const { data, error, loading, mutate } = useIssueDetail(wsId, id)
  const { agents, defaultAgent, issueDefaultAgent, openAgentConfig, openHeadlessRun, workspaces } = useWorkspaces()
  const openOrFocus = useWorkspace((s) => s.openOrFocus)
  const setSidebar = useWorkspace((s) => s.setSidebar)
  const selectInboxEntry = useInboxSelection((s) => s.select)
  const markInboxRead = useInboxRead((s) => s.markRead)


  const [saving, setSaving] = useState(false)
  const [retrying, setRetrying] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [agentReadiness, setAgentReadiness] = useState<Record<string, AgentCredentialReadiness>>({})
  const [sessionDirectory, setSessionDirectory] = useState<readonly WorkspaceSessionDirectoryEntry[]>([])

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
      setSidebar('chat')
      await openHeadlessRun(record.origin.workspaceId, record.origin.resumeId, {
        title: `${data?.issue.title ?? id} · ${record.action}`,
      })
    },
    [data?.issue.title, id, openHeadlessRun, setSidebar],
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

  if (!data) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-5 md:px-6">
        {backToBoard}
        {loading ? (
          <CenteredLoading />
        ) : (
          <div className="rounded-lg border border-border bg-bg-secondary px-6 py-12 text-center">
            <ListChecks size={24} className="mx-auto text-muted/50" />
            <p className="mt-3 text-sm text-[var(--color-issue-detail-danger-text)]">Failed to load issue: {error}</p>
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
    ...provenance
      .filter((record) => record.action !== 'commented')
      .map((record) => ({ ...record, kind: 'change' as const })),
    ...comments.map((comment) => ({
      kind: 'comment' as const,
      id: comment.id,
      at: Date.parse(comment.at),
      comment,
    })),
  ].filter((record) => Number.isFinite(record.at)).sort((a, b) => a.at - b.at)
  return (
    <div className="mx-auto max-w-4xl px-4 py-5 md:px-6">
      {backToBoard}
      <div className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,1fr)_18rem] lg:items-start">
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
          <IssueActivity
            activity={activity}
            onContinue={continueProvenanceSession}
            wsId={wsId}
            issueId={id}
            ownerResumeId={stableOwnerResumeId}
            assignee={issue.assignee}
            onPosted={mutate}
          />
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
          <RunsSection
            runs={runs}
            onOpen={(run) => {
              setSidebar('chat')
              void openHeadlessRun(run.wsId, run.resumeId, {
                title: `${issue.title} · ${run.agent}`,
              })
            }}
          />
          <InboxReportsSection reports={inboxReports} onOpen={gotoInbox} />
        </div>
      </div>

    </div>
  )
}
