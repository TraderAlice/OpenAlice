/**
 * "Ask Alice" secondary sidebar — your chat history.
 *
 * Makes the two lifecycle actions explicit: "New chat" creates a Session inside
 * the recent Chat Workspace; "New workspace" creates a new durable context
 * container. Workspaces keep their actual names and Sessions hang underneath.
 *
 * Named-workspace creation (a custom tag) lives in the Workspaces activity —
 * this surface is for chatting, not workspace management.
 */

import { useMemo, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ChevronDown,
  ChevronRight,
  MessageSquarePlus,
  Network,
  PanelsTopLeft,
  Settings as SettingsIcon,
  X,
} from 'lucide-react'

import { useWorkspaces } from '../../contexts/workspaces-context'
import { RefreshNotice, Skeleton } from '../StateViews'
import { useWorkspace } from '../../tabs/store'
import { getFocusedTab } from '../../tabs/types'
import {
  MANAGER_WORKSPACE_ID,
  type ManagerWorkspaceSnapshot,
  type SessionRecord,
  type Workspace,
} from './api'
import { CreateWorkspaceDialog } from './CreateWorkspaceDialog'
import { WorkspaceOffboardingDialog } from './WorkspaceOffboardingDialog'
import { SessionRow } from './Sidebar'
import { SidebarActionMenu } from './SidebarActionMenu'
import { workspaceDisplayName, workspaceDisplayTitle } from './display'
import { orderSessionsForSidebar, orderWorkspacesForSidebar } from './sidebar-order'
import { useReorderMotion } from './useReorderMotion'
import { preferencesApi } from '../../api/preferences'

const CHAT_TEMPLATE = 'chat'
const AUTO_QUANT_TEMPLATE = 'auto-quant-v2'
const CHAT_SIDEBAR_SESSION_LIMIT = 6

function nextWorkspaceTag(workspaces: readonly Workspace[], base: string): string {
  const tags = new Set(workspaces.map((workspace) => workspace.tag))
  if (!tags.has(base)) return base
  let suffix = 2
  while (tags.has(`${base}-${suffix}`)) suffix += 1
  return `${base}-${suffix}`
}

