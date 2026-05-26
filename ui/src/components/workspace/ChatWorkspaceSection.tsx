/**
 * "Workspace chat" section embedded inside the Chat activity sidebar.
 *
 * Visual rhythm matches the Traditional channels list below — single
 * row per workspace, with a collapsible session sub-tree. Status dot
 * prefix conveys running/idle without needing a "4h" trailing meta.
 *
 * The create form is hidden behind a `+` toggle in the section header;
 * when opened, the tag input pre-fills with a date-based default
 * (`chat-may13`, `chat-may13-2`, …) so users can hit enter without
 * typing. Power-user spawn-by-agent stays in the Workspaces activity
 * — this sidebar is for "pick a conversation and continue".
 */

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactElement,
} from 'react'
import { ChevronDown, ChevronRight, Plus, Settings as SettingsIcon, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { getCurrentLocale } from '../../lib/i18n-format'

import { useWorkspaces } from '../../contexts/WorkspacesContext'
import { useWorkspace } from '../../tabs/store'
import { getFocusedTab } from '../../tabs/types'
import { ConfirmDialog } from '../ConfirmDialog'
import { createWorkspace, deleteWorkspace, type SessionRecord, type Workspace } from './api'
import { SessionRow } from './Sidebar'

const CHAT_TEMPLATE = 'chat'
const TAG_HINT = 'a-z, 0-9, "-", "_", up to 33 chars'
const TAG_RE = /^[a-z0-9][a-z0-9_-]{0,32}$/

function defaultTagFor(workspaces: readonly Workspace[]): string {
  const now = new Date()
  const month = now.toLocaleString(getCurrentLocale(), { month: 'short' }).toLowerCase()
  const day = now.getDate()
  const base = `chat-${month}${day}`
  const taken = new Set(workspaces.map((w) => w.tag))
  if (!taken.has(base)) return base
  let i = 2
  while (taken.has(`${base}-${i}`)) i++
  return `${base}-${i}`
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

  const isWsFocus = focused?.kind === 'workspace'
  const selection = isWsFocus
    ? { wsId: focused.params.wsId, sessionId: focused.params.sessionId ?? null }
    : null

  const chatTemplate = ctx.templates.find((t) => t.name === CHAT_TEMPLATE)

  const [showCreate, setShowCreate] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [tag, setTag] = useState('')
  const [pickedAgents, setPickedAgents] = useState<Set<string> | null>(null)
  const [createError, setCreateError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [pendingDelete, setPendingDelete] = useState<Workspace | null>(null)

  const checkedAgents: ReadonlySet<string> = useMemo(() => {
    if (pickedAgents) return pickedAgents
    return new Set(chatTemplate?.defaultAgents ?? ['claude'])
  }, [pickedAgents, chatTemplate])

  const toggleAgent = (id: string): void => {
    setPickedAgents((prev) => {
      const base = prev ?? new Set(chatTemplate?.defaultAgents ?? ['claude'])
      const next = new Set(base)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const openCreate = (): void => {
    setShowCreate(true)
    setTag(defaultTagFor(ctx.workspaces))
    setCreateError(null)
    // Focus + select on next paint so users can type to replace the
    // default in one keystroke.
    setTimeout(() => {
      inputRef.current?.focus()
      inputRef.current?.select()
    }, 0)
  }

  const closeCreate = (): void => {
    setShowCreate(false)
    setTag('')
    setPickedAgents(null)
    setCreateError(null)
  }

  const submit = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault()
    const tagVal = tag.trim()
    if (!TAG_RE.test(tagVal)) {
      setCreateError(t('workspaceChat.invalidTag', 'invalid tag ({{hint}})', { hint: TAG_HINT }))
      return
    }
    if (checkedAgents.size === 0) {
      setCreateError(t('workspaceChat.pickAtLeastOneAgent', 'pick at least one agent'))
      return
    }
    setSubmitting(true)
    setCreateError(null)
    const result = await createWorkspace(tagVal, CHAT_TEMPLATE, Array.from(checkedAgents))
    setSubmitting(false)
    if (result.ok) {
      closeCreate()
      ctx.refresh()
      openOrFocus({ kind: 'workspace', params: { wsId: result.workspace.id } })
    } else {
      const msg = result.error.message ?? result.error.error ?? `HTTP ${result.status}`
      setCreateError(msg)
    }
  }

  const handleConfirmDelete = async (): Promise<void> => {
    if (!pendingDelete) return
    try {
      const ok = await deleteWorkspace(pendingDelete.id)
      if (ok) ctx.refresh()
    } finally {
      setPendingDelete(null)
    }
  }

  useEffect(() => {
    if (showCreate && tag === '' && chatTemplate) {
      setTag(defaultTagFor(ctx.workspaces))
    }
  }, [showCreate, tag, chatTemplate, ctx.workspaces])

  if (!chatTemplate) return null

  return (
    <>
      <div className="px-3 mt-2 flex items-baseline gap-2">
        <h3 className="text-[10px] font-medium text-text-muted/60 uppercase tracking-wider">
          {t('workspaceChat.title', 'Workspace chat')}
        </h3>
        <span className="text-[10px] text-text-muted/50">{t('workspaceChat.recommended', 'recommended')}</span>
        <button
          type="button"
          onClick={() => (showCreate ? closeCreate() : openCreate())}
          className="ml-auto w-5 h-5 rounded flex items-center justify-center text-text-muted hover:text-text hover:bg-bg-secondary"
          title={showCreate ? t('common.cancel') : t('workspaceChat.newChatWorkspace', 'New chat workspace')}
          aria-label={showCreate ? t('workspaceChat.cancelNew', 'Cancel new chat workspace') : t('workspaceChat.newChatWorkspace', 'New chat workspace')}
        >
          {showCreate ? <X size={12} strokeWidth={2.5} /> : <Plus size={13} strokeWidth={2.25} />}
        </button>
      </div>

      {showCreate && (
        <form
          onSubmit={submit}
          className="mt-1.5 mx-3 mb-2 p-2 rounded-md border border-border bg-bg-secondary/40 flex flex-col gap-1.5"
        >
          <div className="flex gap-1.5">
            <input
              ref={inputRef}
              type="text"
              placeholder={t('workspaceChat.tagPlaceholder', 'tag (e.g. may1)')}
              value={tag}
              onChange={(e) => setTag(e.target.value)}
              disabled={submitting}
              spellCheck={false}
              autoCorrect="off"
              autoCapitalize="off"
              className="flex-1 min-w-0 px-2 py-1 text-[12px] rounded border border-border bg-bg text-text placeholder:text-text-muted/60 focus:outline-none focus:border-accent"
            />
            <button
              type="submit"
              disabled={submitting || tag.length === 0}
              className="px-2.5 py-1 text-[12px] rounded bg-accent text-white disabled:opacity-40 hover:bg-accent/90"
            >
              {submitting ? '…' : t('workspaceChat.create', 'create')}
            </button>
          </div>
          {ctx.agents.length > 0 && (
            <div className="flex flex-wrap gap-2 text-[11px] text-text-muted">
              {ctx.agents.map((a) => (
                <label
                  key={a.id}
                  className="flex items-center gap-1 cursor-pointer"
                  title={a.displayName}
                >
                  <input
                    type="checkbox"
                    checked={checkedAgents.has(a.id)}
                    onChange={() => toggleAgent(a.id)}
                    disabled={submitting}
                    className="w-3 h-3"
                  />
                  <span>{a.id}</span>
                </label>
              ))}
            </div>
          )}
          {createError && (
            <div className="text-[11px] text-red">{createError}</div>
          )}
        </form>
      )}

      <ul className="py-0.5">
        {chatWorkspaces.length === 0 && !ctx.listError && !showCreate && (
          <li className="px-3 py-2 text-[12px] text-text-muted/60">{t('workspaceChat.noChatWorkspacesYet', 'no chat workspaces yet')}</li>
        )}
        {ctx.listError && (
          <li className="px-3 py-1 text-[11px] text-red">{ctx.listError}</li>
        )}
        {chatWorkspaces.map((w) => (
          <ChatWorkspaceRow
            key={w.id}
            workspace={w}
            selection={selection}
            onOpen={() => {
              const recent = mostRecentSession(w.sessions)
              if (recent) {
                openOrFocus({
                  kind: 'workspace',
                  params: { wsId: w.id, sessionId: recent.id },
                })
              } else {
                openOrFocus({ kind: 'workspace', params: { wsId: w.id } })
              }
            }}
            onOpenSession={(sid) =>
              openOrFocus({ kind: 'workspace', params: { wsId: w.id, sessionId: sid } })
            }
            onPauseSession={(sid) => void ctx.pauseSession(w.id, sid)}
            onResumeSession={(sid) => void ctx.resumeSession(w.id, sid)}
            onDeleteSession={(sid) => void ctx.deleteSession(w.id, sid)}
            onConfigure={() => ctx.openAgentConfig(w.id)}
            onDelete={() => setPendingDelete(w)}
          />
        ))}
      </ul>

      {pendingDelete && (
        <ConfirmDialog
          title={t('workspaceChat.deleteChatWorkspace', 'Delete chat workspace')}
          message={
            <>
              {t('workspaceChat.deleteChatWorkspaceConfirm', 'Delete chat workspace')}{' '}
              <span className="font-mono text-text">{pendingDelete.tag}</span>? {t('workspaceChat.deleteKeepFilesNote', 'The files on disk are kept; only the launcher\'s registry entry is removed. Any open tab for it will close.')}
            </>
          }
          confirmLabel={t('common.delete')}
          onConfirm={handleConfirmDelete}
          onClose={() => setPendingDelete(null)}
        />
      )}
    </>
  )
}

function mostRecentSession(
  sessions: readonly SessionRecord[],
): SessionRecord | undefined {
  if (sessions.length === 0) return undefined
  return [...sessions].sort(
    (a, b) => new Date(b.lastActiveAt).getTime() - new Date(a.lastActiveAt).getTime(),
  )[0]
}

interface ChatWorkspaceRowProps {
  workspace: Workspace
  selection: { wsId: string; sessionId: string | null } | null
  onOpen: () => void
  onOpenSession: (sid: string) => void
  onPauseSession: (sid: string) => void
  onResumeSession: (sid: string) => void
  onDeleteSession: (sid: string) => void
  onConfigure: () => void
  onDelete: () => void
}

function ChatWorkspaceRow(props: ChatWorkspaceRowProps): ReactElement {
  const { t } = useTranslation()
  const w = props.workspace
  const hasRunning = w.sessions.some((s) => s.state === 'running')
  const [expanded, setExpanded] = useState(true)
  const isSelected =
    props.selection?.wsId === w.id && props.selection.sessionId === null

  const statusClass = hasRunning
    ? 'bg-green'
    : w.sessions.length > 0
      ? 'bg-text-muted/40'
      : 'border border-border'

  return (
    <li className="group relative">
      <div
        className={`flex items-center gap-1 px-3 py-1 text-[13px] cursor-pointer transition-colors ${
          isSelected ? 'bg-bg-tertiary text-text' : 'text-text hover:bg-bg-tertiary/50'
        }`}
      >
        {isSelected && (
          <span
            aria-hidden="true"
            className="absolute left-0 top-0 bottom-0 w-[2px] bg-accent"
          />
        )}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            setExpanded((v) => !v)
          }}
          className="w-3 h-4 flex items-center justify-center text-text-muted/60 hover:text-text"
          aria-label={expanded ? t('workspaceChat.collapseSessions', 'Collapse sessions') : t('workspaceChat.expandSessions', 'Expand sessions')}
          title={expanded ? t('workspaceChat.collapseSessions', 'Collapse sessions') : t('workspaceChat.expandSessions', 'Expand sessions')}
        >
          {expanded ? (
            <ChevronDown size={11} strokeWidth={2.25} />
          ) : (
            <ChevronRight size={11} strokeWidth={2.25} />
          )}
        </button>
        <button
          type="button"
          onClick={props.onOpen}
          className="flex-1 min-w-0 flex items-center gap-1.5 text-left"
        >
          <span
            className={`w-1.5 h-1.5 rounded-full shrink-0 ${statusClass}`}
            aria-hidden="true"
          />
          <span className="truncate" title={w.tag}>
            {w.tag}
          </span>
        </button>
        <span className="shrink-0 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              props.onConfigure()
            }}
            className="w-5 h-5 rounded flex items-center justify-center text-text-muted hover:text-text hover:bg-bg-secondary"
            title={t('workspaces.aiProvider')}
            aria-label={t('workspaces.aiProvider')}
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
            title={t('workspaceChat.deleteWorkspace', 'Delete workspace')}
            aria-label={t('workspaceChat.deleteWorkspace', 'Delete workspace')}
          >
            <X size={12} strokeWidth={2.5} />
          </button>
        </span>
      </div>
      {expanded && w.sessions.length > 0 && (
        <ul className="sidebar-children chat-ws-children-list">
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
        </ul>
      )}
    </li>
  )
}
