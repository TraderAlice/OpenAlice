import { useCallback, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { ArrowLeft, Hash, Inbox, ListChecks, TrendingUp, X } from 'lucide-react'

import type { HeadlessTaskRecord, HeadlessTaskStatus } from '../api/headless'
import type { InboxEntry } from '../api/inbox'
import type {
  IssueDetail as IssueDetailData,
  IssueDetailIssue,
  IssuePriority,
  IssueStatus,
  WikilinkIssueRef,
  WikilinkResolution,
} from '../api/issues'
import { issuesApi } from '../api/issues'
import { useIssueDetail } from '../hooks/useIssueDetail'
import { useIssues } from '../hooks/useIssues'
import { formatRelativeTime } from '../lib/intl'
import { useInboxRead } from '../live/inbox-read'
import { useInboxSelection } from '../live/inbox-selection'
import { previewForEntry } from '../live/inbox-threads'
import { useWikilinkHandler } from '../live/wikilink'
import { useWorkspace } from '../tabs/store'
import { CadencePill, PriorityIndicator, STATUS_META } from './IssuesBoard'
import { MarkdownContent } from './MarkdownContent'

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

// Sentinel option that swaps the assignee select into a free-text input.
const ASSIGNEE_CUSTOM = '__custom__'

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

/**
 * Assignee editor: a small select over the common assignees (unassigned / human
 * / `ws:<this workspace's tag>`), with the current value preserved if it's
 * something else, plus a "Custom…" escape hatch that reveals a free-text input.
 */
function AssigneeEditor({
  value,
  wsTag,
  disabled,
  onChange,
}: {
  value: string
  wsTag?: string
  disabled?: boolean
  onChange: (next: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)

  const presets = useMemo(() => {
    const out = ['unassigned', 'human']
    if (wsTag) out.push(`ws:${wsTag}`)
    if (!out.includes(value)) out.push(value)
    return out
  }, [wsTag, value])

  if (editing) {
    const commit = () => {
      const next = draft.trim()
      setEditing(false)
      if (next && next !== value) onChange(next)
      else setDraft(value)
    }
    return (
      <input
        autoFocus
        className={railControl}
        value={draft}
        disabled={disabled}
        placeholder="ws:tag / human / …"
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            commit()
          } else if (e.key === 'Escape') {
            e.preventDefault()
            setEditing(false)
            setDraft(value)
          }
        }}
        onBlur={commit}
      />
    )
  }

  return (
    <select
      className={railControl}
      value={value}
      disabled={disabled}
      onChange={(e) => {
        const v = e.target.value
        if (v === ASSIGNEE_CUSTOM) {
          setDraft(value)
          setEditing(true)
          return
        }
        if (v !== value) onChange(v)
      }}
    >
      {presets.map((p) => (
        <option key={p} value={p}>
          {p}
        </option>
      ))}
      <option value={ASSIGNEE_CUSTOM}>Custom…</option>
    </select>
  )
}

function PropertiesRail({
  issue,
  wsTag,
  saving,
  error,
  onPatch,
}: {
  issue: IssueDetailIssue
  wsTag?: string
  saving: boolean
  error: string | null
  onPatch: (patch: { status?: IssueStatus; priority?: IssuePriority; assignee?: string }) => void
}) {
  const meta = STATUS_META[issue.status]
  return (
    <aside className="w-full shrink-0 space-y-1 rounded-lg border border-border bg-bg-secondary p-4 lg:w-64">
      <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted/70">Properties</h3>
      <div className="divide-y divide-border/60">
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
            wsTag={wsTag}
            disabled={saving}
            onChange={(assignee) => onPatch({ assignee })}
          />
        </EditRow>
        <PropRow label="Cadence">
          {issue.when ? <CadencePill when={issue.when} /> : <span className="text-muted">—</span>}
        </PropRow>
        <PropRow label="Agent">
          {issue.agent ? (
            <span className="font-mono text-[12px]">{issue.agent}</span>
          ) : (
            <span className="text-muted">—</span>
          )}
        </PropRow>
        {issue.when && (
          <>
            <PropRow label="Last fired">
              {issue.lastFiredAtMs ? (
                formatRelativeTime(issue.lastFiredAtMs)
              ) : (
                <span className="text-muted">never</span>
              )}
            </PropRow>
            <PropRow label="Next due">
              {issue.nextDueAtMs ? (
                formatRelativeTime(issue.nextDueAtMs)
              ) : (
                <span className="text-muted">—</span>
              )}
            </PropRow>
          </>
        )}
      </div>
      {error && <p className="mt-2 text-[11px] leading-snug text-red-400">{error}</p>}
    </aside>
  )
}

// ==================== Comment composer ====================

