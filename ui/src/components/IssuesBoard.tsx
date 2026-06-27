import { useState } from 'react'
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Circle,
  CircleDashed,
  CircleDot,
  Clock,
  Copy,
  ListChecks,
  XCircle,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

import type { IssueListItem, IssuePriority, IssueStatus, IssueWorkspace } from '../api/issues'
import type { ScheduleWhen } from '../api/schedule'
import { useIssues } from '../hooks/useIssues'
import { useWorkspace } from '../tabs/store'

// ==================== Cadence pill (lifted from AutomationSchedulesSection) ====================

/** Short pill label. `at` collapses to "once" (its exact time shows in the tooltip). */
function cadenceLabel(when: ScheduleWhen): string {
  switch (when.kind) {
    case 'at':
      return 'once'
    case 'every':
      return `every ${when.every}`
    case 'cron':
      return when.cron
  }
}

function cadenceTitle(when: ScheduleWhen): string {
  switch (when.kind) {
    case 'at':
      return `once, at ${when.at}`
    case 'every':
      return `every ${when.every}`
    case 'cron':
      return `cron: ${when.cron}`
  }
}

export function CadencePill({ when }: { when: ScheduleWhen }) {
  return (
    <span
      title={cadenceTitle(when)}
      className="inline-flex shrink-0 items-center gap-1 rounded-full bg-bg-tertiary px-2 py-0.5 font-mono text-[11px] text-muted"
    >
      <Clock size={10} className="text-muted/70" />
      {cadenceLabel(when)}
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
        className="inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-[3px] bg-amber-500 text-[10px] font-bold leading-none text-black"
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

export interface StatusMeta {
  label: string
  Icon: LucideIcon
  /** Icon tint. */
  className: string
}

/** Linear's group order: active work first, terminal states last. */
const STATUS_ORDER: IssueStatus[] = ['in_progress', 'todo', 'backlog', 'done', 'canceled']

export const STATUS_META: Record<IssueStatus, StatusMeta> = {
  in_progress: { label: 'In Progress', Icon: CircleDot, className: 'text-amber-400' },
  todo: { label: 'Todo', Icon: Circle, className: 'text-muted' },
  backlog: { label: 'Backlog', Icon: CircleDashed, className: 'text-muted/60' },
  done: { label: 'Done', Icon: CheckCircle2, className: 'text-emerald-400' },
  canceled: { label: 'Canceled', Icon: XCircle, className: 'text-muted/50' },
}

interface BoardRow {
  wsId: string
  wsTag: string
  issue: IssueListItem
  /** When this issue's name collides across workspaces (`issue.nameCollision`),
   *  how many OTHER workspaces also claim the name — drives the warning tooltip.
   *  Absent ⇒ no collision. */
  dupOthers?: number
}

/** Normalised collision key — title, trimmed + lowercased. Mirrors the server's
 *  `annotateNameCollisions` detection key. */
const nameKey = (title: string): string => title.trim().toLowerCase()

// ==================== Rows + groups ====================

function IssueRow({ wsId, wsTag, issue, dupOthers, onOpen }: BoardRow & { onOpen: () => void }) {
  const terminal = issue.status === 'done' || issue.status === 'canceled'
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        title={`Open ${issue.id}`}
        className={`flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-bg-tertiary/40 ${
          terminal ? 'opacity-60' : ''
        }`}
      >
        <PriorityIndicator priority={issue.priority} />
        <span
          title={issue.id}
          className="hidden max-w-[8rem] shrink-0 truncate font-mono text-[11px] text-muted/70 sm:inline"
        >
          {issue.id}
        </span>
        <span title={issue.title} className="min-w-0 flex-1 truncate text-[13px] text-text">
          {issue.title}
        </span>
        {issue.nameCollision && (
          <span
            title={`Duplicate name — also used in ${dupOthers ?? 1} other workspace${
              (dupOthers ?? 1) === 1 ? '' : 's'
            }. A [[name]] is a global handle; resolve manually.`}
            aria-label="Duplicate issue name across workspaces"
            className="inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-400"
          >
            <Copy size={10} aria-hidden /> dup
          </span>
        )}
        {issue.when && <CadencePill when={issue.when} />}
        <span className="hidden shrink-0 text-xs text-muted sm:inline" title={`Assignee: ${issue.assignee}`}>
          {issue.assignee}
        </span>
        <span className="shrink-0 rounded-full bg-bg-tertiary px-2 py-0.5 text-[11px] text-muted" title={`Workspace: ${wsTag} (${wsId.slice(0, 8)})`}>
          {wsTag}
        </span>
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
    <div className="overflow-hidden rounded-lg border border-border bg-bg-secondary">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={!collapsed}
        className="flex w-full items-center gap-2 px-4 py-2.5 text-left transition-colors hover:bg-bg-tertiary/40"
      >
        {collapsed ? (
          <ChevronRight size={14} className="shrink-0 text-muted/70" />
        ) : (
          <ChevronDown size={14} className="shrink-0 text-muted/70" />
        )}
        <meta.Icon size={14} className={`shrink-0 ${meta.className}`} />
        <span className="text-[13px] font-semibold text-text">{meta.label}</span>
        <span className="text-xs text-muted">{rows.length}</span>
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
          className="rounded-lg border border-red-500/30 bg-red-500/[0.06] px-4 py-2.5 text-xs text-red-400"
        >
          <span className="font-medium text-red-300">{ws.tag}</span>{' '}
          <span className="font-mono text-red-400/70">{ws.wsId.slice(0, 8)}</span>
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
  const openOrFocus = useWorkspace((s) => s.openOrFocus)
  const [collapsed, setCollapsed] = useState<Set<IssueStatus>>(new Set())

  const openRow = (row: BoardRow) =>
    openOrFocus({ kind: 'issue-detail', params: { wsId: row.wsId, id: row.issue.id } })

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
    if (loading) return <div className="text-sm text-muted">Loading…</div>
    return <div className="text-sm text-red-400">Failed to load issues: {error}</div>
  }

  // Defensive: tolerate a malformed/empty payload (e.g. the demo catchAll's
  // bare `{}` before an /api/issues handler lands) rather than white-screening.
  const workspaces = data.workspaces ?? []
  const invalid = workspaces.filter((w) => w.status === 'invalid')

  // Flatten every ok workspace's issues, tagged with the workspace, then
  // bucket by status in Linear's order. Empty buckets are hidden.
  const okWorkspaces = workspaces.filter((w) => w.status === 'ok')

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
      dupOthers: issue.nameCollision
        ? Math.max(0, (wsByName.get(nameKey(issue.title))?.size ?? 1) - 1)
        : undefined,
    })),
  )

  const groups = STATUS_ORDER.map((status) => ({
    status,
    rows: rows.filter((r) => r.issue.status === status),
  })).filter((g) => g.rows.length > 0)

  const staleBanner = error ? (
    <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-xs text-amber-400">
      Live refresh failing — showing the last known issues.
    </div>
  ) : null

  if (groups.length === 0 && invalid.length === 0) {
    return (
      <div className="space-y-3">
        {staleBanner}
        <div className="rounded-lg border border-dashed border-border px-6 py-12 text-center">
          <ListChecks size={24} className="mx-auto text-muted/50" />
          <p className="mt-3 text-sm text-muted">No workspace has any issues yet.</p>
          <p className="mt-1 text-xs text-muted/80">
            A workspace tracks an issue by writing{' '}
            <code className="rounded bg-bg-tertiary px-1 py-0.5 font-mono text-[11px] text-text/80">
              .alice/issues/&lt;id&gt;.md
            </code>
            . Add a <span className="text-text">when</span> field and it self-schedules.
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
