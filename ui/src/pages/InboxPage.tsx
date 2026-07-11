import { useCallback, useEffect, useMemo, useState, type MouseEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { formatRelativeTime, getIntlLocale } from '../lib/intl'
import { ArrowRight, Bot, Check, ChevronRight, Copy, Download, ListChecks, MessageSquare, Terminal, Trash2 } from 'lucide-react'
import { PageHeader } from '../components/PageHeader'
import { Skeleton } from '../components/StateViews'
import { MarkdownContent } from '../components/MarkdownContent'
import { FileContentView } from '../components/FileContentView'
import { api } from '../api'
import { inboxLive, refreshInbox, removeInboxOptimistically } from '../live/inbox'
import { useInboxSelection } from '../live/inbox-selection'
import { useInboxRead } from '../live/inbox-read'
import { useIssues } from '../hooks/useIssues'
import { useWorkspace } from '../tabs/store'
import { useWorkspaces } from '../contexts/workspaces-context'
import { readWorkspaceFile, type ReadFileResult } from '../components/workspace/api'
import type { InboxEntry, InboxDoc } from '../api/inbox'

interface InboxPageProps {
  /** Gates the page-level Delete/Backspace shortcut so background
   *  inbox tabs don't intercept the keypress. */
  visible: boolean
}

/**
 * Inbox detail pane — renders a **single selected push**. The sidebar
 * clusters pushes by workspace (visual kinship) but each push stays its
 * own entry, because a workspace's pushes are usually unrelated topics
 * (we have no Issue layer to make them one thread) — merging them into a
 * combined timeline read badly. So selection is a single entry, and this
 * pane shows just that one: its docs (collapsed attachment cards) above
 * its comment (markdown body), with a reply bar that returns to the exact
 * source Session when provenance is available and falls back to the Workspace.
 *
 * Selection (an entryId) is owned by `useInboxSelection`; the sidebar
 * drives it and marks the entry read on select. Delete (header trash +
 * page-level Delete/Backspace) advances selection to the next entry.
 */
export function InboxPage({ visible }: InboxPageProps) {
  const { t } = useTranslation()
  const entries = inboxLive.useStore((s) => s.entries)
  const loading = inboxLive.useStore((s) => s.loading)
  const selectedId = useInboxSelection((s) => s.selectedEntryId)
  const select = useInboxSelection((s) => s.select)
  const markRead = useInboxRead((s) => s.markRead)

  const selected = entries.find((e) => e.id === selectedId) ?? null

  /** Hard-delete an entry. Optimistically removes it, advances selection
   *  to the next-older entry (or previous if last), fires the DELETE,
   *  then refreshes to reconcile with the server. */
  const handleDelete = useCallback(async (id: string) => {
    const idx = entries.findIndex((e) => e.id === id)
    if (idx < 0) return

    // entries is newest-first; the "next" one is the next older entry.
    // Fall back to the previous (newer) if we deleted the tail.
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
      // best-effort — refreshInbox below reconciles if the server disagreed.
    }
    refreshInbox()
  }, [entries, select, markRead])

  // Delete / Backspace shortcut. Gated on `visible` (background inbox
  // tabs must not intercept) and on a selected entry existing.
  useEffect(() => {
    if (!visible) return
    if (!selectedId) return
    function onKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key !== 'Delete' && e.key !== 'Backspace') return
      e.preventDefault()
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
          <InboxLoadingSkeleton />
        ) : entries.length === 0 ? (
          <EmptyState />
        ) : !selected ? (
          <div className="px-6 py-8 text-text-muted text-sm">
            {t('inbox.selectFromSidebar')}
          </div>
        ) : (
          <Detail
            key={selected.id}
            entry={selected}
            onDelete={() => handleDelete(selected.id)}
          />
        )}
      </div>
    </div>
  )
}

function InboxLoadingSkeleton() {
  return (
    <div aria-hidden="true" className="px-6 py-4">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="py-3 border-b border-border/40">
          <Skeleton className="h-4 w-2/3 rounded mb-2" />
          <Skeleton className="h-3 w-2/5 rounded" />
        </div>
      ))}
    </div>
  )
}

