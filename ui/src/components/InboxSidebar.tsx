import { useEffect, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Clock, Layers } from 'lucide-react'
import { formatRelativeTime } from '../lib/intl'
import { inboxLive } from '../live/inbox'
import { useInboxRead } from '../live/inbox-read'
import { useInboxSelection } from '../live/inbox-selection'
import { useInboxViewMode } from '../live/inbox-view-mode'
import { groupThreads, previewForEntry } from '../live/inbox-threads'
import { Skeleton } from './StateViews'
import type { InboxEntry } from '../api/inbox'

/**
 * Inbox sidebar list — two view modes (toggle in the header, see
 * `InboxViewToggle`):
 *
 * - **time**: a flat chronological feed, newest-first, date-bucketed.
 * - **workspace**: pushes clustered under their workspace; each cluster
 *   ordered by latest push (a workspace bubbles up on new activity).
 *
 * Selection + detail stay per-push in BOTH modes — a workspace's pushes
 * are usually unrelated topics (no Issue layer to make them one thread),
 * so clustering is a sidebar affordance, not a merge. Selecting a row
 * marks just that push read; j/k walks the currently-displayed order.
 */
export function InboxSidebar() {
  const { t } = useTranslation()
  const entries = inboxLive.useStore((s) => s.entries)
  const loading = inboxLive.useStore((s) => s.loading)
  const selectedId = useInboxSelection((s) => s.selectedEntryId)
  const select = useInboxSelection((s) => s.select)
  const markRead = useInboxRead((s) => s.markRead)
  const mode = useInboxViewMode((s) => s.mode)

  const threads = useMemo(() => groupThreads(entries), [entries])
  const readIds = useMemo(() => {
    const ids: Record<string, true> = {}
    for (const entry of entries) {
      if (entry.readAt) ids[entry.id] = true
    }
    return ids
  }, [entries])

  // The visible order j/k and default-select walk: clustered order in
  // workspace mode, plain newest-first in time mode.
  const ordered = useMemo(
    () => (mode === 'workspace' ? threads.flatMap((th) => th.entries) : entries),
    [mode, threads, entries],
  )

  /** select + mark read in one. Used by every selection mutation site. */
  const selectAndRead = (id: string) => {
    select(id)
    markRead(id)
  }

  // Default-select the first row on first non-empty load. Latch once.
  const everSelectedRef = useRef(false)
  useEffect(() => {
    if (everSelectedRef.current) return
    if (ordered.length === 0) return
    if (!selectedId) selectAndRead(ordered[0]!.id)
    everSelectedRef.current = true
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ordered, selectedId])

  // Keyboard nav — j/k move within the currently-displayed order.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key !== 'j' && e.key !== 'k') return
      if (ordered.length === 0) return
      const idx = ordered.findIndex((x) => x.id === selectedId)
      const next = e.key === 'j' ? Math.min(ordered.length - 1, idx + 1) : Math.max(0, idx - 1)
      if (next !== idx && ordered[next]) selectAndRead(ordered[next]!.id)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ordered, selectedId])

  if (loading && entries.length === 0) {
    return (
      <div className="flex flex-col py-1" aria-hidden="true">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex flex-col gap-1.5 px-3 py-2">
            <Skeleton className="h-3 w-1/2" />
            <Skeleton className="h-2.5 w-3/4" />
          </div>
        ))}
      </div>
    )
  }

  if (entries.length === 0) {
    return (
      <div className="px-3 py-4 text-[12px] text-text-muted/70 leading-relaxed">
        {t('inbox.noMessages')}
        <div className="mt-1 text-text-muted/50">
          {t('inbox.emptyHint')}
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full overflow-y-auto py-1">
      {mode === 'workspace' ? (
        <WorkspaceView
          threads={threads}
          selectedId={selectedId}
          readIds={readIds}
          onSelect={selectAndRead}
        />
      ) : (
        <TimeView
          entries={entries}
          selectedId={selectedId}
          readIds={readIds}
          onSelect={selectAndRead}
        />
      )}
    </div>
  )
}

/** Header toggle (mounted via the section's `Actions` slot). Segmented
 *  Time / Workspace switch. */
