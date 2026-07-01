/**
 * "Ask Alice" secondary sidebar — your chat history.
 *
 * Reads as a conversation list: a prominent "New chat" action on top (opens the
 * Ask Alice composer), then chat workspaces newest-first. Each workspace is a
 * day's bucket — daily ones (`chat-jun15`) are relabelled Today / Yesterday /
 * "Jun 14" so the list reads like chat history; user-named ones (`nvda-thesis`)
 * keep their tag. Sessions hang underneath as the day's individual
 * conversations, resumable on click.
 *
 * Named-workspace creation (a custom tag) lives in the Workspaces activity —
 * this surface is for chatting, not workspace management.
 */

import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, ChevronRight, FolderPlus, Plus, Settings as SettingsIcon, X } from 'lucide-react'

import { getIntlLocale } from '../../lib/intl'
import { useWorkspaces } from '../../contexts/workspaces-context'
import { Skeleton } from '../StateViews'
import { useWorkspace } from '../../tabs/store'
import { getFocusedTab } from '../../tabs/types'
import { ConfirmDialog } from '../ConfirmDialog'
import { deleteWorkspace, type SessionRecord, type Workspace } from './api'
import { CreateWorkspaceDialog } from './CreateWorkspaceDialog'
import { SessionRow } from './Sidebar'
import { workspaceDisplayTitle } from './display'

const CHAT_TEMPLATE = 'chat'

/** Auto-generated daily tag shape (`chat-jun15`) — these get a friendly date label. */
const DAILY_TAG_RE = /^chat-[a-z]{3}\d{1,2}$/

/** Friendly label for a chat workspace: Today / Yesterday / "Jun 14" for daily
 *  buckets, the raw tag for user-named workspaces. */
function chatLabel(w: Workspace, todayLabel: string, yesterdayLabel: string): string {
  if (!DAILY_TAG_RE.test(w.tag)) return w.tag
  const created = new Date(w.createdAt)
  if (Number.isNaN(created.getTime())) return w.tag
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const diffDays = Math.round((startOfDay(new Date()) - startOfDay(created)) / 86_400_000)
  if (diffDays <= 0) return todayLabel
  if (diffDays === 1) return yesterdayLabel
  return created.toLocaleDateString(getIntlLocale(), { month: 'short', day: 'numeric' })
}

