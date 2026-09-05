/**
 * Current-Workspace conversations and actions, shared by the primary Harness
 * navigation and the internal sidebar presentation. Creating a conversation
 * enters the existing launcher; opening one never implicitly resumes it.
 */

import { useEffect, useId, useMemo, useRef, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import {
  AppWindow,
  Binary,
  Microscope,
  ChevronDown,
  ChevronRight,
  Clock3,
  LayoutGrid,
  Layers3,
  LoaderCircle,
  MessageSquare,
  MessageSquarePlus,
  MoreHorizontal,
  Network,
  PanelsTopLeft,
  Plus,
  Settings as SettingsIcon,
  Trash2,
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
import {
  ConversationBrowserDialog,
} from './WorkspaceNavigationDialogs'
import { SessionRow } from './Sidebar'
import { SidebarActionMenu } from './SidebarActionMenu'
import { SessionSettingsDialog } from './SessionSettingsDialog'
import { workspaceDisplayName, workspaceDisplayTitle } from './display'
import {
  flattenHarnessSessions,
  joinWorkspaceHarnessSessions,
  type HarnessSession,
} from './harness-sessions'
import { selectRecentSidebarWorkset } from './harness-session-workset'
import { harnessSessionRosterSubtitle } from './harness-session-presentation'
import { orderSessionsForSidebar, orderWorkspacesForSidebar } from './sidebar-order'
import { useWorkspaceSessionDirectories } from '../../hooks/useWorkspaceSessionDirectory'
import { useReorderMotion } from './useReorderMotion'
import { preferencesApi } from '../../api/preferences'
import { useHarnessPreferences } from '../../hooks/useHarnessPreferences'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import type { ChatDisplayMode } from './chat-display-mode'
import { SelectionIndicator } from '../SelectionIndicator'
import { HarnessNavigationGroup } from './HarnessNavigationGroup'
import { HarnessWorkspaceEntry } from './HarnessWorkspaceEntry'

const CHAT_TEMPLATE = 'chat'
const AUTO_QUANT_TEMPLATE = 'auto-quant-v2'
const AUTO_PREDICTION_TEMPLATE = 'auto-prediction'

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
  placement = 'sidebar',
  compact = false,
}: {
  onNavigate?: () => void
  mode?: 'chat' | 'auto-quant' | 'prediction'
  /** Legacy render variants stay internal while the product shell fixes this to Current Workspace. */
  displayMode?: ChatDisplayMode
  placement?: 'sidebar' | 'navigation'
  compact?: boolean
}): ReactElement | null {
  const { t } = useTranslation()
  const ctx = useWorkspaces()
  const focused = useWorkspace((s) => getFocusedTab(s)?.spec)
  const openOrFocus = useWorkspace((s) => s.openOrFocus)

  const source = mode === 'auto-quant' ? 'auto-quant' : mode === 'prediction' ? 'prediction' : 'chat'
  const templateName = mode === 'auto-quant'
    ? AUTO_QUANT_TEMPLATE
    : mode === 'prediction' ? AUTO_PREDICTION_TEMPLATE : CHAT_TEMPLATE
  const landingKind = mode === 'auto-quant'
    ? 'auto-quant-landing'
    : mode === 'prediction' ? 'auto-prediction-landing' : 'chat-landing'
  const starterTag = mode === 'auto-quant' ? 'auto-quant' : mode === 'prediction' ? 'prediction' : 'chat'
  const isWsFocus = focused?.kind === 'workspace' && focused.params.source === source
  const isManagerFocus = mode === 'chat' && focused?.kind === 'workspace-manager'
  const selection = isWsFocus
    ? { wsId: focused.params.wsId, sessionId: focused.params.sessionId ?? null }
    : null
  const landingOwnsStatus = focused?.kind === landingKind
  const routeWorkspaceId = isWsFocus || (focused?.kind === 'workspace-details' && focused.params.source === source)
    ? focused.params.wsId
    : focused?.kind === 'harness-surface' && focused.params.source === source
      ? focused.params.wsId
    : focused?.kind === landingKind
      ? focused.params.targetWsId ?? null
      : null
  const chatWorkspaces = useMemo(
    () => orderWorkspacesForSidebar(
      ctx.workspaces.filter((workspace) => workspace.template === templateName),
    ),
    [ctx.workspaces, templateName],
  )
  const chatWorkspaceIds = useMemo(
    () => chatWorkspaces.map((workspace) => workspace.id),
    [chatWorkspaces],
  )
  const { preferences: harnessPreferences } = useHarnessPreferences()
  const rosterJoin = useMemo(() => ({
    includeHeadlessBornSessions: harnessPreferences.showHeadlessBornSessions,
    includeIssueAttachedSessions: harnessPreferences.showIssueAttachedSessions,
  }), [
    harnessPreferences.showHeadlessBornSessions,
    harnessPreferences.showIssueAttachedSessions,
  ])
  const sessionDirectories = useWorkspaceSessionDirectories(chatWorkspaceIds)
  const rosterByWorkspace = useMemo(() => {
    const next = new Map<string, HarnessSession[]>()
    for (const workspace of chatWorkspaces) {
      next.set(
        workspace.id,
        joinWorkspaceHarnessSessions(
          workspace,
          sessionDirectories.directories.get(workspace.id) ?? null,
          rosterJoin,
        ),
      )
    }
    return next
  }, [chatWorkspaces, rosterJoin, sessionDirectories.directories])
  const recentRoster = useMemo(
    () => flattenHarnessSessions(chatWorkspaces, sessionDirectories.directories, rosterJoin),
    [chatWorkspaces, rosterJoin, sessionDirectories.directories],
  )
  const workspaceListRef = useReorderMotion<HTMLUListElement>(
    chatWorkspaces.map((workspace) => workspace.id),
  )
  const showListError = Boolean(ctx.listError && ctx.workspaces.length === 0)

  const chatTemplate = ctx.templates.find((tpl) => tpl.name === templateName)
  const [pendingDelete, setPendingDelete] = useState<Workspace | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [recentWorkspaceId, setRecentWorkspaceId] = useState<string | null>(null)
  const [conversationBrowserOpen, setConversationBrowserOpen] = useState(false)
  const [conversationWorkspaceId, setConversationWorkspaceId] = useState<string | null>(null)
  const [busySession, setBusySession] = useState<HarnessSession | null>(null)
  const [settingsTarget, setSettingsTarget] = useState<{
    workspaceId: string
    sessionId: string
  } | null>(null)
  const settingsRow = useMemo(() => {
    if (!settingsTarget) return null
    return recentRoster.find((row) => (
      row.workspaceId === settingsTarget.workspaceId
      && row.session.id === settingsTarget.sessionId
    )) ?? null
  }, [recentRoster, settingsTarget])
  const dialogRestoreFocusRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (mode !== 'chat') return
    let live = true
    void preferencesApi.getQuickChat()
      .then((preferences) => {
        if (live) setRecentWorkspaceId(current => current ?? preferences.recentChatWorkspaceId)
      })
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [mode])

  // This component now stays mounted across product areas. Keep a Chat desk
  // entered via a deep link or the general launcher when leaving that route;
  // Quant/Prediction continue to use their explicit durable default pointers.
  useEffect(() => {
    if (mode === 'chat' && routeWorkspaceId) setRecentWorkspaceId(routeWorkspaceId)
  }, [mode, routeWorkspaceId])

  const preferredWorkspaceId = routeWorkspaceId
    ?? (mode === 'auto-quant'
      ? ctx.autoQuantDefaultWorkspaceId
      : mode === 'prediction' ? ctx.autoPredictionDefaultWorkspaceId : recentWorkspaceId)
  const focusedWorkspace = chatWorkspaces.find((workspace) =>
    workspace.id === preferredWorkspaceId)
    ?? chatWorkspaces[0]
    ?? null

  const navigate = (target: Parameters<typeof openOrFocus>[0]): void => {
    openOrFocus(target)
    onNavigate()
  }

  const rememberViewedWorkspace = (workspaceId: string): void => {
    if (mode !== 'chat') return
    setRecentWorkspaceId(workspaceId)
    void preferencesApi.rememberRecentChatWorkspace(workspaceId).catch(() => undefined)
  }

  const activeResumeId = useMemo(() => {
    if (!selection?.sessionId) return null
    const workspace = chatWorkspaces.find((candidate) => candidate.id === selection.wsId)
    return workspace?.sessions.find((session) => session.id === selection.sessionId)?.resumeId
      ?? null
  }, [chatWorkspaces, selection])

  const isRosterRowActive = (row: HarnessSession): boolean => {
    if (!selection || selection.wsId !== row.workspaceId) return false
    if (selection.sessionId === row.session.id) return true
    return activeResumeId !== null && row.resumeId === activeResumeId
  }

  const activateRosterSession = (row: HarnessSession): void => {
    if (row.headlessOccupying) {
      setBusySession(row)
      return
    }
    rememberViewedWorkspace(row.workspaceId)
    navigate({
      kind: 'workspace',
      params: { wsId: row.workspaceId, sessionId: row.session.id, source },
    })
  }

  useEffect(() => {
    if (!busySession) return
    const stillRunning = recentRoster.some((row) =>
      row.workspaceId === busySession.workspaceId
      && row.resumeId === busySession.resumeId
      && row.headlessOccupying)
    if (!stillRunning) setBusySession(null)
  }, [busySession, recentRoster])

  const resumeRosterSession = async (row: HarnessSession): Promise<void> => {
    if (row.headlessOccupying || !row.resumable) return
    rememberViewedWorkspace(row.workspaceId)
    if (row.session.surface === 'webpi') {
      await ctx.openWebPiSession(row.workspaceId, row.session.id, source)
    } else {
      await ctx.resumeSession(row.workspaceId, row.session.id, source)
    }
    onNavigate()
  }

  const deleteRosterSession = (row: HarnessSession): void => {
    ctx.requestDeleteSession(row.workspaceId, row.session.id)
  }

  const archiveRosterSession = (row: HarnessSession): void => {
    if (row.headlessOccupying) return
    void ctx.setSessionPresence(row.workspaceId, row.resumeId, 'archived')
      .then(() => sessionDirectories.refresh())
      .catch((err) => console.error('workspaces.archive_failed', { resumeId: row.resumeId, err }))
  }

  const restoreRosterSession = (row: HarnessSession): void => {
    void ctx.setSessionPresence(row.workspaceId, row.resumeId, 'active')
      .then(() => sessionDirectories.refresh())
      .catch((err) => console.error('workspaces.restore_failed', { resumeId: row.resumeId, err }))
  }

  const pauseRosterSession = (row: HarnessSession): void => {
    void ctx.pauseSession(row.workspaceId, row.session.id)
  }

  const openSessionSettings = (row: HarnessSession): void => {
    setSettingsTarget({ workspaceId: row.workspaceId, sessionId: row.session.id })
  }

  const selectHarnessWorkspace = (
    workspaceId: string,
    onSelected: () => void,
  ): void => {
    if (mode === 'auto-quant') {
      // Unlike Chat's recency hint, this is the durable AutoQuant readiness
      // pointer. Change it only from an explicit Workspace selection/creation,
      // never as a side effect of opening or resuming a historical Session.
      // Wait for that pointer to persist before navigating: AutoQuant's landing
      // route resolves its desk from the pointer, so navigating first can flash
      // or reopen the previously selected desk.
      void ctx.setAutoQuantDefaultWorkspace(workspaceId)
        .then(onSelected)
        .catch(() => undefined)
      return
    }
    if (mode === 'prediction') {
      void ctx.setAutoPredictionDefaultWorkspace?.(workspaceId)
        .then(onSelected)
        .catch(() => undefined)
      return
    }
    rememberViewedWorkspace(workspaceId)
    onSelected()
  }

  const openConversationBrowser = (
    workspaceId: string | null,
    restoreFocus: HTMLElement | null,
  ): void => {
    dialogRestoreFocusRef.current = restoreFocus
    setConversationWorkspaceId(workspaceId)
    setConversationBrowserOpen(true)
  }

  // Don't collapse the whole section while templates are still loading — doing
  // so hid the cold-load skeleton (and the New-chat CTA) during the exact 30s
  // window we want to fill, leaving a blank pane. Only bail once templates are
  // known-loaded AND there genuinely is no chat template (broken deployment).
  if (placement === 'sidebar' && ctx.templatesLoaded && !chatTemplate && ctx.templatesError === null) return null

  const navigation = placement === 'navigation'
  const preferenceLoaded = mode === 'auto-quant' ? ctx.autoQuantPreferenceLoaded
    : mode === 'prediction' ? ctx.autoPredictionPreferenceLoaded : true
  const preferenceError = mode === 'auto-quant' ? ctx.autoQuantPreferenceError
    : mode === 'prediction' ? ctx.autoPredictionPreferenceError : null
  const navigationLoaded = ctx.hasLoaded && (mode === 'chat' || (ctx.templatesLoaded && preferenceLoaded))
  const navigationError = ctx.listError || ctx.templatesError || preferenceError
    || (mode !== 'chat' && ctx.templatesLoaded && !chatTemplate ? t('workspace.templatesUnavailableDescription') : null)
  const refreshNavigation = () => Promise.all([
    ctx.refresh(), ctx.refreshTemplates(), sessionDirectories.refresh(),
    mode === 'auto-quant' ? ctx.refreshAutoQuantPreference()
      : mode === 'prediction' ? ctx.refreshAutoPredictionPreference?.() : undefined,
  ])
  const ready = mode === 'chat' || (mode === 'auto-quant'
    ? ctx.autoQuantPreferenceLoaded && chatWorkspaces.some(workspace => workspace.id === ctx.autoQuantDefaultWorkspaceId)
    : ctx.autoPredictionPreferenceLoaded && chatWorkspaces.some(workspace => workspace.id === ctx.autoPredictionDefaultWorkspaceId))
  const currentWorkspace = ready ? focusedWorkspace : null
  const harnessTitle = mode === 'chat' ? t('office.harness.chat')
    : t(mode === 'auto-quant' ? 'nav.item.autoQuant' : 'nav.item.autoPrediction')
  const studioActive = focused?.kind === 'harness-surface' && focused.params.source === source
    && focused.params.wsId === currentWorkspace?.id && focused.params.capability === 'studio'
  const newLabel = mode === 'auto-quant' ? t('autoQuant.newResearch')
    : mode === 'prediction' ? t('autoPrediction.newResearch') : t('chat.newChat')
  const openLanding = () => navigate({
    kind: landingKind,
    params: currentWorkspace ? { targetWsId: currentWorkspace.id } : {},
  })
  const contextMenu = (
    <ChatWorkspaceContextFooter
      iconOnly={navigation}
      harness={mode}
      workspace={currentWorkspace}
      workspaces={chatWorkspaces}
      sessionCount={currentWorkspace ? rosterByWorkspace.get(currentWorkspace.id)?.length ?? 0 : 0}
      createWorkspaceLabel={mode === 'auto-quant' ? t('autoQuant.newWorkspace')
        : mode === 'prediction' ? t('autoPrediction.newWorkspace') : t('chat.newWorkspace')}
      onConfigure={() => currentWorkspace && ctx.openAgentConfig(currentWorkspace.id)}
      onDetails={() => currentWorkspace && navigate({ kind: 'workspace-details', params: { wsId: currentWorkspace.id, source } })}
      onUpgrade={() => currentWorkspace && ctx.openAgentConfig(currentWorkspace.id, undefined, 'template')}
      onSelectWorkspace={(workspaceId) => selectHarnessWorkspace(workspaceId, () => {
        navigate({ kind: landingKind, params: { targetWsId: workspaceId } })
      })}
      onBrowseSessions={(restoreFocus) => openConversationBrowser(currentWorkspace?.id ?? null, restoreFocus)}
      onCreateWorkspace={() => setShowCreate(true)}
    />
  )
  const navigationSessions = currentWorkspace ? rosterByWorkspace.get(currentWorkspace.id) ?? [] : []
  const visibleNavigationSessions = selectRecentSidebarWorkset(navigationSessions, isRosterRowActive, 4)

  return (
    <div className={navigation ? 'min-w-0' : 'flex h-full min-h-0 flex-col'}>
      {navigation ? (
        <HarnessNavigationGroup
          title={harnessTitle}
          compact={compact}
          compactIcon={mode === 'chat' ? <MessageSquare size={15} strokeWidth={1.75} aria-hidden />
            : mode === 'auto-quant' ? <Microscope size={15} strokeWidth={1.75} aria-hidden /> : <Binary size={15} strokeWidth={1.75} aria-hidden />}
          active={isWsFocus || landingOwnsStatus || studioActive || (focused?.kind === 'workspace-details' && focused.params.source === source)}
          showNewAction={mode === 'chat' || Boolean(navigationLoaded && !navigationError && currentWorkspace)}
          newLabel={newLabel} onOpen={openLanding} menu={contextMenu}
        >
          {(navigationError || sessionDirectories.error) ? (
            <RefreshNotice message={t('workspace.dataUnavailableSidebar')} actionLabel={t('common.retry')}
              onAction={() => void refreshNavigation()} />
          ) : !navigationLoaded ? (
            <div className="space-y-2 px-2 py-2" aria-label={t('common.loading')}><Skeleton className="h-3 w-24" /><Skeleton className="h-3 w-32" /></div>
          ) : null}
          {mode !== 'chat' && navigationLoaded && !navigationError && chatWorkspaces.length > 0 && (
            <HarnessWorkspaceEntry active={studioActive}
              state={currentWorkspace ? 'ready' : 'select'}
              onOpen={() => currentWorkspace
                ? navigate({ kind: 'harness-surface', params: { wsId: currentWorkspace.id, capability: 'studio', source: mode } })
                : openLanding()} />
          )}
          {visibleNavigationSessions.map(row => (
            <HarnessSessionRow enterOnSelect key={`${row.workspaceId}:${row.resumeId}`} row={row} isActive={isRosterRowActive(row)}
              onSelect={() => activateRosterSession(row)} onPause={() => pauseRosterSession(row)}
              onResume={() => resumeRosterSession(row)} onDelete={() => deleteRosterSession(row)}
              onArchive={() => archiveRosterSession(row)} onSettings={() => openSessionSettings(row)} />
          ))}
          {navigationSessions.length > visibleNavigationSessions.length && (
            <button type="button" onClick={event => openConversationBrowser(currentWorkspace?.id ?? null, event.currentTarget)}
              className="oa-nav-row flex min-h-10 w-full items-center rounded-md px-2 text-left text-[12px] text-muted-foreground hover:bg-sidebar-accent md:min-h-8">
              {t('chat.viewAllConversations', { count: navigationSessions.length })}
            </button>
          )}
        </HarnessNavigationGroup>
      ) : <>
      <div className="grid grid-cols-1 gap-1 px-1.5 pb-2 pt-2">
        <Button
          type="button"
          onClick={() => navigate({
            kind: landingKind,
            params: displayMode === 'focused' && focusedWorkspace
              ? { targetWsId: focusedWorkspace.id }
              : {},
          })}
          variant="secondary"
          className="oa-chat-new-action h-9 w-full justify-start px-2.5 text-sidebar-accent-foreground"
        >
          <MessageSquarePlus size={15} strokeWidth={2} className="shrink-0 text-primary" />
          <span className="text-body">{mode === 'auto-quant'
            ? t('autoQuant.newResearch')
            : mode === 'prediction' ? t('autoPrediction.newResearch') : t('chat.newChat')}</span>
        </Button>
        {mode !== 'chat' && focusedWorkspace && (
          <Button
            type="button"
            onClick={() => navigate({
              kind: 'harness-surface',
              params: { wsId: focusedWorkspace.id, capability: 'studio', source: mode },
            })}
            variant="ghost"
            size="lg"
            className="w-full justify-start px-2.5 text-muted-foreground"
          >
            <AppWindow size={15} strokeWidth={2.05} className="shrink-0 text-primary" />
            <span className="text-body">{t('harnessSurface.studio')}</span>
          </Button>
        )}
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
      {displayMode === 'focused' ? (
        <FocusedChatWorkspace
          harness={mode}
          workspace={focusedWorkspace}
          sessions={focusedWorkspace ? rosterByWorkspace.get(focusedWorkspace.id) ?? [] : []}
          loading={!ctx.hasLoaded && !showListError}
          unavailable={showListError}
          emptyCopy={mode === 'auto-quant'
            ? t('autoQuant.noResearchYet')
            : mode === 'prediction' ? t('autoPrediction.noResearchYet') : undefined}
          isRowActive={isRosterRowActive}
          onOpenSession={activateRosterSession}
          onPauseSession={pauseRosterSession}
          onResumeSession={resumeRosterSession}
          onDeleteSession={deleteRosterSession}
          onArchiveSession={archiveRosterSession}
          onSettingsSession={openSessionSettings}
          onBrowseSessions={(restoreFocus) => openConversationBrowser(focusedWorkspace.id, restoreFocus)}
          onCreateWorkspace={() => setShowCreate(true)}
        />
      ) : displayMode === 'recent' ? (
        <AllWorkspaceRecentSessions
          harness={mode}
          workspaces={chatWorkspaces}
          sessions={recentRoster}
          loading={!ctx.hasLoaded && !showListError}
          unavailable={showListError}
          isRowActive={isRosterRowActive}
          onOpenSession={activateRosterSession}
          onPauseSession={pauseRosterSession}
          onResumeSession={resumeRosterSession}
          onDeleteSession={deleteRosterSession}
          onArchiveSession={archiveRosterSession}
          onSettingsSession={openSessionSettings}
          onBrowseSessions={(restoreFocus) => openConversationBrowser(null, restoreFocus)}
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
        <h3 className="text-caption min-w-0 truncate font-medium text-muted-foreground/70">
          {t('nav.item.workspaces')}
        </h3>
      </div>
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
            <p className="text-caption text-muted-foreground/60">
              {mode === 'auto-quant'
                ? t('autoQuant.noWorkspacesYet')
                : mode === 'prediction' ? t('autoPrediction.noWorkspacesYet') : t('chat.noChatWorkspacesYet')}
            </p>
          </li>
        )}
        {chatWorkspaces.map((w) => (
          <ChatWorkspaceRow
            key={w.id}
            workspace={w}
            sessions={rosterByWorkspace.get(w.id) ?? []}
            label={workspaceDisplayName(w)}
            selection={selection}
            isRowActive={isRosterRowActive}
            onOpen={() => {
              selectHarnessWorkspace(w.id, () => {
                navigate({ kind: landingKind, params: { targetWsId: w.id } })
              })
            }}
            onOpenSession={activateRosterSession}
            onPauseSession={pauseRosterSession}
            onResumeSession={resumeRosterSession}
            onDeleteSession={deleteRosterSession}
            onArchiveSession={archiveRosterSession}
            onSettingsSession={openSessionSettings}
            onConfigure={() => ctx.openAgentConfig(w.id)}
            onDelete={() => setPendingDelete(w)}
            onSpawn={() => navigate({ kind: landingKind, params: { targetWsId: w.id } })}
          />
        ))}
      </ul>
        </div>
      )}
      </div>

      {contextMenu}
      </>}

      <ConversationBrowserDialog
        harness={mode}
        open={conversationBrowserOpen}
        workspaces={chatWorkspaces}
        directories={sessionDirectories.directories}
        includeHeadlessBornSessions={harnessPreferences.showHeadlessBornSessions}
        includeIssueAttachedSessions={harnessPreferences.showIssueAttachedSessions}
        currentWorkspaceId={conversationWorkspaceId}
        isRowActive={isRosterRowActive}
        restoreFocusRef={dialogRestoreFocusRef}
        onOpenChange={setConversationBrowserOpen}
        onRestoreSession={restoreRosterSession}
        onSelectSession={(row) => {
          if (!row.headlessOccupying) setConversationBrowserOpen(false)
          activateRosterSession(row)
        }}
      />

      <HeadlessSessionBusyDialog
        row={busySession}
        open={busySession !== null}
        onOpenChange={(open) => {
          if (!open) setBusySession(null)
        }}
      />

      {settingsRow && (
        <SessionSettingsDialog
          open
          onOpenChange={(open) => {
            if (!open) setSettingsTarget(null)
          }}
          record={settingsRow.session}
          agents={ctx.agents}
          workspaceId={settingsRow.workspaceId}
          onSaveDisplayName={async (displayName) => {
            await ctx.setSessionDisplayName(settingsRow.workspaceId, settingsRow.resumeId, displayName)
            await sessionDirectories.refresh()
          }}
          {...(settingsRow.session.agent !== 'shell'
            ? {
                onSaveRuntime: async (update) => {
                  await ctx.updateSessionRuntime(
                    settingsRow.workspaceId,
                    settingsRow.session.id,
                    update,
                  )
                },
              }
            : {})}
          {...(settingsRow.session.state === 'running' && !settingsRow.headlessOccupying
            ? { onPause: () => pauseRosterSession(settingsRow) }
            : {})}
        />
      )}

      {showCreate && (
        <CreateWorkspaceDialog
          templates={ctx.templates}
          presetTemplate={templateName}
          initialTag={nextWorkspaceTag(ctx.workspaces, starterTag)}
          onCreated={(workspace) => {
            ctx.refresh()
            selectHarnessWorkspace(workspace.id, () => {
              navigate({ kind: landingKind, params: { targetWsId: workspace.id } })
            })
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
  iconOnly?: boolean
  harness: 'chat' | 'auto-quant' | 'prediction'
  workspace: Workspace | null
  workspaces: readonly Workspace[]
  sessionCount: number
  createWorkspaceLabel: string
  onConfigure: () => void
  onUpgrade: () => void
  onDetails: () => void
  onSelectWorkspace: (workspaceId: string) => void
  onBrowseSessions: (restoreFocus: HTMLElement | null) => void
  onCreateWorkspace: () => void
}

function ChatWorkspaceContextFooter(props: ChatWorkspaceContextFooterProps): ReactElement {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const contextMenuLabelId = useId()
  const pendingActionRef = useRef<(() => void) | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)

  const workspaceTitle = props.workspace ? workspaceDisplayName(props.workspace) : t('chat.currentWorkspace')
  const harnessTitle = props.harness === 'auto-quant'
    ? t('nav.item.autoQuant')
    : props.harness === 'prediction' ? t('nav.item.autoPrediction') : t('office.harness.chat')
  const workspaceSessionCount = props.harness === 'auto-quant'
    ? t('autoQuant.workspaceSessionCount', { count: props.sessionCount })
    : props.harness === 'prediction'
      ? t('autoPrediction.workspaceSessionCount', { count: props.sessionCount })
      : t('chat.workspaceSessionCount', { count: props.sessionCount })
  const workspaceMeta = props.workspace?.displayName
    ? `${props.workspace.tag} · ${workspaceSessionCount}`
    : workspaceSessionCount
  const upgrade = props.workspace?.upgradeAvailable ?? null
  const upgradeVersion = upgrade?.to.replace(/^v(?=\d)/, '') ?? ''
  const contextMenuLabel = props.harness === 'auto-quant'
    ? t('autoQuant.workspaceContextMenu')
    : props.harness === 'prediction'
      ? t('autoPrediction.workspaceContextMenu')
      : t('chat.workspaceContextMenu')

  const queueAction = (action: () => void) => {
    pendingActionRef.current = action
  }

  const menuItemClass = 'oa-workspace-context-item min-h-7 gap-2 rounded-md px-2 py-1 text-muted-foreground focus:bg-muted focus:text-foreground'

  return (
    <div className={props.iconOnly ? 'shrink-0' : 'shrink-0 border-t border-border/60 bg-secondary p-1.5'}>
      <DropdownMenu
        open={open}
        onOpenChange={setOpen}
        onOpenChangeComplete={(nextOpen) => {
          if (nextOpen) return
          const action = pendingActionRef.current
          pendingActionRef.current = null
          if (!action) return
          triggerRef.current?.focus()
          action()
        }}
      >
        <DropdownMenuTrigger
          render={<button
            ref={triggerRef}
            type="button"
            aria-label={upgrade
              ? t('chat.workspaceContextUpdateLabel', { name: workspaceTitle, version: upgradeVersion })
              : contextMenuLabel}
            className={props.iconOnly ? 'oa-icon-action relative flex h-8 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-sidebar-accent hover:text-foreground' : 'oa-pressable text-caption flex min-h-8 w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-muted-foreground hover:bg-muted hover:text-foreground'}
          />}
        >
          {!props.iconOnly && <AppWindow className="h-3.5 w-3.5 shrink-0" aria-hidden />}
          <span
            className={props.iconOnly ? 'sr-only' : 'min-w-0 flex-1 truncate font-medium text-foreground'}
            title={harnessTitle}
          >
            {harnessTitle}
          </span>
          {upgrade && <span className={`h-1.5 w-1.5 shrink-0 rounded-full bg-primary ${props.iconOnly ? 'absolute right-0 top-0' : ''}`} aria-hidden />}
          <MoreHorizontal className="h-3.5 w-3.5 shrink-0" aria-hidden />
        </DropdownMenuTrigger>

        <DropdownMenuContent
          aria-labelledby={contextMenuLabelId}
          side={props.iconOnly ? 'bottom' : 'top'}
          align="start"
          sideOffset={4}
          className="z-40 max-h-[min(30rem,calc(100vh-1rem))] w-60 max-w-[calc(100vw-1rem)] overflow-y-auto overscroll-contain rounded-xl border border-border/70 bg-popover p-1 text-popover-foreground shadow-lg ring-0 [scrollbar-gutter:stable]"
        >
          <span id={contextMenuLabelId} className="sr-only">{contextMenuLabel}</span>
          <DropdownMenuGroup>
            <DropdownMenuLabel className="text-micro px-2 py-1 font-medium text-muted-foreground/70">
              {t('settings.group.workspace')}
            </DropdownMenuLabel>
            <div className="flex items-stretch gap-1">
              <DropdownMenuItem
                disabled={!props.workspace}
                onClick={() => queueAction(props.onDetails)}
                title={t('workspaceDetails.title')}
                aria-label={props.workspace
                  ? t('chat.currentWorkspaceLabel', { workspace: workspaceDisplayTitle(props.workspace) })
                  : t('chat.currentWorkspace')}
                className="oa-workspace-context-item min-h-12 min-w-0 flex-1 cursor-pointer items-start gap-2 rounded-lg px-2 py-2 text-foreground focus:bg-muted focus:text-foreground"
              >
                <LayoutGrid size={15} strokeWidth={2} className="mt-0.5 shrink-0" aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{workspaceTitle}</span>
                  {props.workspace && (
                    <span className="text-micro mt-0.5 block truncate font-normal text-muted-foreground">
                      {workspaceMeta}
                    </span>
                  )}
                </span>
              </DropdownMenuItem>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger aria-label={t('chat.switchWorkspace')} title={t('chat.switchWorkspace')}
                  className="oa-workspace-context-item min-h-12 w-8 shrink-0 justify-center rounded-lg px-1 text-muted-foreground focus:bg-muted focus:text-foreground [&>svg]:mx-auto">
                  <span className="sr-only">{t('chat.switchWorkspace')}</span>
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent
                  sideOffset={6}
                  className="flex max-h-[min(24rem,var(--available-height))] w-60 max-w-[calc(100vw-1rem)] flex-col overflow-hidden rounded-xl border border-border/70 p-1 shadow-lg ring-0"
                >
                  <DropdownMenuGroup className="shrink-0">
                    <DropdownMenuLabel className="text-micro px-2 py-1 font-medium text-muted-foreground/70">
                      {t('chat.switchWorkspace')}
                    </DropdownMenuLabel>
                  </DropdownMenuGroup>
                  <DropdownMenuRadioGroup value={props.workspace?.id ?? ''}
                    className="min-h-0 overflow-y-auto overscroll-contain">
                    {props.workspaces.map((workspace) => (
                      <DropdownMenuRadioItem key={workspace.id} value={workspace.id} closeOnClick
                        aria-label={workspaceDisplayTitle(workspace)}
                        title={workspaceDisplayTitle(workspace)}
                        onClick={() => queueAction(() => props.onSelectWorkspace(workspace.id))}
                        className="oa-workspace-context-item min-h-8 gap-2 rounded-md py-1 pl-2 pr-8"
                      >
                        <span className="min-w-0 flex-1 truncate">{workspaceDisplayName(workspace)}</span>
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                  <DropdownMenuSeparator className="mx-0 shrink-0 bg-border/60" />
                  <DropdownMenuItem onClick={() => queueAction(props.onCreateWorkspace)}
                    className={menuItemClass + ' shrink-0'}>
                    <Plus size={14} strokeWidth={2} aria-hidden />
                    <span className="min-w-0 flex-1 truncate">{props.createWorkspaceLabel}</span>
                  </DropdownMenuItem>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            </div>
          </DropdownMenuGroup>

          <DropdownMenuSeparator className="mx-0 bg-border/60" />

          <DropdownMenuItem
            onClick={() => queueAction(props.onConfigure)}
            disabled={!props.workspace}
            className={menuItemClass}
          >
            <SettingsIcon size={14} strokeWidth={2} aria-hidden />
            <span className="min-w-0 flex-1 truncate">{t('workspace.configure')}</span>
          </DropdownMenuItem>
          {upgrade && (
            <DropdownMenuItem
              onClick={() => queueAction(props.onUpgrade)}
              aria-label={t('chat.reviewWorkspaceUpdateLabel', { version: upgradeVersion })}
              className={`${menuItemClass} bg-muted font-medium text-foreground focus:bg-muted focus:text-foreground`}
            >
              <Layers3 size={14} strokeWidth={2} aria-hidden />
              <span className="min-w-0 flex-1 truncate">{t('chat.reviewWorkspaceUpdate')}</span>
              <span className="text-micro shrink-0 tabular-nums text-muted-foreground">v{upgradeVersion}</span>
            </DropdownMenuItem>
          )}
          <DropdownMenuItem
            onClick={() => queueAction(() => props.onBrowseSessions(triggerRef.current))}
            disabled={props.workspaces.length === 0}
            className={menuItemClass}
          >
            <ChevronRight size={14} strokeWidth={2} aria-hidden />
            <span className="min-w-0 flex-1 truncate">
              {props.harness === 'auto-quant'
                ? t('autoQuant.browseResearch')
                : props.harness === 'prediction'
                  ? t('autoPrediction.browseResearch')
                  : t('chat.browseWorkspace')}
            </span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

interface FocusedChatWorkspaceProps {
  harness: 'chat' | 'auto-quant' | 'prediction'
  workspace: Workspace | null
  sessions: readonly HarnessSession[]
  loading: boolean
  unavailable: boolean
  emptyCopy?: string
  isRowActive: (row: HarnessSession) => boolean
  onOpenSession: (row: HarnessSession) => void
  onPauseSession: (row: HarnessSession) => void
  onResumeSession: (row: HarnessSession) => void
  onDeleteSession: (row: HarnessSession) => void
  onArchiveSession: (row: HarnessSession) => void
  onSettingsSession: (row: HarnessSession) => void
  onBrowseSessions: (restoreFocus: HTMLElement) => void
  onCreateWorkspace: () => void
}

interface AllWorkspaceRecentSessionsProps {
  harness: 'chat' | 'auto-quant' | 'prediction'
  workspaces: readonly Workspace[]
  sessions: readonly HarnessSession[]
  loading: boolean
  unavailable: boolean
  isRowActive: (row: HarnessSession) => boolean
  onOpenSession: (row: HarnessSession) => void
  onPauseSession: (row: HarnessSession) => void
  onResumeSession: (row: HarnessSession) => void
  onDeleteSession: (row: HarnessSession) => void
  onArchiveSession: (row: HarnessSession) => void
  onSettingsSession: (row: HarnessSession) => void
  onBrowseSessions: (restoreFocus: HTMLElement) => void
  onCreateWorkspace: () => void
}

interface HarnessSessionRosterProps {
  harness: 'chat' | 'auto-quant' | 'prediction'
  sessions: readonly HarnessSession[]
  emptyCopy: string
  keyFor: (row: HarnessSession) => string
  workspaceLabelFor?: (row: HarnessSession) => string | undefined
  isRowActive: (row: HarnessSession) => boolean
  onOpenSession: (row: HarnessSession) => void
  onPauseSession: (row: HarnessSession) => void
  onResumeSession: (row: HarnessSession) => void
  onDeleteSession: (row: HarnessSession) => void
  onArchiveSession: (row: HarnessSession) => void
  onSettingsSession: (row: HarnessSession) => void
  onBrowseSessions: (restoreFocus: HTMLElement) => void
}

function HarnessSessionRoster(props: HarnessSessionRosterProps): ReactElement {
  const { t } = useTranslation()
  const [runningExpanded, setRunningExpanded] = useState(true)
  const running = props.sessions.filter((row) => row.headlessOccupying)
  const recent = props.sessions.filter((row) => !row.headlessOccupying)
  const visibleRecent = selectRecentSidebarWorkset(recent, props.isRowActive)
  const runningRef = useReorderMotion<HTMLDivElement>(running.map(props.keyFor))
  const recentRef = useReorderMotion<HTMLDivElement>(visibleRecent.map(props.keyFor))
  const renderRow = (row: HarnessSession) => (
    <HarnessSessionRow
      key={props.keyFor(row)}
      row={row}
      workspaceLabel={props.workspaceLabelFor?.(row)}
      isActive={props.isRowActive(row)}
      onSelect={() => props.onOpenSession(row)}
      onPause={() => props.onPauseSession(row)}
      onResume={() => props.onResumeSession(row)}
      onDelete={() => props.onDeleteSession(row)}
      onArchive={() => props.onArchiveSession(row)}
      onSettings={() => props.onSettingsSession(row)}
    />
  )

  return (
    <div className="min-h-0 flex-1 overflow-y-auto py-0.5">
      {running.length > 0 && (
        <section className="border-b border-border/55 pb-1" aria-label={t('chat.runningInBackground')}>
          <button
            type="button"
            className="oa-nav-row text-micro flex min-h-8 w-full items-center gap-2 px-3 text-left font-medium text-muted-foreground hover:text-foreground"
            onClick={() => setRunningExpanded((expanded) => !expanded)}
            aria-expanded={runningExpanded}
          >
            <LoaderCircle
              size={12}
              strokeWidth={2.25}
              className="shrink-0 animate-spin text-primary motion-reduce:animate-none"
              aria-hidden
            />
            <span className="min-w-0 flex-1 truncate">{t('chat.runningInBackground')}</span>
            <span className="tabular-nums text-muted-foreground/55">{running.length}</span>
            {runningExpanded
              ? <ChevronDown size={12} strokeWidth={2.25} aria-hidden />
              : <ChevronRight size={12} strokeWidth={2.25} aria-hidden />}
          </button>
          {runningExpanded && (
            <div ref={runningRef}>
              {running.map(renderRow)}
            </div>
          )}
        </section>
      )}

      <div className="flex min-h-8 items-center gap-2 px-3.5 pb-1 pt-2">
        <span data-testid="harness-recent-heading" className="text-caption min-w-0 flex-1 truncate font-medium text-muted-foreground/70">
          {props.harness === 'auto-quant'
            ? t('autoQuant.recentResearch')
            : props.harness === 'prediction'
              ? t('autoPrediction.recentResearch')
              : t('chat.recentConversations')}
        </span>
        {recent.length > 0 && (
          <span className="text-micro tabular-nums text-muted-foreground/50">{recent.length}</span>
        )}
      </div>

      <div ref={recentRef}>
        {props.sessions.length === 0 ? (
          <p className="text-caption px-3 py-3 text-muted-foreground/60">
            {props.emptyCopy}
          </p>
        ) : recent.length === 0 ? (
          <p className="text-caption px-3 py-2 text-muted-foreground/55">
            {t('chat.allConversationsRunning')}
          </p>
        ) : visibleRecent.map(renderRow)}
      </div>

      {recent.length > visibleRecent.length && (
        <button
          type="button"
          className="oa-nav-row text-body group mx-1.5 flex min-h-8 w-[calc(100%-0.75rem)] items-center gap-2 rounded-md px-2 py-1 text-left font-medium text-foreground hover:bg-sidebar-accent"
          onClick={(event) => props.onBrowseSessions(event.currentTarget)}
        >
          <span className="min-w-0 flex-1 truncate">
            {props.harness === 'auto-quant'
              ? t('autoQuant.viewAllResearch', { count: recent.length })
              : props.harness === 'prediction'
                ? t('autoPrediction.viewAllResearch', { count: recent.length })
                : t('chat.viewAllConversations', { count: recent.length })}
          </span>
          <ChevronRight
            size={13}
            strokeWidth={2.2}
            className="shrink-0 text-muted-foreground"
            aria-hidden
          />
        </button>
      )}
    </div>
  )
}

function AllWorkspaceRecentSessions(props: AllWorkspaceRecentSessionsProps): ReactElement {
  const { t } = useTranslation()
  const workspaceName = useMemo(
    () => new Map(props.workspaces.map((workspace) => [workspace.id, workspaceDisplayTitle(workspace)])),
    [props.workspaces],
  )
  const sessions = props.sessions

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
      <HarnessSessionRoster
        harness={props.harness}
        sessions={sessions}
        emptyCopy={props.harness === 'auto-quant'
          ? t('autoQuant.noResearchYet')
          : props.harness === 'prediction'
            ? t('autoPrediction.noResearchYet')
            : t('chat.noRecentConversations')}
        keyFor={(row) => `${row.workspaceId}:${row.resumeId}`}
        workspaceLabelFor={(row) => workspaceName.get(row.workspaceId)}
        isRowActive={props.isRowActive}
        onOpenSession={props.onOpenSession}
        onPauseSession={props.onPauseSession}
        onResumeSession={props.onResumeSession}
        onDeleteSession={props.onDeleteSession}
        onArchiveSession={props.onArchiveSession}
        onSettingsSession={props.onSettingsSession}
        onBrowseSessions={props.onBrowseSessions}
      />

      {props.workspaces.length === 0 && (
        <div className="border-t border-border/60 p-2">
          <Button
            variant="outline"
            onClick={props.onCreateWorkspace}
            className="w-full"
          >
            <PanelsTopLeft size={14} strokeWidth={2} aria-hidden />
            {t('chat.newWorkspace')}
          </Button>
        </div>
      )}
    </div>
  )
}

function FocusedChatWorkspace(props: FocusedChatWorkspaceProps): ReactElement {
  const { t } = useTranslation()
  const sessions = props.sessions

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
        <p className="text-caption leading-relaxed text-muted-foreground">
          {t('chat.focusedEmpty')}
        </p>
        <Button
          variant="outline"
          onClick={props.onCreateWorkspace}
          className="mt-3 w-full"
        >
          <PanelsTopLeft size={14} strokeWidth={2} aria-hidden />
          {t('chat.newWorkspace')}
        </Button>
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <HarnessSessionRoster
        harness={props.harness}
        sessions={sessions}
        emptyCopy={props.emptyCopy ?? t('chat.noConversationsYet')}
        keyFor={(row) => row.resumeId}
        isRowActive={props.isRowActive}
        onOpenSession={props.onOpenSession}
        onPauseSession={props.onPauseSession}
        onResumeSession={props.onResumeSession}
        onDeleteSession={props.onDeleteSession}
        onArchiveSession={props.onArchiveSession}
        onSettingsSession={props.onSettingsSession}
        onBrowseSessions={props.onBrowseSessions}
      />
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
    <div className="pb-1 pt-1">
      <div
        className={`group relative flex w-full items-center transition-colors ${
          props.isFocused
            ? 'bg-sidebar-accent text-sidebar-accent-foreground'
            : 'text-foreground hover:bg-sidebar-accent/65'
        }`}
      >
        {props.isFocused && <SelectionIndicator />}
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
          className="oa-pressable relative flex min-w-0 flex-1 items-center gap-2 py-2 pl-1 pr-3 text-left"
        >
          <Network size={14} strokeWidth={2.1} className="shrink-0 text-muted-foreground" />
          <span className="text-caption min-w-0 flex-1 truncate font-medium">{t('workspaceManager.title')}</span>
          {!props.loaded ? (
            <span aria-hidden className="h-2.5 w-4 animate-pulse rounded bg-muted-foreground/15" />
          ) : sessions.length > 0 ? (
            <span className="text-micro inline-flex shrink-0 items-center gap-1.5 tabular-nums text-muted-foreground/55">
              <span className={`h-1.5 w-1.5 rounded-full ${hasRunning ? 'bg-success' : 'bg-muted-foreground/35'}`} />
              {sessions.length}
            </span>
          ) : null}
        </button>
      </div>

      {expanded && sessions.length > 0 && (
        <div ref={sessionListRef} className="ml-[18px] border-l border-border/50">
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
  sessions: readonly HarnessSession[]
  label: string
  selection: { wsId: string; sessionId: string | null } | null
  isRowActive: (row: HarnessSession) => boolean
  onOpen: () => void
  onOpenSession: (row: HarnessSession) => void
  onPauseSession: (row: HarnessSession) => void
  onResumeSession: (row: HarnessSession) => void
  onDeleteSession: (row: HarnessSession) => void
  onArchiveSession: (row: HarnessSession) => void
  onSettingsSession: (row: HarnessSession) => void
  onConfigure: () => void
  onDelete: () => void
  /** Spawn a fresh agent session in THIS workspace (and open it). */
  onSpawn: () => void
}

function HarnessSessionRow(props: {
  enterOnSelect?: boolean
  row: HarnessSession
  workspaceLabel?: string
  isActive: boolean
  onSelect: () => void
  onPause: () => void
  onResume: () => void | Promise<void>
  onDelete: () => void
  onArchive?: () => void
  onRestore?: () => void
  onSettings?: () => void
}): ReactElement {
  const { t } = useTranslation()
  const row = props.row
  return (
    <SessionRow
      enterOnSelect={props.enterOnSelect}
      reorderId={`${row.workspaceId}:${row.resumeId}`}
      session={row.session.title === row.title ? row.session : { ...row.session, title: row.title }}
      displayTitle={row.title}
      subtitle={harnessSessionRosterSubtitle(row.sourceKind, t, props.workspaceLabel)}
      isActive={props.isActive}
      headlessOccupying={row.headlessOccupying}
      resumable={row.resumable}
      failed={row.failed}
      canDelete={false}
      onSelect={props.onSelect}
      onHeadlessBusy={props.onSelect}
      onPause={props.onPause}
      onResume={props.onResume}
      onDelete={props.onDelete}
      onArchive={props.onArchive}
      onRestore={props.onRestore}
      onSettings={props.onSettings}
    />
  )
}

function HeadlessSessionBusyDialog(props: {
  row: HarnessSession | null
  open: boolean
  onOpenChange: (open: boolean) => void
}): ReactElement {
  const { t } = useTranslation()
  const issueId = props.row?.issueId

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="min-w-0 overflow-hidden sm:max-w-md">
        <DialogHeader className="min-w-0">
          <div className="flex min-w-0 max-w-full items-start gap-3 pr-7">
            <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
              <LoaderCircle
                size={18}
                strokeWidth={2.25}
                className="animate-spin motion-reduce:animate-none"
                aria-hidden
              />
            </span>
            <div className="min-w-0 space-y-1.5">
              <DialogTitle>{t('chat.headlessBusyTitle')}</DialogTitle>
              <DialogDescription>{t('chat.headlessBusyDescription')}</DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {props.row && (
          <div className="min-w-0 max-w-full overflow-hidden rounded-lg border border-border/70 bg-muted/35 px-3.5 py-3">
            <p
              className="line-clamp-2 min-w-0 max-w-full break-words text-sm font-medium leading-snug text-foreground [overflow-wrap:anywhere]"
              title={props.row.title}
            >
              {props.row.title}
            </p>
            <p className="text-caption mt-1 text-muted-foreground">
              {issueId
                ? t('chat.headlessBusyIssue', { issue: issueId })
                : t('chat.headlessBusyAgent', { agent: props.row.agent })}
            </p>
          </div>
        )}

        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>
            {t('common.close')}
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ChatWorkspaceRow(props: ChatWorkspaceRowProps): ReactElement {
  const { t } = useTranslation()
  const w = props.workspace
  const orderedSessions = props.sessions
  const hasRunning = orderedSessions.some((row) => row.occupancyRunning)
  const [expanded, setExpanded] = useState(true)
  const isSelected = props.selection?.wsId === w.id && props.selection.sessionId === null
  const displayName = w.displayName?.trim()
  const subtitle = displayName && displayName !== w.tag ? w.tag : null
  const actionWorkspace = subtitle ? `${props.label} (${w.tag})` : w.tag
  const sessionListRef = useReorderMotion<HTMLDivElement>(
    orderedSessions.map((row) => row.resumeId),
  )

  const statusClass = hasRunning
    ? 'bg-success'
    : orderedSessions.length > 0
      ? 'bg-muted-foreground/40'
      : 'border border-border'

  return (
    <li className="group relative" data-reorder-id={w.id}>
      <div
        className={`text-body relative flex items-center gap-1 py-1 pl-2 pr-2 transition-colors ${
          isSelected ? 'bg-sidebar-accent text-sidebar-accent-foreground' : 'text-foreground hover:bg-sidebar-accent/65'
        }`}
      >
        {isSelected && <SelectionIndicator />}
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
            <span className="block truncate font-medium" title={props.label}>{props.label}</span>
            {subtitle && (
              <span className="text-micro block truncate text-muted-foreground/65" title={subtitle}>
                {subtitle}
              </span>
            )}
          </span>
          {orderedSessions.length > 0 && (
            <span className="text-micro shrink-0 tabular-nums text-muted-foreground/45">
              {orderedSessions.length}
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
              icon: <Trash2 size={13} strokeWidth={2} />,
              onSelect: props.onDelete,
              danger: true,
            },
          ]}
        />
      </div>
      {expanded && orderedSessions.length > 0 && (
        <div ref={sessionListRef} className="ml-[18px] border-l border-border/50">
          {orderedSessions.map((row) => (
            <HarnessSessionRow
              key={row.resumeId}
              row={row}
              isActive={props.isRowActive(row)}
              onSelect={() => props.onOpenSession(row)}
              onPause={() => props.onPauseSession(row)}
              onResume={() => props.onResumeSession(row)}
              onDelete={() => props.onDeleteSession(row)}
              onArchive={() => props.onArchiveSession(row)}
              onSettings={() => props.onSettingsSession(row)}
            />
          ))}
        </div>
      )}
    </li>
  )
}
