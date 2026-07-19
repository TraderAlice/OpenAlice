import { useState } from 'react'
import {
  Bot,
  ChevronDown,
  ChevronRight,
  Clock,
  Copy,
  ListChecks,
} from 'lucide-react'

import type {
  IssueAutomationHealth,
  IssueAutomationHealthState,
  IssueListItem,
  IssuePriority,
  IssueStatus,
  IssueWorkspace,
} from '../api/issues'
import type { ScheduleWhen } from '../api/schedule'
import { useIssues } from '../hooks/useIssues'
import { useWorkspaces } from '../contexts/workspaces-context'
import { formatRelativeTime } from '../lib/intl'
import { useWorkspace } from '../tabs/store'
import { CenteredLoading } from './StateViews'
import { STATUS_META } from './issue-status-meta'

// ==================== Cadence pill (lifted from AutomationSchedulesSection) ====================

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function two(n: number): string {
  return String(n).padStart(2, '0')
}

function cronInt(field: string, min: number, max: number): number | null {
  if (!/^\d+$/.test(field)) return null
  const n = Number(field)
  return n >= min && n <= max ? n : null
}

function cronDayPhrase(field: string): string | null {
  if (field === '*') return 'day'
  if (field === '1-5') return 'weekday'
  if (field === '0,6' || field === '6,0') return 'weekend'
  const out: string[] = []
  for (const part of field.split(',')) {
    const range = part.match(/^(\d+)-(\d+)$/)
    if (range) {
      const start = cronInt(range[1], 0, 7)
      const end = cronInt(range[2], 0, 7)
      if (start === null || end === null || start > end) return null
      out.push(`${WEEKDAYS[start === 7 ? 0 : start]}-${WEEKDAYS[end === 7 ? 0 : end]}`)
      continue
    }
    const n = cronInt(part, 0, 7)
    if (n === null) return null
    out.push(WEEKDAYS[n === 7 ? 0 : n])
  }
  return out.length > 0 ? Array.from(new Set(out)).join(', ') : null
}

function cronLabel(expr: string): string {
  const parts = expr.trim().split(/\s+/)
  if (parts.length !== 5) return 'Every custom schedule'
  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts
  if (minute === '*' && hour === '*' && dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
    return 'Every minute'
  }
  const minuteStep = minute.match(/^\*\/(\d+)$/)
  if (minuteStep && hour === '*' && dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
    return `Every ${minuteStep[1]}m`
  }
  const hourStep = hour.match(/^\*\/(\d+)$/)
  if (minute === '0' && hourStep && dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
    return `Every ${hourStep[1]}h`
  }
  if (minute === '0' && hour === '*' && dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
    return 'Every hour'
  }
  const m = cronInt(minute, 0, 59)
  const h = cronInt(hour, 0, 23)
  if (m === null || h === null) return 'Every custom schedule'
  const time = `${two(h)}:${two(m)}`
  if (month === '*' && dayOfMonth === '*') {
    const dayPhrase = cronDayPhrase(dayOfWeek)
    return dayPhrase ? `Every ${dayPhrase} ${time}` : `Every custom schedule ${time}`
  }
  if (month === '*' && dayOfWeek === '*') {
    const dom = cronInt(dayOfMonth, 1, 31)
    return dom === null ? `Every custom schedule ${time}` : `Every month on day ${dom} ${time}`
  }
  return `Every custom schedule ${time}`
}

function onceLabel(at: string): string {
  const date = new Date(at)
  if (Number.isNaN(date.getTime())) return at
  const now = new Date()
  return new Intl.DateTimeFormat(undefined, {
    ...(date.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }),
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date)
}

/** Short pill label: one-shots show their time; recurring schedules start with "Every". */
function cadenceLabel(when: ScheduleWhen): string {
  switch (when.kind) {
    case 'at':
      return onceLabel(when.at)
    case 'every':
      return `Every ${when.every}`
    case 'cron':
      return cronLabel(when.cron)
  }
}

function cadenceTitle(when: ScheduleWhen): string {
  switch (when.kind) {
    case 'at':
      return `${onceLabel(when.at)} (${when.at})`
    case 'every':
      return `Every ${when.every}`
    case 'cron':
      return `${cronLabel(when.cron)} · ${when.timezone ?? 'local time'} (${when.cron})`
  }
}

export function CadencePill({ when }: { when: ScheduleWhen }) {
  return (
    <span
      title={cadenceTitle(when)}
      className="inline-flex shrink-0 items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground"
    >
      <Clock size={10} className="text-muted-foreground/70" />
      {cadenceLabel(when)}
      {when.kind === 'cron' && (
        <span className="text-muted-foreground/70">· {when.timezone ?? 'local'}</span>
      )}
    </span>
  )
}