export function InboxViewToggle() {
  const { t } = useTranslation()
  const mode = useInboxViewMode((s) => s.mode)
  const setMode = useInboxViewMode((s) => s.setMode)

  return (
    <div className="flex items-center rounded-md border border-border/70 overflow-hidden">
      <ToggleBtn
        active={mode === 'time'}
        onClick={() => setMode('time')}
        title={t('inbox.viewTime')}
      >
        <Clock size={13} strokeWidth={2} />
      </ToggleBtn>
      <ToggleBtn
        active={mode === 'workspace'}
        onClick={() => setMode('workspace')}
        title={t('inbox.viewWorkspace')}
      >
        <Layers size={13} strokeWidth={2} />
      </ToggleBtn>
    </div>
  )
}

function ToggleBtn({
  active, onClick, title, children,
}: {
  active: boolean
  onClick: () => void
  title: string
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      aria-pressed={active}
      className={`flex items-center justify-center w-8 h-8 transition-colors ${
        active ? 'bg-bg-tertiary text-text' : 'text-text-muted/60 hover:text-text hover:bg-bg-tertiary/50'
      }`}
    >
      {children}
    </button>
  )
}

// ==================== Workspace (clustered) view ====================

function WorkspaceView({
  threads, selectedId, readIds, onSelect,
}: {
  threads: ReturnType<typeof groupThreads>
  selectedId: string | null
  readIds: Record<string, true>
  onSelect: (id: string) => void
}) {
  return (
    <>
      {threads.map((thread) => {
        const unread = thread.entries.reduce((n, e) => (readIds[e.id] ? n : n + 1), 0)
        return (
          <div key={thread.workspaceId} className="mb-1.5">
            {/* Cluster header: label · unread badge · latest time */}
            <div className="flex items-center gap-1.5 px-3 mt-1.5 mb-0.5">
              <span className="flex-1 truncate text-[12px] font-medium text-text/90">
                {thread.workspaceLabel ?? thread.workspaceId}
              </span>
              {unread > 0 && (
                <span className="shrink-0 min-w-[15px] h-[15px] px-1 rounded-full bg-accent text-bg text-[9px] font-semibold tabular-nums flex items-center justify-center">
                  {unread}
                </span>
              )}
              <span className="shrink-0 text-[10px] text-text-muted/50 tabular-nums">
                {formatRelativeTime(thread.latestTs)}
              </span>
            </div>

            {/* Message rows on a kinship rail */}
            <div className="ml-[18px] border-l border-border/50">
              {thread.entries.map((entry) => (
                <ClusterRow
                  key={entry.id}
                  entry={entry}
                  active={entry.id === selectedId}
                  unread={!readIds[entry.id]}
                  onClick={() => onSelect(entry.id)}
                />
              ))}
            </div>
          </div>
        )
      })}
    </>
  )
}

/** Row inside a workspace cluster — label lives in the header, so the
 *  row shows just the push preview + time. */
function ClusterRow({
  entry, active, unread, onClick,
}: {
  entry: InboxEntry
  active: boolean
  unread: boolean
  onClick: () => void
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onClick()
        }
      }}
      className={`group relative grid min-h-11 grid-cols-[auto_minmax(0,1fr)] gap-x-1.5 gap-y-0.5 pl-3 pr-3 py-1.5 cursor-pointer transition-colors outline-none focus-visible:bg-bg-tertiary/70 ${
        active ? 'bg-bg-tertiary' : 'hover:bg-bg-tertiary/50'
      }`}
    >
      {active && (
        <span aria-hidden className="absolute left-0 top-0 bottom-0 w-[2px] bg-accent" />
      )}
      <span
        aria-hidden
        className={`mt-[7px] shrink-0 w-1.5 h-1.5 rounded-full ${unread ? 'bg-accent' : 'bg-transparent'}`}
      />
      <span className={`min-w-0 truncate text-[11px] leading-5 ${unread ? 'text-text-muted' : 'text-text-muted/70'}`}>
        {previewForEntry(entry)}
      </span>
      <span className="col-start-2 text-[10px] text-text-muted/50 tabular-nums">
        {formatRelativeTime(entry.ts)}
      </span>
    </div>
  )
}

