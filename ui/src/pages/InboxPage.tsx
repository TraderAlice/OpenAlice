import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { formatRelativeTime } from '../lib/intl'
import { ArrowRight, MessageSquare, Trash2 } from 'lucide-react'
import { PageHeader } from '../components/PageHeader'
import { MarkdownContent } from '../components/MarkdownContent'
import { FileContentView } from '../components/FileContentView'
import { api } from '../api'
import { inboxLive, refreshInbox, removeInboxOptimistically } from '../live/inbox'
import { useInboxSelection } from '../live/inbox-selection'
import { useInboxRead } from '../live/inbox-read'
import { useWorkspace } from '../tabs/store'
import { useWorkspaces } from '../contexts/WorkspacesContext'
import { readWorkspaceFile, type ReadFileResult } from '../components/workspace/api'
import type { InboxEntry, InboxDoc } from '../api/inbox'

interface InboxPageProps {
  /** Gates the page-level Delete/Backspace shortcut so background
   *  inbox tabs don't intercept the keypress. */
  visible: boolean
}

/**
 * Inbox detail pane. Renders the selected entry's docs (live from
 * workspace) on top, comments (agent's markdown body) below — fixed
 * order, mirroring Linear's issue-body + activity layout.
 *
 * Selection is owned by `useInboxSelection`; the sidebar drives it.
 * Read-state mutation happens in the sidebar at selection time — this
 * pane just renders whatever is selected. Delete is owned here (both
 * the button in the Detail header and the Delete/Backspace shortcut)
 * because it needs access to the full entry list to advance selection
 * to the next entry after removal.
 */
export function InboxPage({ visible }: InboxPageProps) {
  const { t } = useTranslation()
  const entries = inboxLive.useStore((s) => s.entries)
  const loading = inboxLive.useStore((s) => s.loading)
  const selectedId = useInboxSelection((s) => s.selectedEntryId)
  const select = useInboxSelection((s) => s.select)
  const markRead = useInboxRead((s) => s.markRead)

  const selected = entries.find((e) => e.id === selectedId) ?? null

  /** Hard-delete an entry. Optimistically removes from local state,
   *  advances selection to the next-older entry (or previous if last),
   *  fires the DELETE request, then forces a refresh to reconcile with
   *  the server. Match Linear's "archive removes from view, focus
   *  advances" feel — no confirmation dialog. */
  const handleDelete = useCallback(async (id: string) => {
    const idx = entries.findIndex((e) => e.id === id)
    if (idx < 0) return

    // entries is sorted newest-first; "the one after this" is the next
    // older entry. Fall back to the previous (newer) if we deleted the
    // tail; null if the list becomes empty.
    const nextId = entries[idx + 1]?.id ?? entries[idx - 1]?.id ?? null

    removeInboxOptimistically(id)
    if (nextId) {
      select(nextId)
      markRead(nextId)
    } else {
      select(null)
    }

    try {
      await api.inbox.delete(id)
    } catch {
      // best-effort — refreshInbox below will reconcile if the server
      // disagreed (e.g. concurrent change re-introduced the entry).
    }
    refreshInbox()
  }, [entries, select, markRead])

  // Delete / Backspace shortcut. Gated on `visible` so a background
  // inbox tab doesn't intercept; gated on `selectedId` so the
  // keypress only fires when there's something to delete.
  useEffect(() => {
    if (!visible) return
    if (!selectedId) return
    function onKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key !== 'Delete' && e.key !== 'Backspace') return
      e.preventDefault()
      // selectedId is captured by the closure; safe to use.
      void handleDelete(selectedId!)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [visible, selectedId, handleDelete])

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <PageHeader
        title={t('nav.item.inbox')}
        description={t('inbox.pageDescription', { count: entries.length })}
      />
      <div className="flex-1 overflow-y-auto min-h-0">
        {loading && entries.length === 0 ? (
          <div className="px-6 py-8 text-text-muted text-sm">{t('common.loading')}</div>
        ) : entries.length === 0 ? (
          <EmptyState />
        ) : !selected ? (
          <div className="px-6 py-8 text-text-muted text-sm">
            {t('inbox.selectFromSidebar')}
          </div>
        ) : (
          <Detail entry={selected} onDelete={() => handleDelete(selected.id)} />
        )}
      </div>
    </div>
  )
}

function EmptyState() {
  const { t } = useTranslation()
  return (
    <div className="px-6 py-16 text-center max-w-[520px] mx-auto">
      <div className="text-[15px] text-text mb-2">{t('inbox.noMessages')}</div>
      <p className="text-[13px] text-text-muted leading-relaxed">
        Workspaces will push status updates here as they work — finished
        analysis, blocked tasks, questions back to you. The integration
        path is still being designed; for now you can seed entries via
        <code className="mx-1 px-1 py-0.5 rounded bg-bg-tertiary text-[11px]">POST /api/inbox/seed</code>
        for testing.
      </p>
    </div>
  )
}