const AUTOMATION_HEALTH_META: Record<IssueAutomationHealthState, { label: string; className: string }> = {
  inactive: { label: 'Inactive', className: 'bg-muted text-muted-foreground' },
  not_started: { label: 'Not started', className: 'bg-muted text-muted-foreground' },
  due: { label: 'Due', className: 'bg-warning/15 text-warning' },
  running: { label: 'Running', className: 'bg-info/15 text-info' },
  healthy: { label: 'Healthy', className: 'bg-success/15 text-success' },
  interrupted: { label: 'Interrupted', className: 'bg-warning/15 text-warning' },
  failed: { label: 'Failed', className: 'bg-destructive/15 text-destructive' },
  blocked: { label: 'Blocked', className: 'bg-destructive/15 text-destructive' },
}

const BOARD_HEALTH_CLASS: Record<IssueAutomationHealthState, string> = {
  inactive: 'text-muted-foreground/70',
  not_started: 'text-muted-foreground/70',
  due: 'text-warning',
  running: 'text-info',
  healthy: 'text-success/85',
  interrupted: 'rounded-md bg-warning/15 px-2 py-1 text-warning',
  failed: 'rounded-md bg-destructive/15 px-2 py-1 text-destructive',
  blocked: 'rounded-md bg-destructive/15 px-2 py-1 text-destructive',
}