export function ChatWorkspaceSection(): ReactElement | null {
  const { t } = useTranslation()
  const ctx = useWorkspaces()
  const focused = useWorkspace((s) => getFocusedTab(s)?.spec)
  const openOrFocus = useWorkspace((s) => s.openOrFocus)

  const chatWorkspaces = useMemo(
    () => ctx.workspaces.filter((w) => w.template === CHAT_TEMPLATE),
    [ctx.workspaces],
  )

  const isWsFocus = focused?.kind === 'workspace' && focused.params.source === 'chat'
  const selection = isWsFocus
    ? { wsId: focused.params.wsId, sessionId: focused.params.sessionId ?? null }
    : null

  const chatTemplate = ctx.templates.find((tpl) => tpl.name === CHAT_TEMPLATE)
  const [pendingDelete, setPendingDelete] = useState<Workspace | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  // Close the "more" menu on an outside click.
  useEffect(() => {
    if (!menuOpen) return
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [menuOpen])

  const handleConfirmDelete = async (): Promise<void> => {
    if (!pendingDelete) return
    try {
      const ok = await deleteWorkspace(pendingDelete.id)
      if (ok) ctx.refresh()
    } finally {
      setPendingDelete(null)
    }
  }

  // Don't collapse the whole section while templates are still loading — doing
  // so hid the cold-load skeleton (and the New-chat CTA) during the exact 30s
  // window we want to fill, leaving a blank pane. Only bail once templates are
  // known-loaded AND there genuinely is no chat template (broken deployment).
  if (ctx.templatesLoaded && !chatTemplate) return null

  const todayLabel = t('chat.today')
  const yesterdayLabel = t('chat.yesterday')

  return (
    <>
      {/* Primary action: New chat (the Ask Alice composer). The split caret
          keeps the power-user "New workspace" (named, custom tag) reachable. */}
      <div className="px-2 pt-2 pb-1.5">
        <div className="flex items-stretch gap-1">
          <button
            type="button"
            onClick={() => openOrFocus({ kind: 'chat-landing', params: {} })}
            className="flex-1 min-w-0 flex items-center gap-2 px-3 py-2 rounded-lg border border-border/60 bg-bg-tertiary/30 text-[13px] font-medium text-text-muted transition-colors hover:text-text hover:border-accent/50 hover:bg-bg-tertiary/60"
          >
            <Plus size={15} strokeWidth={2.25} className="shrink-0" />
            <span className="truncate">{t('chat.newChat')}</span>
          </button>
          <div ref={menuRef} className="relative shrink-0">
            <button
              type="button"
              onClick={() => setMenuOpen((o) => !o)}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              aria-label={t('chat.moreOptions')}
              title={t('chat.moreOptions')}
              className={`h-full px-2 flex items-center justify-center rounded-lg border transition-colors ${
                menuOpen
                  ? 'border-accent/50 bg-bg-tertiary/60 text-text'
                  : 'border-border/60 bg-bg-tertiary/30 text-text-muted hover:text-text hover:border-accent/50 hover:bg-bg-tertiary/60'
              }`}
            >
              <ChevronDown size={14} strokeWidth={2.25} />
            </button>
            {menuOpen && (
              <div
                role="menu"
                className="absolute right-0 top-full mt-1 min-w-[170px] py-1 bg-bg-secondary border border-border/70 rounded-lg shadow-lg z-10"
              >
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false)
                    setShowCreate(true)
                  }}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-[12px] text-left text-text transition-colors hover:bg-bg-tertiary"
                >
                  <FolderPlus size={14} strokeWidth={2} className="shrink-0 text-text-muted" />
                  <span>{t('chat.newWorkspace')}</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {showCreate && (
        <CreateWorkspaceDialog
          templates={ctx.templates}
          presetTemplate={CHAT_TEMPLATE}
          onCreated={(workspace) => {
            ctx.refresh()
            openOrFocus({ kind: 'workspace', params: { wsId: workspace.id, source: 'chat' } })
          }}
          onClose={() => setShowCreate(false)}
        />
      )}

      <ul className="py-0.5">
        {/* Cold load: the list is empty because it hasn't fetched yet, NOT
            because there are no chats — show a skeleton instead of flashing the
            "no chats yet" empty text (or a blank pane) until the first list
            lands. */}
        {!ctx.hasLoaded && !ctx.listError && (
          <li aria-hidden="true">
            {Array.from({ length: 3 }).map((_, g) => (
              <div key={g} className="mb-1.5">
                <div className="px-3 py-1.5"><Skeleton className="h-2.5 w-14" /></div>
                {Array.from({ length: 2 }).map((_, r) => (
                  <div key={r} className="flex items-center gap-2 px-3 py-1.5">
                    <Skeleton className="h-3 w-3 rounded" />
                    <Skeleton className={`h-3 ${r === 0 ? 'w-32' : 'w-24'}`} />
                  </div>
                ))}
              </div>
            ))}
          </li>
        )}
        {ctx.hasLoaded && chatWorkspaces.length === 0 && !ctx.listError && (
          <li className="px-3 py-2 text-[12px] text-text-muted/60">{t('chat.noChatWorkspacesYet')}</li>
        )}
        {ctx.listError && <li className="px-3 py-1 text-[11px] text-red">{ctx.listError}</li>}
        {chatWorkspaces.map((w) => (
          <ChatWorkspaceRow
            key={w.id}
            workspace={w}
            label={chatLabel(w, todayLabel, yesterdayLabel)}
            selection={selection}
            onOpen={() => {
              const recent = mostRecentSession(w.sessions)
              openOrFocus({
                kind: 'workspace',
                params: recent
                  ? { wsId: w.id, sessionId: recent.id, source: 'chat' }
                  : { wsId: w.id, source: 'chat' },
              })
            }}
            onOpenSession={(sid) =>
              openOrFocus({ kind: 'workspace', params: { wsId: w.id, sessionId: sid, source: 'chat' } })
            }
            onPauseSession={(sid) => void ctx.pauseSession(w.id, sid)}
            onResumeSession={(sid) => void ctx.resumeSession(w.id, sid, 'chat')}
            onDeleteSession={(sid) => ctx.requestDeleteSession(w.id, sid)}
            onConfigure={() => ctx.openAgentConfig(w.id)}
            onDelete={() => setPendingDelete(w)}
            onSpawn={() => openOrFocus({ kind: 'chat-landing', params: { targetWsId: w.id } })}
          />
        ))}
      </ul>

      {pendingDelete && (
        <ConfirmDialog
          title={t('chat.deleteWorkspaceTitle')}
          message={t('chat.deleteWorkspaceMessage', { tag: pendingDelete.tag })}
          confirmLabel={t('common.delete')}
          onConfirm={handleConfirmDelete}
          onClose={() => setPendingDelete(null)}
        />
      )}
    </>
  )
}

