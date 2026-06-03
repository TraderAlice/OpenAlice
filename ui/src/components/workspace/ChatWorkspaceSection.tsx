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

import { useMemo, useState, type ReactElement } from 'react'
import { ChevronDown, ChevronRight, Plus, Settings as SettingsIcon, X } from 'lucide-react'

import { useWorkspaces } from '../../contexts/WorkspacesContext'
import { useWorkspace } from '../../tabs/store'
import { getFocusedTab } from '../../tabs/types'
import { ConfirmDialog } from '../ConfirmDialog'
import { deleteWorkspace, type SessionRecord, type Workspace } from './api'
import { SessionRow } from './Sidebar'
import { CreateWorkspaceDialog } from './CreateWorkspaceDialog'

const CHAT_TEMPLATE = 'chat'

function defaultTagFor(workspaces: readonly Workspace[]): string {
  const now = new Date()
  const month = now.toLocaleString('en-US', { month: 'short' }).toLowerCase()
  const day = now.getDate()
  const base = `chat-${month}${day}`
  const taken = new Set(workspaces.map((w) => w.tag))
  if (!taken.has(base)) return base
  let i = 2
  while (taken.has(`${base}-${i}`)) i++
  return `${base}-${i}`
}

export function ChatWorkspaceSection(): ReactElement | null {
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
  const [pendingDelete, setPendingDelete] = useState<Workspace | null>(null)

  const handleConfirmDelete = async (): Promise<void> => {
    if (!pendingDelete) return
    try {
      const ok = await deleteWorkspace(pendingDelete.id)
      if (ok) ctx.refresh()
    } finally {
      setPendingDelete(null)
    }
  }

  if (!chatTemplate) return null

  return (
    <>
      <div className="px-3 mt-2 flex items-baseline gap-2">
        <h3 className="text-[10px] font-medium text-text-muted/60 uppercase tracking-wider">
          Workspace chat
        </h3>
        <span className="text-[10px] text-text-muted/50">recommended</span>
        <button
          type="button"
          onClick={() => setShowCreate(true)}
          className="ml-auto w-5 h-5 rounded flex items-center justify-center text-text-muted hover:text-text hover:bg-bg-secondary"
          title="New chat workspace"
          aria-label="New chat workspace"
        >
          <Plus size={13} strokeWidth={2.25} />
        </button>
      </div>

      {showCreate && (
        <CreateWorkspaceDialog
          templates={ctx.templates}
          agents={ctx.agents}
          presetTemplate={CHAT_TEMPLATE}
          initialTag={defaultTagFor(ctx.workspaces)}
          onCreated={(workspace) => {
            ctx.refresh()
            openOrFocus({ kind: 'workspace', params: { wsId: workspace.id } })
          }}
          onClose={() => setShowCreate(false)}
        />
      )}

      <ul className="py-0.5">
        {chatWorkspaces.length === 0 && !ctx.listError && (
          <li className="px-3 py-2 text-[12px] text-text-muted/60">no chat workspaces yet</li>
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
          title="Delete chat workspace"
          message={
            <>
              Delete chat workspace{' '}
              <span className="font-mono text-text">{pendingDelete.tag}</span>? The
              files on disk are kept; only the launcher's registry entry is removed.
              Any open tab for it will close.
            </>
          }
          confirmLabel="Delete"
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
          aria-label={expanded ? 'Collapse sessions' : 'Expand sessions'}
          title={expanded ? 'Collapse sessions' : 'Expand sessions'}
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
            title="AI Provider"
            aria-label="AI Provider"
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
            title="Delete workspace"
            aria-label="Delete workspace"
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
