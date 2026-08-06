import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { formatRelativeTime, getIntlLocale } from '../lib/intl'
import {
  Bot,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Download,
  FileCode2,
  FileText,
  ListChecks,
  MessageSquare,
  Paperclip,
  Terminal,
  Trash2,
} from 'lucide-react'
import { PageHeader } from '../components/PageHeader'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Skeleton } from '../components/StateViews'
import { MarkdownContent } from '../components/MarkdownContent'
import { FileContentView } from '../components/FileContentView'
import { InboxReplyThread } from '../components/InboxReplyThread'
import { api } from '../api'
import { inboxLive, refreshInbox, removeInboxAfterDelete } from '../live/inbox'
import { useInboxSelection } from '../live/inbox-selection'
import { useInboxRead } from '../live/inbox-read'
import { useIssues } from '../hooks/useIssues'
import { useWorkspace } from '../tabs/store'
import { useWorkspaces } from '../contexts/workspaces-context'
import { readWorkspaceFile, type ReadFileResult } from '../components/workspace/api'
import { workspaceDisplayName, workspaceDisplayTitle } from '../components/workspace/display'
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
 * pane shows just that one: its message first, compact attachments second,
 * then one conversation surface that can either ask the sender in the
 * background or open the same Session interactively.
 *
 * Selection (an entryId) is owned by `useInboxSelection`; the sidebar
 * drives it and marks the entry read on select. Confirmed Delete (header
 * trash + page-level Delete/Backspace) advances selection to the next entry.
 */