function mostRecentSession(sessions: readonly SessionRecord[]): SessionRecord | undefined {
  if (sessions.length === 0) return undefined
  return [...sessions].sort(
    (a, b) => new Date(b.lastActiveAt).getTime() - new Date(a.lastActiveAt).getTime(),
  )[0]
}

interface ChatWorkspaceRowProps {
  workspace: Workspace
  label: string
  selection: { wsId: string; sessionId: string | null } | null
  onOpen: () => void
  onOpenSession: (sid: string) => void
  onPauseSession: (sid: string) => void
  onResumeSession: (sid: string) => void
  onDeleteSession: (sid: string) => void
  onConfigure: () => void
  onDelete: () => void
  /** Spawn a fresh agent session in THIS workspace (and open it). */
  onSpawn: () => void
}

function ChatWorkspaceRow(props: ChatWorkspaceRowProps): ReactElement {
  const { t } = useTranslation()
  const w = props.workspace
  const hasRunning = w.sessions.some((s) => s.state === 'running')
  const [expanded, setExpanded] = useState(true)
  const isSelected = props.selection?.wsId === w.id && props.selection.sessionId === null
  const displayName = w.displayName?.trim()
  const subtitle = displayName && displayName !== props.label ? displayName : null

  const statusClass = hasRunning
    ? 'bg-green'
    : w.sessions.length > 0
      ? 'bg-text-muted/40'
      : 'border border-border'

  return (
    <li className="group relative">
      <div
        className={`flex items-center gap-1 pl-2 pr-2 py-1 text-[13px] cursor-pointer transition-colors ${
          isSelected ? 'bg-bg-tertiary text-text' : 'text-text hover:bg-bg-tertiary/50'
        }`}
      >
        {isSelected && (
          <span aria-hidden="true" className="absolute left-0 top-0 bottom-0 w-[2px] bg-accent" />
        )}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            setExpanded((v) => !v)
          }}
          className="w-4 h-5 flex items-center justify-center text-text-muted/50 hover:text-text shrink-0"
          aria-label={expanded ? t('chat.collapseSessions') : t('chat.expandSessions')}
          title={expanded ? t('chat.collapseSessions') : t('chat.expandSessions')}
        >
          {expanded ? (
            <ChevronDown size={12} strokeWidth={2.25} />
          ) : (
            <ChevronRight size={12} strokeWidth={2.25} />
          )}
        </button>
        <button
          type="button"
          onClick={props.onOpen}
          className="flex-1 min-w-0 flex items-center gap-2 text-left"
        >
          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${statusClass}`} aria-hidden="true" />
          <span className="min-w-0 flex-1">
            <span className="block truncate font-medium" title={workspaceDisplayTitle(w)}>
              {props.label}
            </span>
            {subtitle && (
              <span className="block truncate text-[11px] leading-3 text-text-muted/65" title={subtitle}>
                {subtitle}
              </span>
            )}
          </span>
          {w.sessions.length > 0 && (
            <span className="text-[11px] text-text-muted/45 tabular-nums shrink-0">
              {w.sessions.length}
            </span>
          )}
        </button>
        {/* Always-visible "+" — spawn a fresh agent runtime in THIS day's
            workspace (vs "New chat" which starts a whole new one). */}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            props.onSpawn()
          }}
          className="shrink-0 w-5 h-5 rounded flex items-center justify-center text-text-muted/50 hover:text-text hover:bg-bg-secondary transition-colors"
          title={t('chat.newSession')}
          aria-label={t('chat.newSession')}
        >
          <Plus size={13} strokeWidth={2.25} />
        </button>
        <span className="shrink-0 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              props.onConfigure()
            }}
            className="w-5 h-5 rounded flex items-center justify-center text-text-muted hover:text-text hover:bg-bg-secondary"
            title="Workspace settings"
            aria-label="Workspace settings"
          >
            <SettingsIcon size={12} strokeWidth={2} />
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              props.onDelete()
            }}
            className="w-5 h-5 rounded flex items-center justify-center text-text-muted hover:text-red hover:bg-red/10"
            title={t('chat.deleteWorkspace')}
            aria-label={t('chat.deleteWorkspace')}
          >
            <X size={12} strokeWidth={2.5} />
          </button>
        </span>
      </div>
      {expanded && w.sessions.length > 0 && (
        <div className="ml-[18px] border-l border-border/50">
          {w.sessions.map((s) => (
            <SessionRow
              key={s.id}
              session={s}
              isActive={props.selection?.sessionId === s.id}
              onSelect={() => props.onOpenSession(s.id)}
              onPause={() => props.onPauseSession(s.id)}
              onResume={() => props.onResumeSession(s.id)}
              onDelete={() => props.onDeleteSession(s.id)}
            />
          ))}
        </div>
      )}
    </li>
  )
}
