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

import { useEffect, useId, useMemo, useRef, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Check,
  ChevronDown,
  ChevronRight,
  Clock3,
  LayoutGrid,
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
import type { ChatDisplayMode } from './chat-display-mode'

const CHAT_TEMPLATE = 'chat'
const AUTO_QUANT_TEMPLATE = 'auto-quant-v2'
const CHAT_SIDEBAR_SESSION_LIMIT = 6
const FOCUSED_CHAT_SESSION_LIMIT = 8
const ALL_WORKSPACES_SESSION_LIMIT = 30

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
  displayMode = 'focused',
  onRequestDisplayMode = () => undefined,
}: {
  onNavigate?: () => void
  mode?: 'chat' | 'auto-quant'
  displayMode?: ChatDisplayMode
  onRequestDisplayMode?: (mode: ChatDisplayMode) => void
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
  const routeWorkspaceId = isWsFocus
    ? focused.params.wsId
    : mode === 'chat' && focused?.kind === 'chat-landing'
      ? focused.params.targetWsId ?? null
      : null
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
  const [recentWorkspaceId, setRecentWorkspaceId] = useState<string | null>(null)

  useEffect(() => {
    if (mode !== 'chat') return
    let live = true
    void preferencesApi.getQuickChat()
      .then((preferences) => {
        if (live) setRecentWorkspaceId(preferences.recentChatWorkspaceId)
      })
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [mode])

  const focusedWorkspace = chatWorkspaces.find((workspace) =>
    workspace.id === (routeWorkspaceId ?? recentWorkspaceId))
    ?? chatWorkspaces[0]
    ?? null

  const navigate = (target: Parameters<typeof openOrFocus>[0]): void => {
    openOrFocus(target)
    onNavigate()
  }

  const rememberChatWorkspace = (workspaceId: string): void => {
    setRecentWorkspaceId(workspaceId)
    void preferencesApi.rememberRecentChatWorkspace(workspaceId).catch(() => undefined)
  }

  // Don't collapse the whole section while templates are still loading — doing
  // so hid the cold-load skeleton (and the New-chat CTA) during the exact 30s
  // window we want to fill, leaving a blank pane. Only bail once templates are
  // known-loaded AND there genuinely is no chat template (broken deployment).
  if (ctx.templatesLoaded && !chatTemplate && ctx.templatesError === null) return null

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Starting a conversation is the primary action. Creating a Workspace is
          a lower-frequency context-boundary action attached to the list it
          affects, rather than a competing half-width CTA. */}
      <div className="px-2 pt-2 pb-1">
        <button
          type="button"
          onClick={() => navigate({
            kind: landingKind,
            params: mode === 'chat' && displayMode === 'focused' && focusedWorkspace
              ? { targetWsId: focusedWorkspace.id }
              : {},
          })}
          className="oa-pressable flex w-full items-center gap-2 rounded-lg border border-primary/25 bg-primary/10 px-3 py-2.5 text-left text-[13px] font-medium text-foreground hover:border-primary/45 hover:bg-primary/15"
        >
          <MessageSquarePlus size={15} strokeWidth={2.15} className="shrink-0 text-primary" />
          <span>{mode === 'auto-quant' ? t('autoQuant.newResearch') : t('chat.newChat')}</span>
        </button>
      </div>

      {(ctx.listError !== null || ctx.templatesError !== null) && !landingOwnsStatus && (
        <div className="px-2 py-1">
          <RefreshNotice
            message={ctx.listError !== null
              ? (ctx.hasLoaded
                  ? t('workspace.dataStale')
                  : t('workspace.dataUnavailableSidebar'))
              : t('workspace.templatesUnavailableSidebar')}
            actionLabel={t('common.retry')}
            onAction={() => void Promise.all([ctx.refresh(), ctx.refreshTemplates()])}
          />
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {mode === 'chat' && displayMode === 'focused' ? (
        <FocusedChatWorkspace
          workspace={focusedWorkspace}
          loading={!ctx.hasLoaded && !showListError}
          unavailable={showListError}
          activeSessionId={selection !== null && selection.wsId === focusedWorkspace?.id
            ? selection.sessionId
            : null}
          onOpenSession={(workspaceId, sessionId) => {
            rememberChatWorkspace(workspaceId)
            navigate({ kind: 'workspace', params: { wsId: workspaceId, sessionId, source: 'chat' } })
          }}
          onPauseSession={(workspaceId, sessionId) => void ctx.pauseSession(workspaceId, sessionId)}
          onResumeSession={(workspaceId, session) => {
            rememberChatWorkspace(workspaceId)
            if (session.surface === 'webpi') {
              void ctx.openWebPiSession(workspaceId, session.id, 'chat')
            } else {
              void ctx.resumeSession(workspaceId, session.id, 'chat')
            }
            onNavigate()
          }}
          onDeleteSession={(workspaceId, sessionId) => ctx.requestDeleteSession(workspaceId, sessionId)}
          onBrowseSessions={(workspaceId) => navigate({
            kind: 'workspace',
            params: { wsId: workspaceId, source: 'chat' },
          })}
          onCreateWorkspace={() => setShowCreate(true)}
        />
      ) : mode === 'chat' && displayMode === 'recent' ? (
        <AllWorkspaceRecentSessions
          workspaces={chatWorkspaces}
          loading={!ctx.hasLoaded && !showListError}
          unavailable={showListError}
          selection={selection}
          onOpenSession={(workspaceId, sessionId) => {
            rememberChatWorkspace(workspaceId)
            navigate({ kind: 'workspace', params: { wsId: workspaceId, sessionId, source: 'chat' } })
          }}
          onPauseSession={(workspaceId, sessionId) => void ctx.pauseSession(workspaceId, sessionId)}
          onResumeSession={(workspaceId, session) => {
            rememberChatWorkspace(workspaceId)
            if (session.surface === 'webpi') {
              void ctx.openWebPiSession(workspaceId, session.id, 'chat')
            } else {
              void ctx.resumeSession(workspaceId, session.id, 'chat')
            }
            onNavigate()
          }}
          onDeleteSession={(workspaceId, sessionId) => ctx.requestDeleteSession(workspaceId, sessionId)}
          onCreateWorkspace={() => setShowCreate(true)}
        />
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">
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
      {mode === 'auto-quant' && <div className="px-2 pb-1">
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
      </div>}

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
        </div>
      )}
      </div>

      {mode === 'chat' && (
        <ChatWorkspaceContextFooter
          workspace={focusedWorkspace}
          workspaces={chatWorkspaces}
          displayMode={displayMode}
          onRequestDisplayMode={onRequestDisplayMode}
          onSwitchWorkspace={(workspaceId) => {
            rememberChatWorkspace(workspaceId)
            onRequestDisplayMode('focused')
            navigate({ kind: 'chat-landing', params: { targetWsId: workspaceId } })
          }}
          onConfigure={() => focusedWorkspace && ctx.openAgentConfig(focusedWorkspace.id)}
          onBrowseSessions={() => focusedWorkspace && navigate({
            kind: 'workspace',
            params: { wsId: focusedWorkspace.id, source: 'chat' },
          })}
          onOpenManager={() => navigate({ kind: 'workspace-manager', params: {} })}
          onCreateWorkspace={() => setShowCreate(true)}
        />
      )}

      {showCreate && (
        <CreateWorkspaceDialog
          templates={ctx.templates}
          presetTemplate={templateName}
          initialTag={nextWorkspaceTag(ctx.workspaces, starterTag)}
          onCreated={(workspace) => {
            ctx.refresh()
            if (mode === 'chat') {
              rememberChatWorkspace(workspace.id)
              onRequestDisplayMode('focused')
            }
            navigate({ kind: landingKind, params: { targetWsId: workspace.id } })
          }}
          onClose={() => setShowCreate(false)}
        />
      )}

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
    </div>
  )
}

interface ChatWorkspaceContextFooterProps {
  workspace: Workspace | null
  workspaces: readonly Workspace[]
  displayMode: ChatDisplayMode
  onRequestDisplayMode: (mode: ChatDisplayMode) => void
  onSwitchWorkspace: (workspaceId: string) => void
  onConfigure: () => void
  onBrowseSessions: () => void
  onOpenManager: () => void
  onCreateWorkspace: () => void
}

function ChatWorkspaceContextFooter(props: ChatWorkspaceContextFooterProps): ReactElement {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const popoverId = useId()

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current?.contains(event.target as Node)) return
      setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      setOpen(false)
      triggerRef.current?.focus({ preventScroll: true })
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown, true)
    }
  }, [open])

  const closeAndRun = (action: () => void) => {
    setOpen(false)
    action()
  }
  const title = props.displayMode === 'focused'
    ? (props.workspace ? workspaceDisplayName(props.workspace) : t('chat.currentWorkspace'))
    : props.displayMode === 'recent'
      ? t('chat.recentConversations')
      : t('nav.item.workspaces')
  const subtitle = props.displayMode === 'focused'
    ? t('chat.currentWorkspace')
    : props.displayMode === 'recent'
      ? t('chat.allWorkspaces')
      : t('chat.multiModeDescription')
  const TriggerIcon = props.displayMode === 'recent' ? Clock3 : LayoutGrid

  const modeOption = (
    mode: ChatDisplayMode,
    label: string,
    icon: ReactElement,
    disabled = false,
  ) => (
    <button
      type="button"
      onClick={() => closeAndRun(() => props.onRequestDisplayMode(mode))}
      disabled={disabled}
      aria-pressed={props.displayMode === mode}
      className="flex min-h-9 w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-xs text-foreground transition-colors hover:bg-muted disabled:cursor-default disabled:opacity-40"
    >
      <span className="flex h-4 w-4 shrink-0 items-center justify-center text-muted-foreground" aria-hidden>
        {icon}
      </span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {props.displayMode === mode && <Check size={13} strokeWidth={2.2} className="shrink-0 text-primary" aria-hidden />}
    </button>
  )

  return (
    <div ref={rootRef} className="relative shrink-0 border-t border-border/60 bg-secondary p-2">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? popoverId : undefined}
        aria-label={t('chat.workspaceContextLabel', { name: title })}
        className="oa-pressable flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        <TriggerIcon className="h-3.5 w-3.5 shrink-0" aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium text-foreground" title={props.displayMode === 'focused' && props.workspace ? workspaceDisplayTitle(props.workspace) : title}>
            {title}
          </span>
          <span className="mt-0.5 block truncate text-[10px] text-muted-foreground/70">{subtitle}</span>
        </span>
        <ChevronDown className={`h-3.5 w-3.5 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden />
      </button>

      {open && (
        <div
          id={popoverId}
          role="dialog"
          aria-label={t('chat.workspaceContextMenu')}
          className="oa-popover-enter absolute bottom-full left-2 right-2 z-40 mb-1 max-h-[min(34rem,calc(100vh-5rem))] overflow-y-auto overscroll-contain rounded-lg border border-border/70 bg-popover p-1.5 text-popover-foreground shadow-lg [scrollbar-gutter:stable]"
        >
          <p className="px-2 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/60">
            {t('chat.view')}
          </p>
          {modeOption('focused', t('chat.currentWorkspace'), <LayoutGrid size={14} strokeWidth={2} />, props.workspace === null)}
          {modeOption('recent', t('chat.recentMode'), <Clock3 size={14} strokeWidth={2} />)}
          {modeOption('multi', t('chat.multiMode'), <PanelsTopLeft size={14} strokeWidth={2} />)}

          <div className="my-1 border-t border-border/60" />

          {props.workspace && props.workspaces.length > 1 && (
            <label className="block px-2 py-1 text-[10px] font-medium text-muted-foreground">
              <span className="mb-1 block">{t('chat.switchWorkspace')}</span>
              <select
                value={props.workspace.id}
                onChange={(event) => closeAndRun(() => props.onSwitchWorkspace(event.target.value))}
                className="h-8 w-full rounded-md border border-border bg-background px-2 text-xs text-foreground outline-none focus:border-primary"
              >
                {props.workspaces.map((workspace) => (
                  <option key={workspace.id} value={workspace.id}>
                    {workspaceDisplayTitle(workspace)}
                  </option>
                ))}
              </select>
            </label>
          )}

          <button
            type="button"
            onClick={() => closeAndRun(props.onConfigure)}
            disabled={!props.workspace}
            className="flex min-h-9 w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-default disabled:opacity-40"
          >
            <SettingsIcon size={14} strokeWidth={2} aria-hidden />
            <span>{t('workspace.configure')}</span>
          </button>
          <button
            type="button"
            onClick={() => closeAndRun(props.onBrowseSessions)}
            disabled={!props.workspace}
            className="flex min-h-9 w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-default disabled:opacity-40"
          >
            <ChevronRight size={14} strokeWidth={2} aria-hidden />
            <span>{t('chat.browseWorkspace')}</span>
          </button>
          <button
            type="button"
            onClick={() => closeAndRun(props.onOpenManager)}
            className="flex min-h-9 w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <Network size={14} strokeWidth={2} aria-hidden />
            <span>{t('workspaceManager.title')}</span>
          </button>
          <button
            type="button"
            onClick={() => closeAndRun(props.onCreateWorkspace)}
            className="flex min-h-9 w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <PanelsTopLeft size={14} strokeWidth={2} aria-hidden />
            <span>{t('chat.newWorkspace')}</span>
          </button>
        </div>
      )}
    </div>
  )
}

interface FocusedChatWorkspaceProps {
  workspace: Workspace | null
  loading: boolean
  unavailable: boolean
  activeSessionId: string | null
  onOpenSession: (workspaceId: string, sessionId: string) => void
  onPauseSession: (workspaceId: string, sessionId: string) => void
  onResumeSession: (workspaceId: string, session: SessionRecord) => void
  onDeleteSession: (workspaceId: string, sessionId: string) => void
  onBrowseSessions: (workspaceId: string) => void
  onCreateWorkspace: () => void
}

interface AllWorkspaceRecentSessionsProps {
  workspaces: readonly Workspace[]
  loading: boolean
  unavailable: boolean
  selection: { wsId: string; sessionId: string | null } | null
  onOpenSession: (workspaceId: string, sessionId: string) => void
  onPauseSession: (workspaceId: string, sessionId: string) => void
  onResumeSession: (workspaceId: string, session: SessionRecord) => void
  onDeleteSession: (workspaceId: string, sessionId: string) => void
  onCreateWorkspace: () => void
}

function AllWorkspaceRecentSessions(props: AllWorkspaceRecentSessionsProps): ReactElement {
  const { t } = useTranslation()
  const sessions = useMemo(() => props.workspaces
    .flatMap((workspace) => workspace.sessions.map((session) => ({ workspace, session })))
    .sort((a, b) => {
      const activity = Date.parse(b.session.lastActiveAt) - Date.parse(a.session.lastActiveAt)
      if (activity !== 0) return activity
      const created = Date.parse(b.session.createdAt) - Date.parse(a.session.createdAt)
      if (created !== 0) return created
      return a.session.id.localeCompare(b.session.id)
    }), [props.workspaces])
  const visibleSessions = sessions.slice(0, ALL_WORKSPACES_SESSION_LIMIT)
  const sessionListRef = useReorderMotion<HTMLDivElement>(
    visibleSessions.map(({ workspace, session }) => `${workspace.id}:${session.id}`),
  )

  if (props.loading) {
    return (
      <div className="flex min-h-0 flex-1 flex-col px-3 py-3" aria-hidden="true">
        <Skeleton className="mb-4 h-2.5 w-32" />
        {Array.from({ length: 6 }).map((_, index) => (
          <div key={index} className="mb-3 flex items-center gap-2">
            <Skeleton className="h-3 w-3 rounded" />
            <div className="min-w-0 flex-1 space-y-1.5">
              <Skeleton className={`h-3 ${index % 2 === 0 ? 'w-32' : 'w-24'}`} />
              <Skeleton className="h-2.5 w-16" />
            </div>
          </div>
        ))}
      </div>
    )
  }

  if (props.unavailable) return <div className="min-h-0 flex-1" />

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 px-3 pb-1 pt-1.5">
        <span className="min-w-0 flex-1 truncate text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/60">
          {t('chat.recentConversations')}
        </span>
        {sessions.length > 0 && (
          <span className="text-[10px] tabular-nums text-muted-foreground/45">{sessions.length}</span>
        )}
      </div>

      <div ref={sessionListRef} className="min-h-0 flex-1 overflow-y-auto py-0.5">
        {sessions.length === 0 ? (
          <p className="px-3 py-3 text-xs leading-relaxed text-muted-foreground/60">
            {t('chat.noRecentConversations')}
          </p>
        ) : visibleSessions.map(({ workspace, session }) => (
          <SessionRow
            key={`${workspace.id}:${session.id}`}
            reorderId={`${workspace.id}:${session.id}`}
            session={session}
            subtitle={workspaceDisplayTitle(workspace)}
            isActive={props.selection?.wsId === workspace.id && props.selection.sessionId === session.id}
            onSelect={() => props.onOpenSession(workspace.id, session.id)}
            onPause={() => props.onPauseSession(workspace.id, session.id)}
            onResume={() => props.onResumeSession(workspace.id, session)}
            onDelete={() => props.onDeleteSession(workspace.id, session.id)}
          />
        ))}
      </div>

      {props.workspaces.length === 0 && (
        <div className="border-t border-border/60 p-2">
          <button
            type="button"
            onClick={props.onCreateWorkspace}
            className="btn-secondary w-full justify-center"
          >
            <PanelsTopLeft size={14} strokeWidth={2} aria-hidden />
            {t('chat.newWorkspace')}
          </button>
        </div>
      )}
    </div>
  )
}

function FocusedChatWorkspace(props: FocusedChatWorkspaceProps): ReactElement {
  const { t } = useTranslation()
  const sessions = useMemo(
    () => orderSessionsForSidebar(props.workspace?.sessions ?? []),
    [props.workspace?.sessions],
  )
  const visibleSessions = sessions.slice(0, FOCUSED_CHAT_SESSION_LIMIT)
  const sessionListRef = useReorderMotion<HTMLDivElement>(
    visibleSessions.map((session) => session.id),
  )

  if (props.loading) {
    return (
      <div className="flex min-h-0 flex-1 flex-col px-3 py-3" aria-hidden="true">
        <Skeleton className="mb-4 h-2.5 w-24" />
        {Array.from({ length: 5 }).map((_, index) => (
          <div key={index} className="mb-3 flex items-center gap-2">
            <Skeleton className="h-3 w-3 rounded" />
            <Skeleton className={`h-3 ${index % 2 === 0 ? 'w-32' : 'w-24'}`} />
          </div>
        ))}
      </div>
    )
  }

  if (props.unavailable) return <div className="min-h-0 flex-1" />

  if (!props.workspace) {
    return (
      <div className="flex min-h-0 flex-1 flex-col px-3 py-3">
        <p className="text-xs leading-relaxed text-muted-foreground">
          {t('chat.focusedEmpty')}
        </p>
        <button
          type="button"
          onClick={props.onCreateWorkspace}
          className="btn-secondary mt-3 w-full justify-center"
        >
          <PanelsTopLeft size={14} strokeWidth={2} aria-hidden />
          {t('chat.newWorkspace')}
        </button>
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 px-3 pb-1 pt-1.5">
        <span className="min-w-0 flex-1 truncate text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/60">
          {t('chat.recentConversations')}
        </span>
        {sessions.length > 0 && (
          <span className="text-[10px] tabular-nums text-muted-foreground/45">{sessions.length}</span>
        )}
      </div>

      <div ref={sessionListRef} className="min-h-0 flex-1 overflow-y-auto py-0.5">
        {sessions.length === 0 ? (
          <p className="px-3 py-3 text-xs text-muted-foreground/60">
            {t('chat.noConversationsYet')}
          </p>
        ) : visibleSessions.map((session) => (
          <SessionRow
            key={session.id}
            reorderId={session.id}
            session={session}
            isActive={props.activeSessionId === session.id}
            onSelect={() => props.onOpenSession(props.workspace!.id, session.id)}
            onPause={() => props.onPauseSession(props.workspace!.id, session.id)}
            onResume={() => props.onResumeSession(props.workspace!.id, session)}
            onDelete={() => props.onDeleteSession(props.workspace!.id, session.id)}
          />
        ))}
        {sessions.length > visibleSessions.length && (
          <button
            type="button"
            onClick={() => props.onBrowseSessions(props.workspace!.id)}
            className="oa-pressable mx-2 my-1 flex min-h-8 items-center rounded-md px-2 text-[11px] font-medium text-primary hover:bg-primary/10"
          >
            {t('chat.viewAllSessions', { count: sessions.length })}
          </button>
        )}
      </div>

    </div>
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