export function InboxPage({ visible }: InboxPageProps) {
  const { t } = useTranslation()
  const entries = inboxLive.useStore((s) => s.entries)
  const loading = inboxLive.useStore((s) => s.loading)
  const selectedId = useInboxSelection((s) => s.selectedEntryId)
  const select = useInboxSelection((s) => s.select)
  const markRead = useInboxRead((s) => s.markRead)
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const selected = entries.find((e) => e.id === selectedId) ?? null
  const pendingDelete = entries.find((e) => e.id === pendingDeleteId) ?? null

  /** Hard-delete an entry. The durable DELETE must succeed before the UI
   *  removes anything: a failed destructive action should keep both the
   *  entry and its confirmation available for a retry, not briefly mimic
   *  success until the next Inbox refresh restores the entry. */
  const handleDelete = useCallback(async (id: string): Promise<boolean> => {
    const idx = entries.findIndex((e) => e.id === id)
    if (idx < 0) return false
    setDeleteError(null)

    // entries is newest-first; the "next" one is the next older entry.
    // Fall back to the previous (newer) if we deleted the tail.
    const nextId = entries[idx + 1]?.id ?? entries[idx - 1]?.id ?? null

    try {
      await api.inbox.delete(id)
    } catch {
      setDeleteError(t('inbox.deleteFailed'))
      refreshInbox()
      return false
    }

    removeInboxAfterDelete(id)
    if (nextId) {
      select(nextId)
      markRead(nextId)
    } else {
      select(null)
    }
    refreshInbox()
    return true
  }, [entries, select, markRead, t])

  const requestDelete = useCallback((id: string) => {
    setDeleteError(null)
    setPendingDeleteId(id)
  }, [])

  // Delete / Backspace shortcut. Gated on `visible` (background inbox
  // tabs must not intercept) and on a selected entry existing. The
  // shortcut requests confirmation rather than deleting durable Inbox
  // history immediately.
  useEffect(() => {
    if (!visible) return
    if (!selectedId) return
    function onKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key !== 'Delete' && e.key !== 'Backspace') return
      e.preventDefault()
      requestDelete(selectedId!)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [visible, selectedId, requestDelete])

  return (
    <>
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
            <div className="px-6 py-8 text-muted-foreground text-sm">
              {t('inbox.selectFromSidebar')}
            </div>
          ) : (
            <Detail
              key={selected.id}
              entry={selected}
              onDelete={() => requestDelete(selected.id)}
            />
          )}
        </div>
      </div>
      {pendingDelete && (
        <ConfirmDialog
          title={t('inbox.deleteConfirmTitle')}
          message={(
            <div className="space-y-3">
              <p>{t('inbox.deleteConfirmMessage', {
                workspace: pendingDelete.workspaceLabel ?? pendingDelete.workspaceId,
              })}</p>
              {deleteError && (
                <p
                  role="alert"
                  className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-destructive"
                >
                  {deleteError}
                </p>
              )}
            </div>
          )}
          confirmLabel={t('common.delete')}
          cancelLabel={t('common.cancel')}
          workingLabel={t('inbox.deleting')}
          onConfirm={async () => {
            const deleted = await handleDelete(pendingDelete.id)
            if (!deleted) return
            setDeleteError(null)
            setPendingDeleteId(null)
          }}
          onClose={() => {
            setDeleteError(null)
            setPendingDeleteId(null)
          }}
        />
      )}
    </>
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
      <div className="text-[15px] text-foreground mb-2">{t('inbox.noMessages')}</div>
      <p className="text-[13px] text-muted-foreground leading-relaxed">
        Workspaces push updates here as they work — finished analysis,
        blocked tasks, questions back to you. An agent surfaces one by
        calling the
        <code className="mx-1 px-1 py-0.5 rounded bg-muted text-[11px]">inbox_push</code>
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
  const displayLabel = aliveWorkspace
    ? workspaceDisplayName(aliveWorkspace)
    : entry.workspaceLabel ?? entry.workspaceId
  const displayTitle = aliveWorkspace ? workspaceDisplayTitle(aliveWorkspace) : displayLabel

  const openOrFocus = useWorkspace((s) => s.openOrFocus)
  const setSidebar = useWorkspace((s) => s.setSidebar)

  // Origin breadcrumb — the run/issue this push came from (server-stamped,
  // agent-invisible). A scheduled issue gives a navigable "from Issue …"
  // breadcrumb; a bare headless run only gets a lighter, non-navigable marker
  // (there's no per-run detail surface to open).
  const origin = entry.origin
  const issueId = origin?.issueId
  const senderSignature = origin?.resumeId ? `@${origin.resumeId}` : null
  const senderLabel = [origin?.agent, senderSignature].filter(Boolean).join(' · ') || null
  const senderDisplay = origin?.agent ?? (senderSignature ? t('inbox.senderSession') : null)
  // Interactive provenance — the human-attended session this push came from
  // (server-stamped from AQ_SESSION_ID, validated against the session registry).
  // Navigable: opens/focuses that exact session tab.
  const sessionId = origin?.kind === 'interactive' ? origin.sessionId : undefined
  const sessionRecord = sessionId
    ? aliveWorkspace?.sessions.find((session) => session.id === sessionId) ?? null
    : null
  const hasHeadlessOrigin = origin?.kind === 'headless' && !!(origin.resumeId || origin.runId)
  const hasSenderIdentity = !!(origin?.resumeId || origin?.runId || origin?.sessionId)
  const [continuing, setContinuing] = useState(false)
  const [continueError, setContinueError] = useState<string | null>(null)
  const [senderPopoverOpen, setSenderPopoverOpen] = useState(false)
  const senderTriggerRef = useRef<HTMLButtonElement>(null)
  // Resolve the issue id (a filename stem) to its display title via the warm,
  // process-cached board snapshot — a cheap path (no extra fetch on the hot
  // line). Falls back to the stem when the board hasn't resolved it.
  const { data: issueBoard } = useIssues()
  const issueTitle = useMemo(() => {
    if (!issueId) return null
    const ws = issueBoard?.workspaces.find((w) => w.wsId === entry.workspaceId)
    return ws?.issues.find((i) => i.id === issueId)?.title ?? null
  }, [issueBoard, entry.workspaceId, issueId])

  useEffect(() => {
    setSenderPopoverOpen(false)
  }, [entry.id])

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

  const continueOrigin = async () => {
    if (!wsAlive) return
    setContinueError(null)
    setContinuing(true)
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
        setSidebar('chat')
        if (sessionRecord.state === 'paused') {
          await workspacesCtx.resumeSession(entry.workspaceId, sessionId, 'chat')
        } else {
          openOrFocus({
            kind: 'workspace',
            params: { wsId: entry.workspaceId, sessionId, source: 'chat' },
          })
        }
      } else {
        openWorkspace()
      }
      setSenderPopoverOpen(false)
    } catch (err) {
      setContinueError(err instanceof Error ? err.message : String(err))
    } finally {
      setContinuing(false)
    }
  }

  const canContinueOrigin = hasHeadlessOrigin || !!sessionRecord
  const loadInquiries = useCallback(
    () => api.inquiries.forInbox(entry.id),
    [entry.id],
  )
  const askInbox = useCallback(
    (prompt: string) => api.inquiries.askInbox(entry.id, prompt),
    [entry.id],
  )

  return (
    <div className="mx-auto max-w-[920px] px-4 py-6 md:px-8 md:py-8">
      {/* Provenance is identity, not a third way to open the same Session. */}
      <header className="mb-5 border-b border-border/70 pb-3">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
              <span
                className={`text-[14px] font-semibold ${
                  wsAlive ? 'text-foreground' : 'text-muted-foreground/70 line-through'
                }`}
                title={wsAlive ? displayTitle : t('inbox.workspaceNotExists')}
              >
                {displayLabel}
              </span>
              {senderLabel && senderDisplay && (
                <span className="inline-flex min-w-0 items-center">
                  <ChevronRight size={11} className="mr-1 shrink-0 text-muted-foreground/35" aria-hidden />
                  <Popover open={senderPopoverOpen} onOpenChange={setSenderPopoverOpen}>
                    <PopoverTrigger
                      render={<button
                        ref={senderTriggerRef}
                        type="button"
                        aria-label={t('inbox.showSenderDetails', { sender: senderDisplay })}
                        className="inline-flex min-h-10 min-w-0 items-center gap-1.5 rounded-sm text-[11px] font-medium text-muted-foreground/75 underline decoration-border underline-offset-2 transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 sm:min-h-0"
                      />}
                    >
                        {origin?.kind === 'interactive'
                          ? <Terminal size={12} strokeWidth={1.75} className="shrink-0" aria-hidden />
                          : <Bot size={12} strokeWidth={1.75} className="shrink-0" aria-hidden />}
                        <span>{t('inbox.fromSender', { sender: senderDisplay })}</span>
                    </PopoverTrigger>
                    <PopoverContent
                      id={`inbox-sender-${entry.id}`}
                      role="dialog"
                      aria-label={t('inbox.senderIdentityTitle', { sender: senderLabel })}
                      align="start"
                      sideOffset={8}
                      initialFocus={false}
                      finalFocus={senderTriggerRef}
                      className="z-30 w-72 max-w-[calc(100vw-3rem)] gap-0 rounded-xl border border-border/70 bg-secondary p-3 text-left shadow-lg ring-0"
                    >
                      <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/60">
                        {t('inbox.senderSession')}
                      </p>
                      {origin?.agent && (
                        <p className="mt-1 text-[12px] font-medium text-foreground">{origin.agent}</p>
                      )}
                      {senderSignature && (
                        <p className="mt-0.5 break-all font-mono text-[10px] leading-relaxed text-muted-foreground">
                          {senderSignature}
                        </p>
                      )}
                      {wsAlive && (
                        <button
                          type="button"
                          onClick={() => void continueOrigin()}
                          disabled={continuing}
                          className="oa-pressable mt-3 min-h-10 w-full rounded-lg bg-primary px-3 py-2 text-[11px] font-medium text-primary-foreground hover:bg-primary/90 disabled:cursor-wait disabled:opacity-50"
                        >
                          {continuing
                            ? t('inbox.continuingSession')
                            : canContinueOrigin
                              ? t('inbox.openConversation')
                              : t('inbox.openWorkspace')}
                        </button>
                      )}
                    </PopoverContent>
                  </Popover>
                </span>
              )}
              {issueId && (
                <button
                  type="button"
                  onClick={openIssue}
                  title={t('inbox.fromIssueTitle', { issue: issueId })}
                  className="oa-pressable inline-flex min-h-10 min-w-0 items-center gap-1 rounded-md px-1.5 py-1 text-left text-[11px] text-muted-foreground/75 hover:bg-primary/10 hover:text-primary sm:min-h-0 sm:py-0.5"
                >
                  <ListChecks size={12} strokeWidth={1.75} className="shrink-0" />
                  <span className="min-w-0 break-words sm:max-w-[220px] sm:truncate">
                    {t('inbox.fromIssue', { issue: issueTitle ?? issueId })}
                  </span>
                </button>
              )}
            </div>
            <div className="mt-1.5 text-[11px] tabular-nums text-muted-foreground/55">
              {formatAbsolute(entry.ts)}
              <span className="mx-1.5 text-muted-foreground/30">·</span>
              {formatRelativeTime(entry.ts)}
            </div>
          </div>
          <div className="-mr-1 flex shrink-0 items-center gap-1">
            {wsAlive && !senderLabel && (
              <button
                type="button"
                onClick={() => void continueOrigin()}
                disabled={continuing}
                className="oa-pressable inline-flex h-10 items-center justify-center gap-1.5 rounded-lg border border-border bg-background px-2 text-[11px] font-medium text-muted-foreground hover:border-primary/35 hover:text-primary disabled:cursor-not-allowed disabled:opacity-45 sm:h-8 sm:px-2.5"
                title={canContinueOrigin ? t('inbox.openConversation') : t('inbox.openWorkspace')}
                aria-label={canContinueOrigin ? t('inbox.openConversation') : t('inbox.openWorkspace')}
              >
                {canContinueOrigin
                  ? <Terminal size={13} strokeWidth={1.75} aria-hidden />
                  : <MessageSquare size={13} strokeWidth={1.75} aria-hidden />}
                <span className="hidden sm:inline">
                  {continuing
                    ? t('inbox.continuingSession')
                    : canContinueOrigin
                      ? t('inbox.openConversation')
                      : t('inbox.openWorkspace')}
                </span>
                <span className="sm:hidden">
                  {canContinueOrigin ? t('inbox.openConversationShort') : t('inbox.openWorkspaceShort')}
                </span>
              </button>
            )}
            <button
              type="button"
              onClick={onDelete}
              className="oa-pressable inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-border bg-background text-muted-foreground/55 hover:border-destructive/30 hover:bg-destructive/10 hover:text-destructive sm:h-8 sm:w-8 sm:border-transparent sm:bg-transparent"
              title={t('inbox.deleteEntryTitle')}
              aria-label={t('inbox.deleteEntryAriaLabel')}
            >
              <Trash2 size={14} strokeWidth={1.75} />
            </button>
          </div>
        </div>
      </header>
      {continueError && <div className="-mt-3 mb-5 text-[12px] text-destructive">{continueError}</div>}

      {/* The sender's message is the Inbox asset's primary content. */}
      {hasComments && (
        <div className="text-[15px] leading-relaxed text-foreground/90">
          <MarkdownContent
            text={entry.comments!}
            strikethrough={false}
            codeSpanWikilinks
            className="leading-relaxed text-foreground/90"
          />
        </div>
      )}

      {hasDocs && (
        <section className={hasComments ? 'mt-7' : ''}>
          <div className="mb-2.5 flex items-center gap-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground/55">
            <Paperclip size={12} aria-hidden />
            {t('inbox.documentsSection')}
            <span className="font-normal tabular-nums text-muted-foreground/40">{entry.docs!.length}</span>
          </div>
          <div className="space-y-2">
            {entry.docs!.map((doc) => (
              <InboxAttachment
                key={doc.path}
                workspaceId={entry.workspaceId}
                doc={doc}
                defaultExpanded={!hasComments}
              />
            ))}
          </div>
        </section>
      )}

      {wsAlive ? (
        <InboxReplyThread
          sender={origin?.agent ?? senderSignature ?? displayLabel}
          hasExactSender={hasSenderIdentity}
          load={loadInquiries}
          ask={askInbox}
        />
      ) : (
        <div className="mt-8 border-t border-border/50 pt-4 text-[12px] italic text-muted-foreground/60">
          {t('inbox.cannotReplyWorkspaceGone')}
        </div>
      )}
    </div>
  )
}