export function AutomationHealthPill({ health }: { health: IssueAutomationHealth }) {
  const meta = AUTOMATION_HEALTH_META[health.state]
  return (
    <span
      title={health.message}
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium ${meta.className}`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />
      {meta.label}
    </span>
  )
}

// ==================== Priority indicator (Linear-style bars) ====================

/**
 * Linear-style priority glyph. high/medium/low/none render as three bars with
 * the matching number filled; urgent is a distinct filled amber square with a
 * `!` so it never reads as "just high".
 */
export function PriorityIndicator({ priority }: { priority: IssuePriority }) {
  if (priority === 'urgent') {
    return (
      <span
        title="Urgent"
        aria-label="Urgent priority"
        className="inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-[3px] bg-warning text-[10px] font-bold leading-none text-warning-foreground"
      >
        !
      </span>
    )
  }
  const filled = priority === 'high' ? 3 : priority === 'medium' ? 2 : priority === 'low' ? 1 : 0
  const heights = [4, 7, 10]
  return (
    <span
      title={`${priority} priority`}
      aria-label={`${priority} priority`}
      className="inline-flex h-3.5 w-3.5 shrink-0 items-end justify-center gap-[1.5px]"
    >
      {heights.map((h, i) => (
        <span
          key={i}
          style={{ height: `${h}px` }}
          className={`w-[2.5px] rounded-[1px] ${i < filled ? 'bg-muted' : 'bg-muted/25'}`}
        />
      ))}
    </span>
  )
}

// ==================== Status metadata + ordering ====================

/** Linear's group order: active work first, terminal states last. */
const STATUS_ORDER: IssueStatus[] = ['in_progress', 'todo', 'backlog', 'done', 'canceled']

interface BoardRow {
  wsId: string
  wsTag: string
  issue: IssueListItem
  agentRuntime?: AgentRuntime
  /** When this issue's name collides across workspaces (`issue.nameCollision`),
   *  how many OTHER workspaces also claim the name — drives the warning tooltip.
   *  Absent ⇒ no collision. */
  dupOthers?: number
}

interface AgentRuntime {
  id: string
  displayName: string
  source: 'override' | 'issue-default' | 'workspace-default' | 'workspace'
  /** Explicit frontmatter only matters in the board when it differs from the effective default. */
  distinctOverride?: boolean
}

/** Normalised collision key — title, trimmed + lowercased. Mirrors the server's
 *  `annotateNameCollisions` detection key. */
const nameKey = (title: string): string => title.trim().toLowerCase()

// ==================== Rows + groups ====================

function agentName(id: string, agents: readonly { id: string; displayName: string }[]): string {
  return agents.find((agent) => agent.id === id)?.displayName ?? id
}

function resolveAgentRuntime(
  issue: IssueListItem,
  workspace: { agents: readonly string[] } | null,
  agents: readonly { id: string; displayName: string; kind?: 'agent' | 'utility' }[],
  issueDefaultAgent: string | null,
  defaultAgent: string | null,
): AgentRuntime | undefined {
  if (!workspace) {
    return issue.agent
      ? { id: issue.agent, displayName: agentName(issue.agent, agents), source: 'override', distinctOverride: true }
      : undefined
  }
  const runtimeIds = workspace.agents.filter((id) => {
    const agent = agents.find((a) => a.id === id)
    return agent ? agent.kind !== 'utility' : id !== 'shell'
  })
  const issueDefaultId = issueDefaultAgent && runtimeIds.includes(issueDefaultAgent) ? issueDefaultAgent : null
  const workspaceDefaultId = defaultAgent && runtimeIds.includes(defaultAgent) ? defaultAgent : null
  const effectiveDefaultId = issueDefaultId ?? workspaceDefaultId ?? runtimeIds[0] ?? null
  if (issue.agent) {
    return {
      id: issue.agent,
      displayName: agentName(issue.agent, agents),
      source: 'override',
      distinctOverride: issue.agent !== effectiveDefaultId,
    }
  }
  if (issueDefaultId) {
    return { id: issueDefaultId, displayName: agentName(issueDefaultId, agents), source: 'issue-default' }
  }
  if (workspaceDefaultId) {
    return { id: workspaceDefaultId, displayName: agentName(workspaceDefaultId, agents), source: 'workspace-default' }
  }
  const fallbackId = runtimeIds[0]
  return fallbackId
    ? { id: fallbackId, displayName: agentName(fallbackId, agents), source: 'workspace' }
    : undefined
}

const ATTENTION_ORDER: Record<IssueAutomationHealthState, number> = {
  blocked: 0,
  failed: 1,
  interrupted: 2,
  running: 3,
  due: 4,
  not_started: 5,
  healthy: 6,
  inactive: 7,
}

const PRIORITY_ORDER: Record<IssuePriority, number> = {
  urgent: 0,
  high: 1,
  medium: 2,
  low: 3,
  none: 4,
}

function boardRowOrder(a: BoardRow, b: BoardRow): number {
  const aAttention = a.issue.automationHealth ? ATTENTION_ORDER[a.issue.automationHealth.state] : 4
  const bAttention = b.issue.automationHealth ? ATTENTION_ORDER[b.issue.automationHealth.state] : 4
  if (aAttention !== bAttention) return aAttention - bAttention

  const priority = PRIORITY_ORDER[a.issue.priority] - PRIORITY_ORDER[b.issue.priority]
  if (priority !== 0) return priority

  const aDue = a.issue.nextDueAtMs ?? Number.POSITIVE_INFINITY
  const bDue = b.issue.nextDueAtMs ?? Number.POSITIVE_INFINITY
  if (aDue !== bDue) return aDue - bDue
  return a.issue.title.localeCompare(b.issue.title)
}

function BoardHealth({ issue }: { issue: IssueListItem }) {
  const health = issue.automationHealth
  if (!health) return null
  const meta = AUTOMATION_HEALTH_META[health.state]
  const active = health.state === 'running' || health.state === 'due'
  const lastRun = issue.lastFiredAtMs ? formatRelativeTime(issue.lastFiredAtMs) : ''

  return (
    <span
      title={health.message}
      className={`inline-flex shrink-0 items-center gap-1.5 text-[11px] font-medium ${BOARD_HEALTH_CLASS[health.state]}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full bg-current ${active ? 'animate-pulse' : ''}`} aria-hidden />
      {meta.label}
      {lastRun && <span className="font-normal text-muted-foreground/55">· {lastRun}</span>}
    </span>
  )
}

function BoardCadence({ issue }: { issue: IssueListItem }) {
  if (!issue.when) return null
  const nextRun = issue.nextDueAtMs ? formatRelativeTime(issue.nextDueAtMs) : ''
  return (
    <span
      title={cadenceTitle(issue.when)}
      className="inline-flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground/75"
    >
      <Clock size={11} className="shrink-0 text-muted-foreground/55" aria-hidden />
      <span className="truncate">{cadenceLabel(issue.when)}</span>
      {nextRun && <span className="shrink-0 text-muted-foreground/50">· {nextRun}</span>}
    </span>
  )
}

function BoardAutomationSummary({ issue, className = '' }: { issue: IssueListItem; className?: string }) {
  if (!issue.when && !issue.automationHealth) return null
  return (
    <div className={`flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5 ${className}`}>
      <BoardHealth issue={issue} />
      <BoardCadence issue={issue} />
    </div>
  )
}

function IssueRow({ wsId, wsTag, issue, agentRuntime, dupOthers, onOpen }: BoardRow & { onOpen: () => void }) {
  const terminal = issue.status === 'done' || issue.status === 'canceled'
  const titleMatchesId = issue.title.trim().toLowerCase() === issue.id.trim().toLowerCase()
  const explicitAssignee = issue.assignee !== '@workspace'
  const explicitAgent = agentRuntime?.source === 'override' && agentRuntime.distinctOverride !== false
  const assigneeLabel = issue.assignee === '@new' ? 'Assign on first run' : issue.assignee
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        title={`Open ${issue.id}`}
        className={`oa-pressable flex w-full items-start gap-3 px-3.5 py-3 text-left transition-colors hover:bg-muted/35 sm:px-4 ${
          terminal ? 'opacity-60' : ''
        }`}
      >
        <span className="mt-0.5 flex h-5 w-4 shrink-0 items-center justify-center">
          <PriorityIndicator priority={issue.priority} />
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <span title={issue.title} className="min-w-0 truncate text-[13px] font-medium text-foreground sm:text-[13.5px]">
              {issue.title}
            </span>
            {issue.nameCollision && (
              <span
                title={`Duplicate name — also used in ${dupOthers ?? 1} other workspace${
                  (dupOthers ?? 1) === 1 ? '' : 's'
                }. A [[name]] is a global handle; resolve manually.`}
                aria-label="Duplicate issue name across workspaces"
                className="inline-flex shrink-0 items-center gap-1 rounded-full bg-warning/10 px-1.5 py-0.5 text-[9px] font-medium text-warning"
              >
                <Copy size={9} aria-hidden /> dup
              </span>
            )}
          </div>

          <BoardAutomationSummary issue={issue} className="mt-2 lg:hidden" />

          <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1 text-[10.5px] text-muted-foreground/60">
            <span className="truncate" title={`Workspace: ${wsTag} (${wsId.slice(0, 8)})`}>
              {wsTag}
            </span>
            {!titleMatchesId && (
              <span className="hidden max-w-[14rem] truncate font-mono text-muted-foreground/45 sm:inline" title={`Issue ID: ${issue.id}`}>
                #{issue.id}
              </span>
            )}
            {explicitAssignee && (
              <span className="max-w-[14rem] truncate text-muted-foreground/70" title={`Assignee: ${issue.assignee}`}>
                {assigneeLabel}
              </span>
            )}
            {explicitAgent && agentRuntime && (
              <span className="inline-flex items-center gap-1 text-muted-foreground/70" title={`Agent runtime override: ${agentRuntime.displayName}`}>
                <Bot size={10} aria-hidden /> {agentRuntime.id} override
              </span>
            )}
          </div>
        </div>

        <BoardAutomationSummary
          issue={issue}
          className="hidden max-w-[48%] shrink-0 justify-end lg:flex"
        />
      </button>
    </li>
  )
}

function StatusGroup({
  status,
  rows,
  collapsed,
  onToggle,
  onOpenRow,
}: {
  status: IssueStatus
  rows: BoardRow[]
  collapsed: boolean
  onToggle: () => void
  onOpenRow: (row: BoardRow) => void
}) {
  const meta = STATUS_META[status]
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-secondary">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={!collapsed}
        className="flex w-full items-center gap-2 px-4 py-2.5 text-left transition-colors hover:bg-muted/40"
      >
        {collapsed ? (
          <ChevronRight size={14} className="shrink-0 text-muted-foreground/70" />
        ) : (
          <ChevronDown size={14} className="shrink-0 text-muted-foreground/70" />
        )}
        <meta.Icon size={14} className={`shrink-0 ${meta.className}`} />
        <span className="text-[13px] font-semibold text-foreground">{meta.label}</span>
        <span className="text-xs text-muted-foreground">{rows.length}</span>
      </button>
      {!collapsed && (
        <ul className="divide-y divide-border/60 border-t border-border">
          {rows.map((row) => (
            <IssueRow
              key={`${row.wsId}:${row.issue.id}`}
              {...row}
              onOpen={() => onOpenRow(row)}
            />
          ))}
        </ul>
      )}
    </div>
  )
}

// ==================== Invalid-workspace surface (loud failure) ====================

function InvalidWorkspaces({ workspaces }: { workspaces: IssueWorkspace[] }) {
  if (workspaces.length === 0) return null
  return (
    <div className="space-y-1.5">
      {workspaces.map((ws) => (
        <div
          key={ws.wsId}
          className="rounded-lg border border-destructive/30 bg-destructive/[0.06] px-4 py-2.5 text-xs text-destructive"
        >
          <span className="font-medium text-destructive">{ws.tag}</span>{' '}
          <span className="font-mono text-destructive/70">{ws.wsId.slice(0, 8)}</span>
          <p className="mt-1 leading-relaxed">{ws.error ?? 'issues are unreadable for this workspace'}</p>
        </div>
      ))}
    </div>
  )
}

// ==================== Board ====================

/**
 * Global Issue board — a read-only, Linear-style list of every workspace's
 * issues (GET /api/issues), grouped by status. An issue with a `when` is
 * scheduled (carries a cadence pill + still fires headless runs via the
 * scanner); an issue without is a pure tracked work item. Each workspace owns
 * its issues as `.alice/issues/<id>.md` files — there is no central registry
 * and nothing to create here (Phase 1).
 */
export function IssuesBoard() {
  const { data, error, loading } = useIssues()
  const { agents, defaultAgent, issueDefaultAgent, workspaces: workspaceMetas } = useWorkspaces()
  const openOrFocus = useWorkspace((s) => s.openOrFocus)
  const setSidebar = useWorkspace((s) => s.setSidebar)
  const [collapsed, setCollapsed] = useState<Set<IssueStatus>>(new Set())

  const openRow = (row: BoardRow) => {
    setSidebar('issue')
    openOrFocus({ kind: 'issue-detail', params: { wsId: row.wsId, id: row.issue.id } })
  }

  const toggle = (status: IssueStatus) =>
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(status)) next.delete(status)
      else next.add(status)
      return next
    })

  // Keep showing any snapshot we have (incl. the warm cache) rather than
  // flipping to a loading/error screen on a transient refresh failure.
  if (!data) {
    if (loading) return <CenteredLoading />
    return <div className="text-sm text-destructive">Failed to load issues: {error}</div>
  }

  // Defensive: tolerate a malformed/empty payload (e.g. the demo catchAll's
  // bare `{}` before an /api/issues handler lands) rather than white-screening.
  const issueWorkspaces = data.workspaces ?? []
  const invalid = issueWorkspaces.filter((w) => w.status === 'invalid')

  // Flatten every ok workspace's issues, tagged with the workspace, then
  // bucket by status in Linear's order. Empty buckets are hidden.
  const okWorkspaces = issueWorkspaces.filter((w) => w.status === 'ok')

  // For each name, the set of workspaces that claim it — so a colliding row's
  // warning tooltip can say "also in N other workspaces". The backend already
  // flags `issue.nameCollision` (authoritative detection); this only supplies
  // the count for the tooltip.
  const wsByName = new Map<string, Set<string>>()
  for (const w of okWorkspaces) {
    for (const issue of w.issues ?? []) {
      const key = nameKey(issue.title)
      if (!key) continue
      const set = wsByName.get(key) ?? new Set<string>()
      set.add(w.wsId)
      wsByName.set(key, set)
    }
  }

  const rows: BoardRow[] = okWorkspaces.flatMap((w) =>
    (w.issues ?? []).map((issue) => ({
      wsId: w.wsId,
      wsTag: w.tag,
      issue,
      agentRuntime: resolveAgentRuntime(
        issue,
        workspaceMetas.find((workspace) => workspace.id === w.wsId) ?? null,
        agents,
        issueDefaultAgent,
        defaultAgent,
      ),
      dupOthers: issue.nameCollision
        ? Math.max(0, (wsByName.get(nameKey(issue.title))?.size ?? 1) - 1)
        : undefined,
    })),
  )

  const groups = STATUS_ORDER.map((status) => ({
    status,
    rows: rows.filter((r) => r.issue.status === status).sort(boardRowOrder),
  })).filter((g) => g.rows.length > 0)

  const staleBanner = error ? (
    <div className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-1.5 text-xs text-warning">
      Live refresh failing — showing the last known issues.
    </div>
  ) : null

  if (groups.length === 0 && invalid.length === 0) {
    return (
      <div className="space-y-3">
        {staleBanner}
        <div className="rounded-lg border border-dashed border-border px-6 py-12 text-center">
          <ListChecks size={24} className="mx-auto text-muted-foreground/50" />
          <p className="mt-3 text-sm text-muted-foreground">No workspace has any issues yet.</p>
          <p className="mt-1 text-xs text-muted-foreground/80">
            A workspace tracks an issue by writing{' '}
            <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px] text-foreground/80">
              .alice/issues/&lt;id&gt;.md
            </code>
            . Add a <span className="text-foreground">when</span> field and it self-schedules.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {staleBanner}
      <InvalidWorkspaces workspaces={invalid} />
      {groups.map((g) => (
        <StatusGroup
          key={g.status}
          status={g.status}
          rows={g.rows}
          collapsed={collapsed.has(g.status)}
          onToggle={() => toggle(g.status)}
          onOpenRow={openRow}
        />
      ))}
    </div>
  )
}