export function ChatWorkspaceSection({
  onNavigate = () => undefined,
  mode = 'chat',
}: {
  onNavigate?: () => void
  mode?: 'chat' | 'auto-quant'
}): ReactElement | null {
  const { t } = useTranslation()
  const ctx = useWorkspaces()
  const focused = useWorkspace((s) => getFocusedTab(s)?.spec)
  const openOrFocus = useWorkspace((s) => s.openOrFocus)

  const source = mode === 'auto-quant' ? 'auto-quant' : 'chat'
  const templateName = mode === 'auto-quant' ? AUTO_QUANT_TEMPLATE : CHAT_TEMPLATE
  const landingKind = mode === 'auto-quant' ? 'auto-quant-landing' : 'chat-landing'
  const starterTag = mode === 'auto-quant' ? 'auto-quant' : 'chat'
  const isWsFocus = focused?.kind === 'workspace' && focused.params.source === source
  const isManagerFocus = mode === 'chat' && focused?.kind === 'workspace-manager'
  const selection = isWsFocus
    ? { wsId: focused.params.wsId, sessionId: focused.params.sessionId ?? null }
    : null
  const landingOwnsStatus = focused?.kind === landingKind
  const chatWorkspaces = useMemo(
    () => orderWorkspacesForSidebar(
      ctx.workspaces.filter((workspace) => workspace.template === templateName),
    ),
    [ctx.workspaces, templateName],
  )
  const workspaceListRef = useReorderMotion<HTMLUListElement>(
    chatWorkspaces.map((workspace) => workspace.id),
  )
  const showListError = Boolean(ctx.listError && ctx.workspaces.length === 0)

  const chatTemplate = ctx.templates.find((tpl) => tpl.name === templateName)
  const [pendingDelete, setPendingDelete] = useState<Workspace | null>(null)
  const [showCreate, setShowCreate] = useState(false)

  const navigate = (target: Parameters<typeof openOrFocus>[0]): void => {
    openOrFocus(target)
    onNavigate()
  }

  const rememberChatWorkspace = (workspaceId: string): void => {
    void preferencesApi.rememberRecentChatWorkspace(workspaceId).catch(() => undefined)
  }

  // Don't collapse the whole section while templates are still loading — doing
  // so hid the cold-load skeleton (and the New-chat CTA) during the exact 30s
  // window we want to fill, leaving a blank pane. Only bail once templates are
  // known-loaded AND there genuinely is no chat template (broken deployment).
  if (ctx.templatesLoaded && !chatTemplate && ctx.templatesError === null) return null

  return (
    <>
      {/* Starting a conversation is the primary action. Creating a Workspace is
          a lower-frequency context-boundary action attached to the list it
          affects, rather than a competing half-width CTA. */}
      <div className="px-2 pt-2 pb-1">
        <button
          type="button"
          onClick={() => navigate({ kind: landingKind, params: {} })}
          className="oa-pressable flex w-full items-center gap-2 rounded-lg border border-primary/25 bg-primary/10 px-3 py-2.5 text-left text-[13px] font-medium text-foreground hover:border-primary/45 hover:bg-primary/15"
        >
          <MessageSquarePlus size={15} strokeWidth={2.15} className="shrink-0 text-primary" />
          <span>{mode === 'auto-quant' ? t('autoQuant.newResearch') : t('chat.newChat')}</span>
        </button>
      </div>

      {mode === 'chat' && (
        <ManagerWorkspaceRow
          manager={ctx.workspaceManager}
          loaded={ctx.workspaceManagerLoaded}
          isFocused={isManagerFocus}
          activeSessionId={isManagerFocus && focused?.kind === 'workspace-manager' ? focused.params.sessionId ?? null : null}
          onOpen={() => navigate({ kind: 'workspace-manager', params: {} })}
          onOpenSession={(sessionId) => navigate({
            kind: 'workspace-manager',
            params: { sessionId },
          })}
          onPauseSession={(sessionId) => void ctx.pauseSession(MANAGER_WORKSPACE_ID, sessionId)}
          onResumeSession={(sessionId, surface) => {
            if (surface === 'webpi') {
              void ctx.openWebPiSession(MANAGER_WORKSPACE_ID, sessionId)
            } else {
              void ctx.resumeSession(MANAGER_WORKSPACE_ID, sessionId)
            }
            onNavigate()
          }}
          onDeleteSession={(sessionId) => ctx.requestDeleteSession(MANAGER_WORKSPACE_ID, sessionId)}
        />
      )}

      <div className="px-3 pb-1 pt-1.5">
        <span className="min-w-0 truncate text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/60">
          {t('nav.item.workspaces')}
        </span>
      </div>
      <div className="px-2 pb-1">
        <button
          type="button"
          onClick={() => setShowCreate(true)}
          className="oa-pressable flex w-full items-center gap-2 rounded-lg border border-border/70 bg-secondary/45 px-3 py-2 text-left text-[12px] font-medium text-muted-foreground hover:border-border hover:bg-muted hover:text-foreground"
          title={mode === 'auto-quant' ? t('autoQuant.newWorkspace') : t('chat.newWorkspace')}
          aria-label={mode === 'auto-quant' ? t('autoQuant.newWorkspace') : t('chat.newWorkspace')}
        >
          <PanelsTopLeft size={14} strokeWidth={2} className="shrink-0" />
          <span>{mode === 'auto-quant' ? t('autoQuant.newWorkspace') : t('chat.newWorkspace')}</span>
        </button>
      </div>

      {showCreate && (
        <CreateWorkspaceDialog
          templates={ctx.templates}
          presetTemplate={templateName}
          initialTag={nextWorkspaceTag(ctx.workspaces, starterTag)}
          onCreated={(workspace) => {
            ctx.refresh()
            if (mode === 'chat') rememberChatWorkspace(workspace.id)
            navigate({ kind: landingKind, params: { targetWsId: workspace.id } })
          }}
          onClose={() => setShowCreate(false)}
        />
      )}

      <ul ref={workspaceListRef} className="py-0.5">
        {/* Cold load: the list is empty because it hasn't fetched yet, NOT
            because there are no chats — show a skeleton instead of flashing the
            "no chats yet" empty text (or a blank pane) until the first list
            lands. */}
        {!ctx.hasLoaded && !showListError && (
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
        {ctx.hasLoaded && chatWorkspaces.length === 0 && !showListError && (
          <li className="px-3 py-2.5">
            <p className="text-[12px] text-muted-foreground/60">
              {mode === 'auto-quant' ? t('autoQuant.noWorkspacesYet') : t('chat.noChatWorkspacesYet')}
            </p>
          </li>
        )}
        {(ctx.listError !== null || ctx.templatesError !== null) && !landingOwnsStatus && (
          <li className="px-2 py-1">
            <RefreshNotice
              message={ctx.listError !== null
                ? (ctx.hasLoaded
                    ? t('workspace.dataStale')
                    : t('workspace.dataUnavailableSidebar'))
                : t('workspace.templatesUnavailableSidebar')}
              actionLabel={t('common.retry')}
              onAction={() => void Promise.all([ctx.refresh(), ctx.refreshTemplates()])}
            />
          </li>
        )}
        {chatWorkspaces.map((w) => (
          <ChatWorkspaceRow
            key={w.id}
            workspace={w}
            label={workspaceDisplayName(w)}
            selection={selection}
            onOpen={() => {
              if (mode === 'chat') rememberChatWorkspace(w.id)
              navigate({ kind: landingKind, params: { targetWsId: w.id } })
            }}
            onOpenSession={(sid) => {
              if (mode === 'chat') rememberChatWorkspace(w.id)
              navigate({ kind: 'workspace', params: { wsId: w.id, sessionId: sid, source } })
            }}
            onPauseSession={(sid) => void ctx.pauseSession(w.id, sid)}
            onResumeSession={(sid) => {
              if (mode === 'chat') rememberChatWorkspace(w.id)
              void ctx.resumeSession(w.id, sid, source)
              onNavigate()
            }}
            onDeleteSession={(sid) => ctx.requestDeleteSession(w.id, sid)}
            onConfigure={() => ctx.openAgentConfig(w.id)}
            onDelete={() => setPendingDelete(w)}
            onSpawn={() => navigate({ kind: landingKind, params: { targetWsId: w.id } })}
            onBrowseSessions={() => {
              if (mode === 'chat') rememberChatWorkspace(w.id)
              navigate({ kind: 'workspace', params: { wsId: w.id, source } })
            }}
          />
        ))}
      </ul>

      {pendingDelete && (
        <WorkspaceOffboardingDialog
          workspace={pendingDelete}
          onOffboarded={() => {
            setPendingDelete(null)
            ctx.refresh()
          }}
          onClose={() => setPendingDelete(null)}
        />
      )}
    </>
  )
}

interface ManagerWorkspaceRowProps {
  manager: ManagerWorkspaceSnapshot | null
  loaded: boolean
  isFocused: boolean
  activeSessionId: string | null
  onOpen: () => void
  onOpenSession: (sessionId: string) => void
  onPauseSession: (sessionId: string) => void
  onResumeSession: (sessionId: string, surface: SessionRecord['surface']) => void
  onDeleteSession: (sessionId: string) => void
}

/** Launcher-owned Manager conversations belong beside ordinary Chat history,
 * but remain outside the business Workspace tree and registry. */
function ManagerWorkspaceRow(props: ManagerWorkspaceRowProps): ReactElement {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)
  const sessions = useMemo(
    () => orderSessionsForSidebar(props.manager?.sessions ?? []),
    [props.manager?.sessions],
  )
  const sessionListRef = useReorderMotion<HTMLDivElement>(
    sessions.map((session) => session.id),
  )
  const hasRunning = sessions.some((session) => session.state === 'running')

  return (
    <div className="px-2 pb-1 pt-1">
      <div
        className={`group relative flex w-full items-center overflow-hidden rounded-lg border transition-colors ${
          props.isFocused
            ? 'border-primary/35 bg-primary/10 text-foreground'
            : 'border-border/70 bg-secondary/45 text-foreground hover:border-primary/25 hover:bg-muted'
        }`}
      >
        <span className="pointer-events-none absolute inset-y-0 right-0 w-20 bg-gradient-to-l from-accent/[0.07] to-transparent" />
        <button
          type="button"
          onClick={() => setExpanded((current) => !current)}
          disabled={sessions.length === 0}
          className="oa-icon-action oa-workspace-row-action relative ml-1 flex h-8 w-6 shrink-0 items-center justify-center rounded text-muted-foreground/55 hover:text-foreground disabled:cursor-default disabled:opacity-30"
          aria-label={expanded ? t('chat.collapseSessions') : t('chat.expandSessions')}
          title={expanded ? t('chat.collapseSessions') : t('chat.expandSessions')}
        >
          {expanded
            ? <ChevronDown size={13} strokeWidth={2.25} />
            : <ChevronRight size={13} strokeWidth={2.25} />}
        </button>
        <button
          type="button"
          onClick={props.onOpen}
          aria-label={t('workspaceManager.title')}
          aria-current={props.isFocused && props.activeSessionId === null ? 'page' : undefined}
          className="oa-pressable relative flex min-w-0 flex-1 items-center gap-2.5 py-2.5 pl-1 pr-3 text-left"
        >
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary transition-transform group-hover:scale-105">
            <Network size={14} strokeWidth={2.1} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[12px] font-semibold">{t('workspaceManager.title')}</span>
            <span className="mt-0.5 block truncate text-[10px] text-muted-foreground">{t('workspaceManager.sidebarDescription')}</span>
          </span>
          {!props.loaded ? (
            <span aria-hidden className="h-2.5 w-4 animate-pulse rounded bg-muted-foreground/15" />
          ) : sessions.length > 0 ? (
            <span className="inline-flex shrink-0 items-center gap-1.5 text-[10px] tabular-nums text-muted-foreground/55">
              <span className={`h-1.5 w-1.5 rounded-full ${hasRunning ? 'bg-success' : 'bg-muted-foreground/35'}`} />
              {sessions.length}
            </span>
          ) : null}
        </button>
      </div>

      {expanded && sessions.length > 0 && (
        <div ref={sessionListRef} className="oa-disclosure-enter ml-[18px] border-l border-border/50">
          {sessions.map((session) => (
            <SessionRow
              key={session.id}
              reorderId={session.id}
              session={session}
              isActive={props.activeSessionId === session.id}
              onSelect={() => props.onOpenSession(session.id)}
              onPause={() => props.onPauseSession(session.id)}
              onResume={() => props.onResumeSession(session.id, session.surface)}
              onDelete={() => props.onDeleteSession(session.id)}
            />
          ))}
        </div>
      )}
    </div>
  )
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
  /** Open the scalable Workspace-level Session directory. */
  onBrowseSessions: () => void
}

function ChatWorkspaceRow(props: ChatWorkspaceRowProps): ReactElement {
  const { t } = useTranslation()
  const w = props.workspace
  const hasRunning = w.sessions.some((s) => s.state === 'running')
  const [expanded, setExpanded] = useState(true)
  const isSelected = props.selection?.wsId === w.id && props.selection.sessionId === null
  const displayName = w.displayName?.trim()
  const subtitle = displayName && displayName !== w.tag ? w.tag : null
  const actionWorkspace = subtitle ? `${props.label} (${w.tag})` : w.tag
  const orderedSessions = useMemo(
    () => orderSessionsForSidebar(w.sessions),
    [w.sessions],
  )
  const visibleSessions = orderedSessions.slice(0, CHAT_SIDEBAR_SESSION_LIMIT)
  const sessionListRef = useReorderMotion<HTMLDivElement>(
    visibleSessions.map((session) => session.id),
  )

  const statusClass = hasRunning
    ? 'bg-success'
    : w.sessions.length > 0
      ? 'bg-muted-foreground/40'
      : 'border border-border'

  return (
    <li className="group relative" data-reorder-id={w.id}>
      <div
        className={`flex items-center gap-1 pl-2 pr-2 py-1 text-[13px] cursor-pointer transition-colors ${
          isSelected ? 'bg-muted text-foreground' : 'text-foreground hover:bg-muted/50'
        }`}
      >
        {isSelected && (
          <span aria-hidden="true" className="absolute left-0 top-0 bottom-0 w-[2px] bg-primary" />
        )}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            setExpanded((v) => !v)
          }}
          className="oa-workspace-row-action flex h-7 w-7 shrink-0 items-center justify-center text-muted-foreground/50 hover:text-foreground sm:h-5 sm:w-4"
          aria-label={expanded
            ? t('chat.workspaceActions.collapse', { workspace: actionWorkspace })
            : t('chat.workspaceActions.expand', { workspace: actionWorkspace })}
          title={expanded
            ? t('chat.workspaceActions.collapse', { workspace: actionWorkspace })
            : t('chat.workspaceActions.expand', { workspace: actionWorkspace })}
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
          aria-current={isSelected ? 'page' : undefined}
          className="flex-1 min-w-0 flex items-center gap-2 text-left"
        >
          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${statusClass}`} aria-hidden="true" />
          <span className="min-w-0 flex-1">
            <span className="block truncate font-medium" title={workspaceDisplayTitle(w)}>
              {props.label}
            </span>
            {subtitle && (
              <span className="block truncate text-[11px] leading-3 text-muted-foreground/65" title={subtitle}>
                {subtitle}
              </span>
            )}
          </span>
          {w.sessions.length > 0 && (
            <span className="text-[11px] text-muted-foreground/45 tabular-nums shrink-0">
              {w.sessions.length}
            </span>
          )}
        </button>
        {/* Always-visible conversation action for THIS workspace. The icon is
            intentionally distinct from the global New chat and New workspace
            actions so three different meanings do not collapse into bare +s. */}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            props.onSpawn()
          }}
          className="oa-icon-action oa-workspace-row-action flex h-7 w-7 shrink-0 items-center justify-center rounded text-muted-foreground/50 transition-colors hover:bg-secondary hover:text-foreground sm:h-5 sm:w-5"
          title={t('chat.workspaceActions.newConversation', { workspace: actionWorkspace })}
          aria-label={t('chat.workspaceActions.newConversation', { workspace: actionWorkspace })}
        >
          <MessageSquarePlus size={13} strokeWidth={2.1} />
        </button>
        <SidebarActionMenu
          label={t('common.moreActions', { target: actionWorkspace })}
          items={[
            {
              label: t('workspace.configure'),
              ariaLabel: t('chat.workspaceActions.configure', { workspace: actionWorkspace }),
              icon: <SettingsIcon size={13} strokeWidth={2} />,
              onSelect: props.onConfigure,
            },
            {
              label: t('chat.deleteWorkspace'),
              ariaLabel: t('chat.workspaceActions.offboard', { workspace: actionWorkspace }),
              icon: <X size={13} strokeWidth={2.5} />,
              onSelect: props.onDelete,
              danger: true,
            },
          ]}
        />
      </div>
      {expanded && orderedSessions.length > 0 && (
        <div ref={sessionListRef} className="oa-disclosure-enter ml-[18px] border-l border-border/50">
          {visibleSessions.map((s) => (
            <SessionRow
              key={s.id}
              reorderId={s.id}
              session={s}
              isActive={props.selection?.sessionId === s.id}
              onSelect={() => props.onOpenSession(s.id)}
              onPause={() => props.onPauseSession(s.id)}
              onResume={() => props.onResumeSession(s.id)}
              onDelete={() => props.onDeleteSession(s.id)}
            />
          ))}
          {orderedSessions.length > visibleSessions.length && (
            <button
              type="button"
              onClick={props.onBrowseSessions}
              className="oa-pressable ml-2 my-1 flex min-h-7 items-center rounded-md px-2 text-[10.5px] font-medium text-primary hover:bg-primary/10"
            >
              {t('chat.viewAllSessions', { count: orderedSessions.length })}
            </button>
          )}
        </div>
      )}
    </li>
  )
}