/**
 * Human comment composer. POSTs to the comments endpoint (author = "human");
 * the response carries the updated body (with the new `## Comments` block), so
 * we hand it straight to the detail hook's `mutate` — the existing markdown
 * renderer in the main column surfaces the comment. No client-side re-parsing.
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

// ==================== Activity feed (headless runs) ====================

function RunRow({ run }: { run: HeadlessTaskRecord }) {
  return (
    <li className="rounded-lg border border-border bg-bg-secondary px-3 py-2.5">
      <div className="flex items-center gap-2">
        <span
          className={`inline-block rounded px-1.5 py-0.5 text-[11px] font-medium ${RUN_STATUS_STYLE[run.status]}`}
        >
          {run.status}
        </span>
        <span className="text-xs text-muted">{run.agent}</span>
        <span className="ml-auto text-xs text-muted" title={new Date(run.startedAt).toLocaleString()}>
          {formatRelativeTime(run.startedAt)}
        </span>
        <span className="text-xs text-muted/70">· {fmtDuration(run.durationMs)}</span>
      </div>
      {run.prompt && (
        <p className="mt-1.5 line-clamp-2 text-[12px] leading-snug text-text/80" title={run.prompt}>
          {run.prompt}
        </p>
      )}
      {run.error && <p className="mt-1 text-[12px] text-red-400">{run.error}</p>}
    </li>
  )
}

function ActivityFeed({ runs }: { runs: HeadlessTaskRecord[] }) {
  return (
    <section className="mt-8">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted/70">Activity</h3>
      {runs.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-xs text-muted">
          No headless runs for this issue yet.
        </p>
      ) : (
        <ul className="space-y-2">
          {runs.map((run) => (
            <RunRow key={run.taskId} run={run} />
          ))}
        </ul>
      )}
    </section>
  )
}

// ==================== Inbox reports (issue → inbox) ====================

/**
 * The inbox reports this issue produced — the issue→inbox direction of the
 * cross-link (each entry's server-stamped `origin.issueId` is this issue). The
 * run→issue direction is the Activity feed above. Each row jumps to the Inbox,
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
 * rendered markdown body (which now carries the `## Comments` section) +
 * Activity feed + a comment composer. Right rail = Properties, with status /
 * priority / assignee editable inline (each write PATCHes and applies the
 * server-returned detail — authoritative, refetch-free). Scheduling/agent/firing
 * markers stay read-only (they're driven by frontmatter the agent owns).
 */
export function IssueDetail({ wsId, id }: { wsId: string; id: string }) {
  const { data, error, loading, mutate } = useIssueDetail(wsId, id)
  const { data: board } = useIssues()
  const openOrFocus = useWorkspace((s) => s.openOrFocus)
  const setSidebar = useWorkspace((s) => s.setSidebar)
  const selectInboxEntry = useInboxSelection((s) => s.select)
  const markInboxRead = useInboxRead((s) => s.markRead)
  // Reuse the canonical `[[name]]` navigation (jump to Tracked + select the
  // entity) — see live/wikilink. We only override the click to first RESOLVE
  // the token across both namespaces (entity + issues).
  const gotoEntity = useWikilinkHandler()

  const [saving, setSaving] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  // Set when a clicked `[[name]]` resolves to >1 target — drives the picker.
  const [picker, setPicker] = useState<WikilinkResolution | null>(null)

  const gotoIssue = useCallback(
    (ref: WikilinkIssueRef) => {
      openOrFocus({ kind: 'issue-detail', params: { wsId: ref.wsId, id: ref.id } })
    },
    [openOrFocus],
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

  // This workspace's tag — the `ws:<tag>` assignee option. Sourced from the
  // board snapshot (the canonical wsId→tag map), which is process-cached and
  // already warm when the detail is opened from a board row.
  const wsTag = board?.workspaces.find((w) => w.wsId === wsId)?.tag

  const onPatch = useCallback(
    async (patch: { status?: IssueStatus; priority?: IssuePriority; assignee?: string }) => {
      setSaving(true)
      setActionError(null)
      try {
        const next = await issuesApi.update(wsId, id, patch)
        mutate(next)
      } catch (e) {
        // The selects are bound to the (unchanged) server data, so they revert
        // on their own; we just surface why.
        setActionError(e instanceof Error ? e.message : String(e))
      } finally {
        setSaving(false)
      }
    },
    [wsId, id, mutate],
  )

  const backToBoard = (
    <button
      type="button"
      onClick={() => openOrFocus({ kind: 'issue', params: {} })}
      className="mb-4 inline-flex items-center gap-1.5 text-xs text-muted transition-colors hover:text-text"
    >
      <ArrowLeft size={13} /> Issues
    </button>
  )

  if (!data) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-5 md:px-6">
        {backToBoard}
        {loading ? (
          <div className="text-sm text-muted">Loading…</div>
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
  const inboxReports = data.inboxReports ?? []

  return (
    <div className="mx-auto max-w-4xl px-4 py-5 md:px-6">
      {backToBoard}
      <div className="flex flex-col gap-6 lg:flex-row">
        <main className="min-w-0 flex-1">
          <div className="mb-1 flex items-center gap-2">
            <span className="font-mono text-[11px] text-muted/70">{id}</span>
            {issue.when && <CadencePill when={issue.when} />}
          </div>
          <h1 className="text-xl font-semibold text-text">{issue.title}</h1>
          <div className="mt-4 border-t border-border/60 pt-4">
            {issue.body.trim() ? (
              <MarkdownContent text={issue.body} onWikilink={onWikilink} />
            ) : (
              <p className="text-sm text-muted">No description.</p>
            )}
          </div>
          <CommentComposer wsId={wsId} id={id} onPosted={mutate} />
          <ActivityFeed runs={runs} />
          <InboxReportsSection reports={inboxReports} onOpen={gotoInbox} />
        </main>
        <PropertiesRail
          issue={issue}
          wsTag={wsTag}
          saving={saving}
          error={actionError}
          onPatch={onPatch}
        />
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