function Detail({ entry, onDelete }: { entry: InboxEntry; onDelete: () => void }) {
  const { t } = useTranslation()
  const hasDocs = (entry.docs?.length ?? 0) > 0
  const hasComments = (entry.comments ?? '').trim().length > 0

  // Workspace liveness — drives whether the jump-to-workspace affordance
  // is enabled. A deleted workspace's inbox entry stays as a record but
  // has nowhere to navigate to.
  const { workspaces } = useWorkspaces()
  const aliveWorkspace = workspaces.find((w) => w.id === entry.workspaceId) ?? null
  const wsAlive = aliveWorkspace !== null
  const displayLabel = aliveWorkspace?.tag ?? entry.workspaceLabel ?? entry.workspaceId

  const openOrFocus = useWorkspace((s) => s.openOrFocus)
  const setSidebar = useWorkspace((s) => s.setSidebar)

  const openWorkspace = () => {
    if (!wsAlive) return
    // Switch the sidebar to Workspaces so the user sees the sessions list
    // alongside the workspace tab (analogue to "open the issue then IM in
    // chat" — they need both views).
    setSidebar('workspaces')
    openOrFocus({ kind: 'workspace', params: { wsId: entry.workspaceId } })
  }

  return (
    <div className="max-w-[820px] mx-auto py-6 px-4 md:px-8">
      {/* Header: workspace · timestamp · delete. Plain text label —
       *  the primary navigation affordance sits at the bottom of the
       *  comments thread (Linear-style reply input). Trash button is
       *  always visible, muted by default with accent-red on hover —
       *  Linear's archive affordance equivalent. Hard delete (no undo
       *  modal); keyboard parity via Delete / Backspace at the page
       *  level. */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <span
          className={`text-[14px] font-medium ${
            wsAlive ? 'text-text' : 'text-text-muted/70 line-through'
          }`}
          title={wsAlive ? undefined : t('inbox.workspaceNotExists')}
        >
          {displayLabel}
        </span>
        <span className="text-[11px] text-text-muted/70 tabular-nums ml-auto">
          {formatAbsolute(entry.ts)}
          <span className="mx-1.5 text-text-muted/40">·</span>
          {formatRelativeTime(entry.ts)}
        </span>
        <button
          type="button"
          onClick={onDelete}
          className="p-1 rounded text-text-muted/50 hover:text-red hover:bg-red/10 transition-colors"
          title={t('inbox.deleteEntryTitle')}
          aria-label={t('inbox.deleteEntryAriaLabel')}
        >
          <Trash2 size={14} strokeWidth={1.75} />
        </button>
      </div>

      {/* Docs — top, live render from workspace */}
      {hasDocs && (
        <div className="space-y-6">
          {entry.docs!.map((doc) => (
            <DocBlock key={doc.path} workspaceId={entry.workspaceId} doc={doc} />
          ))}
        </div>
      )}

      {/* Comments — bottom, agent's voice */}
      {hasComments && (
        <div className={`${hasDocs ? 'mt-8 pt-6 border-t border-border' : ''}`}>
          <div className="text-[11px] font-medium text-text-muted/60 uppercase tracking-wider mb-3">
            {t('inbox.commentsSection')}
          </div>
          <MarkdownContent text={entry.comments!} />
        </div>
      )}

      {/* Reply bar — the navigation entry point. Linear-style: a wide bar
       *  appended to the comments thread, visually styled like a chat
       *  input. The action isn't actually sending — clicking opens the
       *  workspace tab + switches the sidebar so the user can pick a
       *  session and chat back to the agent there. v2 could pre-fill the
       *  workspace chat input with whatever the user types here; for v1
       *  the bar is single-click navigation. */}
      <div className="mt-6">
        {wsAlive ? (
          <button
            type="button"
            onClick={openWorkspace}
            className="w-full flex items-center gap-3 px-4 py-3 rounded-lg border border-border bg-bg-tertiary/40 hover:bg-bg-tertiary hover:border-accent/40 transition-colors text-left group"
          >
            <MessageSquare size={15} strokeWidth={1.75} className="shrink-0 text-text-muted/70 group-hover:text-accent transition-colors" />
            <span className="flex-1 text-[13px] text-text-muted/80 group-hover:text-text transition-colors">
              {t('inbox.replyInWorkspace', { label: displayLabel })}
            </span>
            <ArrowRight size={15} strokeWidth={1.75} className="shrink-0 text-text-muted/60 group-hover:text-accent group-hover:translate-x-0.5 transition-all" />
          </button>
        ) : (
          <div className="px-4 py-3 text-[12px] text-text-muted/60 italic border-t border-border/40 pt-4">
            {t('inbox.cannotReplyWorkspaceGone')}
          </div>
        )}
      </div>

      <div className="mt-4 text-[11px] text-text-muted/40 font-mono">
        workspace: {entry.workspaceId}
      </div>
    </div>
  )
}

// ==================== Doc block (live fetch from workspace) ====================

function DocBlock({ workspaceId, doc }: { workspaceId: string; doc: InboxDoc }) {
  const { t } = useTranslation()
  const [result, setResult] = useState<ReadFileResult | null>(null)

  useEffect(() => {
    let cancelled = false
    setResult(null)
    readWorkspaceFile(workspaceId, doc.path).then((r) => {
      if (!cancelled) setResult(r)
    })
    return () => { cancelled = true }
  }, [workspaceId, doc.path])

  return (
    <div className="rounded-lg border border-border bg-bg/50">
      <div className="px-4 py-2 border-b border-border/50 flex items-center gap-2">
        <span className="text-[11px] text-text-muted/70">📄</span>
        <span className="text-[12px] font-mono text-text-muted">{doc.path}</span>
      </div>
      <div className="px-4 py-3">
        {result === null ? (
          <div className="text-[12px] text-text-muted">{t('common.loading')}</div>
        ) : (
          <FileContentView path={doc.path} result={result} />
        )}
      </div>
    </div>
  )
}

// ==================== Date formatting ====================

function formatAbsolute(ts: number): string {
  return new Date(ts).toLocaleString(undefined, {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