// ==================== Time (flat chronological) view ====================

function TimeView({
  entries, selectedId, readIds, onSelect,
}: {
  entries: readonly InboxEntry[]
  selectedId: string | null
  readIds: Record<string, true>
  onSelect: (id: string) => void
}) {
  const { t } = useTranslation()
  const groups = useMemo(() => groupByBucket(entries), [entries])

  return (
    <>
      {groups.map(([bucket, items]) => (
        <div key={bucket} className="mb-1">
          <div className="px-3 mt-2 mb-1 text-[10px] font-medium text-text-muted/60 uppercase tracking-wider">
            {t(BUCKET_KEYS[bucket])}
          </div>
          <div className="flex flex-col">
            {items.map((entry) => (
              <TimeRow
                key={entry.id}
                entry={entry}
                active={entry.id === selectedId}
                unread={!readIds[entry.id]}
                onClick={() => onSelect(entry.id)}
              />
            ))}
          </div>
        </div>
      ))}
    </>
  )
}

/** Row in the flat time feed — carries the workspace label (no cluster
 *  header to provide it). */
function TimeRow({
  entry, active, unread, onClick,
}: {
  entry: InboxEntry
  active: boolean
  unread: boolean
  onClick: () => void
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onClick()
        }
      }}
      className={`group relative flex min-h-14 flex-col gap-0.5 px-3 py-2 cursor-pointer transition-colors outline-none focus-visible:bg-bg-tertiary/70 ${
        active ? 'bg-bg-tertiary' : 'hover:bg-bg-tertiary/50'
      }`}
    >
      {active && (
        <span aria-hidden className="absolute left-0 top-0 bottom-0 w-[2px] bg-accent" />
      )}

      {/* Line 1: unread dot · workspace · time */}
      <div className="flex items-center gap-1.5">
        <span
          aria-hidden
          className={`shrink-0 w-1.5 h-1.5 rounded-full ${unread ? 'bg-accent' : 'bg-transparent'}`}
        />
        <span className={`flex-1 truncate text-[12px] ${unread ? 'font-medium text-text' : 'text-text'}`}>
          {entry.workspaceLabel ?? entry.workspaceId}
        </span>
        <span className="shrink-0 text-[10px] text-text-muted/60 tabular-nums">
          {formatRelativeTime(entry.ts)}
        </span>
      </div>

      {/* Line 2: preview */}
      <div className={`pl-3 text-[11px] truncate ${unread ? 'text-text-muted' : 'text-text-muted/70'}`}>
        {previewForEntry(entry)}
      </div>
    </div>
  )
}

// ==================== Date bucketing (time view) ====================

type Bucket = 'Today' | 'Yesterday' | 'This week' | 'Older'

const BUCKET_KEYS = {
  Today: 'inbox.dateToday',
  Yesterday: 'inbox.dateYesterday',
  'This week': 'inbox.dateThisWeek',
  Older: 'inbox.dateOlder',
} as const satisfies Record<Bucket, string>

function groupByBucket(entries: readonly InboxEntry[]): Array<[Bucket, InboxEntry[]]> {
  const now = Date.now()
  const startOfDay = new Date(now)
  startOfDay.setHours(0, 0, 0, 0)
  const today = startOfDay.getTime()
  const yesterday = today - 86_400_000
  const weekStart = today - 6 * 86_400_000

  const buckets: Record<Bucket, InboxEntry[]> = {
    Today: [],
    Yesterday: [],
    'This week': [],
    Older: [],
  }

  for (const e of entries) {
    if (e.ts >= today) buckets.Today.push(e)
    else if (e.ts >= yesterday) buckets.Yesterday.push(e)
    else if (e.ts >= weekStart) buckets['This week'].push(e)
    else buckets.Older.push(e)
  }

  const order: Bucket[] = ['Today', 'Yesterday', 'This week', 'Older']
  return order
    .map((b): [Bucket, InboxEntry[]] => [b, buckets[b]])
    .filter(([, items]) => items.length > 0)
}