function EmptyState() {
  const { t } = useTranslation()
  return (
    <div className="px-6 py-16 text-center max-w-[520px] mx-auto">
      <div className="text-[15px] text-text mb-2">{t('inbox.noMessages')}</div>
      <p className="text-[13px] text-text-muted leading-relaxed">
        Workspaces push updates here as they work — finished analysis,
        blocked tasks, questions back to you. An agent surfaces one by
        calling the
        <code className="mx-1 px-1 py-0.5 rounded bg-bg-tertiary text-[11px]">inbox_push</code>
        tool from inside its workspace. Nothing to read yet.
      </p>
    </div>
  )
}

// ==================== Detail (single push) ====================

function Detail({ entry, onDelete }: { entry: InboxEntry; onDelete: () => void }) {
  const { t } = useTranslation()
  const hasDocs = (entry.docs?.length ?? 0) > 0
  const hasComments = (entry.comments ?? '').trim().length > 0

  // Workspace liveness — drives whether the jump-to-workspace affordance
  // is enabled. A deleted workspace's inbox entry stays as a record but
  // has nowhere to navigate to.
  const workspacesCtx = useWorkspaces()
  const { workspaces } = workspacesCtx
  const aliveWorkspace = workspaces.find((w) => w.id === entry.workspaceId) ?? null
  const wsAlive = aliveWorkspace !== null
  const displayLabel = aliveWorkspace?.tag ?? entry.workspaceLabel ?? entry.workspaceId

  const openOrFocus = useWorkspace((s) => s.openOrFocus)
  const setSidebar = useWorkspace((s) => s.setSidebar)

  // Origin breadcrumb — the run/issue this push came from (server-stamped,
  // agent-invisible). A scheduled issue gives a navigable "from Issue …"
  // breadcrumb; a bare headless run only gets a lighter, non-navigable marker
  // (there's no per-run detail surface to open).
  const origin = entry.origin
  const issueId = origin?.issueId
  // Interactive provenance — the human-attended session this push came from
  // (server-stamped from AQ_SESSION_ID, validated against the session registry).
  // Navigable: opens/focuses that exact session tab.
  const sessionId = origin?.kind === 'interactive' ? origin.sessionId : undefined
  const sessionRecord = sessionId
    ? aliveWorkspace?.sessions.find((session) => session.id === sessionId) ?? null
    : null
  const [continuing, setContinuing] = useState(false)
  const [continueError, setContinueError] = useState<string | null>(null)
  // Resolve the issue id (a filename stem) to its display title via the warm,
  // process-cached board snapshot — a cheap path (no extra fetch on the hot
  // line). Falls back to the stem when the board hasn't resolved it.
  const { data: issueBoard } = useIssues()
  const issueTitle = useMemo(() => {
    if (!issueId) return null
    const ws = issueBoard?.workspaces.find((w) => w.wsId === entry.workspaceId)
    return ws?.issues.find((i) => i.id === issueId)?.title ?? null
  }, [issueBoard, entry.workspaceId, issueId])

  const openWorkspace = () => {
    if (!wsAlive) return
    // Switch the sidebar to Workspaces so the user sees the sessions list
    // alongside the workspace tab (analogue to "open the issue then IM in
    // chat" — they need both views).
    setSidebar('workspaces')
    openOrFocus({ kind: 'workspace', params: { wsId: entry.workspaceId } })
  }

  const openIssue = () => {
    if (!issueId) return
    setSidebar('issue')
    openOrFocus({ kind: 'issue-detail', params: { wsId: entry.workspaceId, id: issueId } })
  }

  // Jump to the originating interactive session — reuses the same
  // workspace-tab open/focus wiring as the reply bar, pinned to the session id
  // (WorkspaceView focuses the matching session record). Switch the sidebar to
  // Workspaces so the sessions list shows alongside the tab.
  const openSession = () => {
    if (!wsAlive || !sessionId || !sessionRecord) return
    setSidebar('workspaces')
    if (sessionRecord.state === 'paused') {
      void workspacesCtx.resumeSession(entry.workspaceId, sessionId).catch((err) =>
        setContinueError(err instanceof Error ? err.message : String(err)),
      )
      return
    }
    openOrFocus({ kind: 'workspace', params: { wsId: entry.workspaceId, sessionId } })
  }

  const continueOrigin = async () => {
    if (!wsAlive) return
    setContinueError(null)
    setContinuing(true)
    setSidebar('workspaces')
    try {
      if (origin?.kind === 'headless' && (origin.resumeId || origin.runId)) {
        // Legacy Inbox JSONL stored only taskId. Runs are retained, so one
        // lookup upgrades that provenance to resumeId without exposing the
        // native runtime session id.
        const resumeId = origin.resumeId ?? (await api.headless.get(origin.runId!)).resumeId
        await workspacesCtx.openHeadlessRun(entry.workspaceId, resumeId, {
          ...(entry.comments ? { title: entry.comments.slice(0, 200) } : {}),
        })
      } else if (sessionId && sessionRecord) {
        if (sessionRecord.state === 'paused') {
          await workspacesCtx.resumeSession(entry.workspaceId, sessionId)
        } else {
          openOrFocus({ kind: 'workspace', params: { wsId: entry.workspaceId, sessionId } })
        }
      } else {
        openWorkspace()
      }
    } catch (err) {
      setContinueError(err instanceof Error ? err.message : String(err))
    } finally {
      setContinuing(false)
    }
  }

  const hasHeadlessOrigin = origin?.kind === 'headless' && !!origin.runId
  const canContinueOrigin = hasHeadlessOrigin || !!sessionRecord

  return (
    <div className="max-w-[1040px] mx-auto py-6 px-4 md:px-8">
      {/* Header: workspace label · timestamp · delete. */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <span
          className={`text-[14px] font-medium ${
            wsAlive ? 'text-text' : 'text-text-muted/70 line-through'
          }`}
          title={wsAlive ? undefined : t('inbox.workspaceNotExists')}
        >
          {displayLabel}
        </span>

        {/* Origin — the run/issue this push came from. Navigable for a
         *  scheduled issue; a lighter marker for a bare headless run. */}
        {issueId && (
          <button
            type="button"
            onClick={openIssue}
            title={`From issue ${issueId}`}
            className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-text-muted/80 hover:text-accent hover:bg-accent/10 transition-colors"
          >
            <ListChecks size={12} strokeWidth={1.75} className="shrink-0" />
            <span className="truncate max-w-[220px]">from {issueTitle ?? issueId}</span>
          </button>
        )}
        {sessionId ? (
          <button
            type="button"
            onClick={openSession}
            disabled={!wsAlive || !sessionRecord}
            title={`From session ${sessionId}`}
            className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-text-muted/80 hover:text-accent hover:bg-accent/10 transition-colors disabled:opacity-50 disabled:hover:text-text-muted/80 disabled:hover:bg-transparent disabled:cursor-default"
          >
            <Terminal size={12} strokeWidth={1.75} className="shrink-0" />
            <span className="truncate max-w-[220px]">from session{origin?.agent ? ` · ${origin.agent}` : ''}</span>
          </button>
        ) : hasHeadlessOrigin ? (
          <button
            type="button"
            onClick={() => void continueOrigin()}
            disabled={!wsAlive || continuing}
            className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-text-muted/80 hover:text-accent hover:bg-accent/10 transition-colors disabled:opacity-50 disabled:hover:text-text-muted/80 disabled:hover:bg-transparent disabled:cursor-default"
            title={`From headless run ${origin.runId}`}
          >
            <Bot size={12} strokeWidth={1.75} className="shrink-0" />
            <span>from run{origin.agent ? ` · ${origin.agent}` : ''}</span>
          </button>
        ) : null}

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

      {/* Docs — collapsed attachment cards above the comment. */}
      {hasDocs && (
        <div>
          <div className="text-[11px] font-medium text-text-muted/60 uppercase tracking-wider mb-3">
            {t('inbox.documentsSection')}
          </div>
          <div className="space-y-3">
            {entry.docs!.map((doc) => (
              <DocBlock
                key={doc.path}
                workspaceId={entry.workspaceId}
                doc={doc}
                defaultExpanded={!hasComments}
              />
            ))}
          </div>
        </div>
      )}

      {/* Comment — the agent's voice; divider from the docs above. */}
      {hasComments && (
        <div className={`${hasDocs ? 'mt-6 pt-6 border-t border-border' : ''}`}>
          <MarkdownContent
            text={entry.comments!}
            strikethrough={false}
            codeSpanWikilinks
            className="leading-relaxed text-text/90"
          />
        </div>
      )}

      {/* Follow-up bar — exact originating Session when available; Workspace
       * fallback for legacy/manual entries without Session provenance. */}
      <div className="mt-6">
        {wsAlive ? (
          <button
            type="button"
            onClick={() => void continueOrigin()}
            disabled={continuing}
            className="w-full flex items-center gap-3 px-4 py-3 rounded-lg border border-border bg-bg-tertiary/40 hover:bg-bg-tertiary hover:border-accent/40 transition-colors text-left group"
          >
            {canContinueOrigin
              ? <Terminal size={15} strokeWidth={1.75} className="shrink-0 text-text-muted/70 group-hover:text-accent transition-colors" />
              : <MessageSquare size={15} strokeWidth={1.75} className="shrink-0 text-text-muted/70 group-hover:text-accent transition-colors" />}
            <span className="flex-1 text-[13px] text-text-muted/80 group-hover:text-text transition-colors">
              {continuing
                ? t('inbox.continuingSession')
                : hasHeadlessOrigin
                  ? t('inbox.continueRun')
                  : sessionRecord
                    ? t('inbox.continueSession')
                    : t('inbox.replyInWorkspace', { label: displayLabel })}
            </span>
            <ArrowRight size={15} strokeWidth={1.75} className="shrink-0 text-text-muted/60 group-hover:text-accent group-hover:translate-x-0.5 transition-all" />
          </button>
        ) : (
          <div className="px-4 py-3 text-[12px] text-text-muted/60 italic border-t border-border/40 pt-4">
            {t('inbox.cannotReplyWorkspaceGone')}
          </div>
        )}
        {continueError && (
          <div className="mt-2 text-[12px] text-red">{continueError}</div>
        )}
      </div>

      <div className="mt-4 text-[11px] text-text-muted/40 font-mono">
        workspace: {entry.workspaceId}
      </div>
    </div>
  )
}

// ==================== Doc block (live fetch from workspace) ====================

function DocBlock({
  workspaceId, doc, defaultExpanded,
}: {
  workspaceId: string
  doc: InboxDoc
  defaultExpanded: boolean
}) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(defaultExpanded)
  const [result, setResult] = useState<ReadFileResult | null>(null)
  const [copied, setCopied] = useState(false)

  // Fetch on mount: the collapsed card shows a text preview, so we need the
  // content up front. The same `result` then renders in full on expand —
  // one fetch serves both states.
  useEffect(() => {
    let cancelled = false
    setResult(null)
    readWorkspaceFile(workspaceId, doc.path).then((r) => {
      if (!cancelled) setResult(r)
    })
    return () => { cancelled = true }
  }, [workspaceId, doc.path])

  const preview = useMemo(() => buildDocPreview(result), [result])
  const markdownActionsAvailable = isMarkdownPath(doc.path) && result?.kind === 'ok'

  const copyMarkdown = async (e: MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation()
    if (!markdownActionsAvailable) return
    try {
      await copyText(result.content)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1400)
    } catch {
      setCopied(false)
    }
  }

  const downloadMarkdown = (e: MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation()
    if (!markdownActionsAvailable) return
    const blob = new Blob([result.content], { type: 'text/markdown;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = fileNameFromPath(doc.path) || 'report.md'
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }

  const header = (
    <div className="flex items-center gap-1 bg-bg-tertiary/25 hover:bg-bg-tertiary/50 transition-colors">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="min-w-0 flex-1 px-4 py-3 flex items-center gap-2.5 text-left"
      >
        <ChevronRight
          size={15}
          strokeWidth={2}
          aria-hidden
          className={`shrink-0 text-text-muted/70 transition-transform ${expanded ? 'rotate-90' : ''}`}
        />
        <span className="text-[12px]">📄</span>
        <span className="flex-1 truncate text-[12px] font-mono text-text-muted">{doc.path}</span>
        <span className="shrink-0 text-[10px] uppercase tracking-wider text-text-muted/45">
          {expanded ? t('inbox.docCollapse') : t('inbox.docExpand')}
        </span>
      </button>
      {isMarkdownPath(doc.path) && (
        <div className="shrink-0 flex items-center gap-1 pr-3">
          <button
            type="button"
            onClick={copyMarkdown}
            disabled={!markdownActionsAvailable}
            title={copied ? t('inbox.docCopiedMarkdown') : t('inbox.docCopyMarkdown')}
            aria-label={copied ? t('inbox.docCopiedMarkdown') : t('inbox.docCopyMarkdown')}
            className="inline-flex h-7 w-7 items-center justify-center rounded text-text-muted/65 transition-colors hover:bg-bg-tertiary hover:text-accent disabled:cursor-default disabled:opacity-35 disabled:hover:bg-transparent disabled:hover:text-text-muted/65"
          >
            {copied ? <Check size={14} strokeWidth={2} /> : <Copy size={14} strokeWidth={1.75} />}
          </button>
          <button
            type="button"
            onClick={downloadMarkdown}
            disabled={!markdownActionsAvailable}
            title={t('inbox.docDownloadMarkdown')}
            aria-label={t('inbox.docDownloadMarkdown')}
            className="inline-flex h-7 w-7 items-center justify-center rounded text-text-muted/65 transition-colors hover:bg-bg-tertiary hover:text-accent disabled:cursor-default disabled:opacity-35 disabled:hover:bg-transparent disabled:hover:text-text-muted/65"
          >
            <Download size={14} strokeWidth={1.75} />
          </button>
        </div>
      )}
    </div>
  )

  return (
    <div className="rounded-lg border border-border bg-bg/50 overflow-hidden">
      <div>
        {header}
        {/* Collapsed: a short text preview so the card reads as openable
         *  content rather than a bare filename. Hidden once expanded (the
         *  full render takes over below). */}
        {!expanded && (
          <button
            type="button"
            onClick={() => setExpanded(true)}
            className="block w-full text-left bg-bg-tertiary/25 hover:bg-bg-tertiary/50 transition-colors pl-11 pr-4 pb-3 -mt-1.5 text-[12px] leading-relaxed text-text-muted/70"
          >
            <span className="line-clamp-2">
            {result === null ? t('common.loading') : preview || t('inbox.docNoPreview')}
            </span>
          </button>
        )}
      </div>
      {expanded && (
        <div className="px-4 py-3 border-t border-border/50">
          {result === null ? (
            <div className="text-[12px] text-text-muted">{t('common.loading')}</div>
          ) : (
            <FileContentView path={doc.path} result={result} />
          )}
        </div>
      )}
    </div>
  )
}

function isMarkdownPath(path: string): boolean {
  return /\.(md|markdown|mdx)$/i.test(path)
}

function fileNameFromPath(path: string): string {
  return path.replace(/\\/g, '/').split('/').filter(Boolean).pop() ?? ''
}

async function copyText(text: string): Promise<void> {
  const clipboard = globalThis.navigator?.clipboard
  try {
    if (clipboard?.writeText) {
      await clipboard.writeText(text)
      return
    }
  } catch {
    // Fall through to the selection-based path below.
  }

  if (typeof document.execCommand !== 'function') {
    throw new Error('copy unavailable')
  }

  const ta = document.createElement('textarea')
  ta.value = text
  ta.setAttribute('readonly', '')
  ta.style.position = 'fixed'
  ta.style.left = '-9999px'
  ta.style.top = '0'
  document.body.appendChild(ta)
  ta.select()
  const ok = document.execCommand('copy')
  ta.remove()
  if (!ok) throw new Error('copy failed')
}

/** Build a short plain-text preview from a fetched doc, for the collapsed
 *  card. Takes the first couple of non-empty lines and strips the most
 *  common markdown leaders / inline markers so the snippet reads as prose.
 *  Returns '' for non-ok results (loading / missing / too-large) — the
 *  caller shows its own fallback. */
function buildDocPreview(result: ReadFileResult | null): string {
  if (!result || result.kind !== 'ok') return ''
  const strip = (s: string): string =>
    s
      .replace(/^#{1,6}\s+/, '')        // heading markers
      .replace(/^[>*\-+]\s+/, '')       // quote / list leaders
      .replace(/[*_`]/g, '')            // emphasis / code ticks
      .replace(/\[\[([^[\]]+)\]\]/g, '$1') // wikilinks → text
      .trim()
  const lines = result.content
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 2)
    .map(strip)
  // Single flowing snippet (title — first paragraph), clamped to 2 visual
  // lines by the caller. A separator beats a newline here: `-webkit-line-
  // clamp` leaves a faint sliver of a third line when fed hard breaks.
  const joined = lines.join(' — ')
  // ~100 chars keeps CJK-dense snippets within 2 lines, so the caller's
  // `line-clamp-2` rarely has to bite (its cut leaves a faint sliver).
  return joined.length > 100 ? joined.slice(0, 100).trimEnd() + '…' : joined
}

// ==================== Date formatting ====================

function formatAbsolute(ts: number): string {
  return new Date(ts).toLocaleString(getIntlLocale(), {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}