// ==================== Attachment (live fetch from workspace) ====================

export function InboxAttachment({
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

  // Fetch on mount so the compact row can show type/size immediately. The
  // actual content stays hidden until the user asks to preview the asset.
  useEffect(() => {
    let cancelled = false
    setResult(null)
    readWorkspaceFile(workspaceId, doc.path).then((r) => {
      if (!cancelled) setResult(r)
    })
    return () => { cancelled = true }
  }, [workspaceId, doc.path])

  const markdownActionsAvailable = isMarkdownPath(doc.path) && result?.kind === 'ok'
  const name = fileNameFromPath(doc.path) || doc.path
  const directory = fileDirectoryFromPath(doc.path)
  const isHtml = /\.html$/i.test(doc.path)
  const fileKind = isHtml
    ? t('inbox.docTypeHtml')
    : isMarkdownPath(doc.path)
      ? t('inbox.docTypeMarkdown')
      : fileExtension(doc.path)
  const size = result?.kind === 'ok'
    ? formatBytes(new TextEncoder().encode(result.content).byteLength)
    : result?.kind === 'too_large'
      ? formatBytes(result.sizeBytes)
      : null

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

  return (
    <div
      className={`group overflow-hidden rounded-xl border bg-background/55 transition-colors ${expanded ? 'border-primary/25' : 'border-border hover:border-muted-foreground/35'}`}
      title={doc.revision ? t('inbox.docRevisionTitle', { revision: doc.revision }) : undefined}
    >
      <div className="flex min-w-0 items-center gap-1">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          aria-label={t(expanded ? 'inbox.docCollapseAria' : 'inbox.docExpandAria', { name })}
          className="oa-pressable flex min-w-0 flex-1 items-center gap-3 px-3 py-2.5 text-left"
        >
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted/70 text-muted-foreground/70">
            {isHtml
              ? <FileCode2 size={15} strokeWidth={1.75} aria-hidden />
              : <FileText size={15} strokeWidth={1.75} aria-hidden />}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[12px] font-medium text-foreground/90">{name}</span>
            <span className="mt-0.5 block truncate font-mono text-[10px] text-muted-foreground/50">
              {directory || t('inbox.workspaceRoot')}
            </span>
          </span>
          <span className="hidden shrink-0 items-center gap-1.5 text-[10px] text-muted-foreground/50 sm:flex">
            <span>{fileKind}</span>
            {size && <><span className="text-muted-foreground/25">·</span><span>{size}</span></>}
          </span>
          <ChevronDown
            size={14}
            strokeWidth={1.75}
            aria-hidden
            className={`shrink-0 text-muted-foreground/50 transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`}
          />
        </button>
        {isMarkdownPath(doc.path) && (
          <div className="flex shrink-0 items-center gap-0.5 border-l border-border/60 px-1 sm:px-2">
            <button
              type="button"
              onClick={copyMarkdown}
              disabled={!markdownActionsAvailable}
              title={copied ? t('inbox.docCopiedMarkdown') : t('inbox.docCopyMarkdown')}
              aria-label={copied ? t('inbox.docCopiedMarkdown') : t('inbox.docCopyMarkdown')}
              className="oa-pressable inline-flex h-10 w-10 items-center justify-center rounded-md text-muted-foreground/55 hover:bg-muted hover:text-primary disabled:cursor-default disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-muted-foreground/55 sm:h-7 sm:w-7"
            >
              {copied ? <Check size={14} strokeWidth={2} /> : <Copy size={14} strokeWidth={1.75} />}
            </button>
            <button
              type="button"
              onClick={downloadMarkdown}
              disabled={!markdownActionsAvailable}
              title={t('inbox.docDownloadMarkdown')}
              aria-label={t('inbox.docDownloadMarkdown')}
              className="oa-pressable inline-flex h-10 w-10 items-center justify-center rounded-md text-muted-foreground/55 hover:bg-muted hover:text-primary disabled:cursor-default disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-muted-foreground/55 sm:h-7 sm:w-7"
            >
              <Download size={14} strokeWidth={1.75} />
            </button>
          </div>
        )}
      </div>
      {expanded && (
        <div className="oa-disclosure-enter border-t border-border/60 bg-background px-3 py-3 sm:px-4">
          {result === null ? (
            <div className="py-3 text-center text-[12px] text-muted-foreground">{t('common.loading')}</div>
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

function fileDirectoryFromPath(path: string): string {
  const normalized = path.replace(/\\/g, '/')
  const index = normalized.lastIndexOf('/')
  return index > 0 ? normalized.slice(0, index) : ''
}

function fileExtension(path: string): string {
  const name = fileNameFromPath(path)
  const index = name.lastIndexOf('.')
  return index > 0 ? name.slice(index + 1).toUpperCase() : 'FILE'
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
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

// ==================== Date formatting ====================

function formatAbsolute(ts: number): string {
  return new Date(ts).toLocaleString(getIntlLocale(), {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}
