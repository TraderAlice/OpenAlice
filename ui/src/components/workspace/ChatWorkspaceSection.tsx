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

import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Check,
  AppWindow,
  ChevronDown,
  ChevronRight,
  Clock3,
  LayoutGrid,
  Layers3,
  LoaderCircle,
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
import {
  ConversationBrowserDialog,
  WorkspacePickerDialog,
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
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
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
  onRequestDisplayMode = () => undefined,
}: {
  onNavigate?: () => void
  mode?: 'chat' | 'auto-quant' | 'prediction'
  displayMode?: ChatDisplayMode
  onRequestDisplayMode?: (mode: ChatDisplayMode) => void
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
  const routeWorkspaceId = isWsFocus
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
  }), [harnessPreferences.showHeadlessBornSessions])
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
  const [workspacePickerOpen, setWorkspacePickerOpen] = useState(false)
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
        if (live) setRecentWorkspaceId(preferences.recentChatWorkspaceId)
      })
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [mode])

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
    if (mode === 'auto-quant') return
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

  const resumeRosterSession = (row: HarnessSession): void => {
    if (row.headlessOccupying || !row.resumable) return
    rememberViewedWorkspace(row.workspaceId)
    if (row.session.surface === 'webpi') {
      void ctx.openWebPiSession(row.workspaceId, row.session.id, source)
    } else {
      void ctx.resumeSession(row.workspaceId, row.session.id, source)
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

  const openWorkspacePicker = (restoreFocus: HTMLElement | null): void => {
    dialogRestoreFocusRef.current = restoreFocus
    setWorkspacePickerOpen(true)
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
  if (ctx.templatesLoaded && !chatTemplate && ctx.templatesError === null) return null

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Starting a conversation is the primary action. Creating a Workspace is
          a lower-frequency context-boundary action attached to the list it
          affects, rather than a competing half-width CTA. */}
      <div className="grid grid-cols-1 gap-2 px-2 pt-2 pb-1">
        <button
          type="button"
          onClick={() => navigate({
            kind: landingKind,
            params: displayMode === 'focused' && focusedWorkspace
              ? { targetWsId: focusedWorkspace.id }
              : {},
          })}
          className="oa-pressable flex w-full items-center gap-2 rounded-lg border border-primary/25 bg-primary/10 px-3 py-2.5 text-left text-[13px] font-medium text-foreground hover:border-primary/45 hover:bg-primary/15"
        >
          <MessageSquarePlus size={15} strokeWidth={2.15} className="shrink-0 text-primary" />
          <span>{mode === 'auto-quant'
            ? t('autoQuant.newResearch')
            : mode === 'prediction' ? t('autoPrediction.newResearch') : t('chat.newChat')}</span>
        </button>
        {mode !== 'chat' && focusedWorkspace && (
          <button
            type="button"
            onClick={() => navigate({
              kind: 'harness-surface',
              params: { wsId: focusedWorkspace.id, capability: 'studio', source: mode },
            })}
            className="oa-pressable flex w-full items-center gap-2 rounded-lg border border-border bg-background px-3 py-2.5 text-left text-[13px] font-medium text-foreground hover:border-primary/35 hover:bg-muted"
          >
            <AppWindow size={15} strokeWidth={2.05} className="shrink-0 text-primary" />
            <span>{t('harnessSurface.studio')}</span>
          </button>
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
        <span className="min-w-0 truncate text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/60">
          {t('nav.item.workspaces')}
        </span>
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
            <p className="text-[12px] text-muted-foreground/60">
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

      <ChatWorkspaceContextFooter
        harness={mode}
        workspace={focusedWorkspace}
        workspaces={chatWorkspaces}
        displayMode={displayMode}
        showManager={mode === 'chat'}
        createWorkspaceLabel={mode === 'auto-quant'
          ? t('autoQuant.newWorkspace')
          : mode === 'prediction' ? t('autoPrediction.newWorkspace') : t('chat.newWorkspace')}
        onRequestDisplayMode={onRequestDisplayMode}
        onConfigure={() => focusedWorkspace && ctx.openAgentConfig(focusedWorkspace.id)}
        onUpgrade={() => focusedWorkspace && ctx.openAgentConfig(focusedWorkspace.id, undefined, 'template')}
        onOpenWorkspacePicker={openWorkspacePicker}
        onBrowseSessions={(restoreFocus) => openConversationBrowser(focusedWorkspace?.id ?? null, restoreFocus)}
        onOpenManager={() => navigate({ kind: 'workspace-manager', params: {} })}
        onCreateWorkspace={() => setShowCreate(true)}
      />

      <WorkspacePickerDialog
        harness={mode}
        open={workspacePickerOpen}
        workspaces={chatWorkspaces}
        currentWorkspaceId={focusedWorkspace?.id ?? null}
        restoreFocusRef={dialogRestoreFocusRef}
        onOpenChange={setWorkspacePickerOpen}
        onSelectWorkspace={(workspaceId) => {
          selectHarnessWorkspace(workspaceId, () => {
            setWorkspacePickerOpen(false)
            onRequestDisplayMode('focused')
            navigate({ kind: landingKind, params: { targetWsId: workspaceId } })
          })
        }}
      />
      <ConversationBrowserDialog
        harness={mode}
        open={conversationBrowserOpen}
        workspaces={chatWorkspaces}
        directories={sessionDirectories.directories}
        includeHeadlessBornSessions={harnessPreferences.showHeadlessBornSessions}
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
              onRequestDisplayMode('focused')
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
  harness: 'chat' | 'auto-quant' | 'prediction'
  workspace: Workspace | null
  workspaces: readonly Workspace[]
  displayMode: ChatDisplayMode
  showManager: boolean
  createWorkspaceLabel: string
  onRequestDisplayMode: (mode: ChatDisplayMode) => void
  onConfigure: () => void
  onUpgrade: () => void
  onOpenWorkspacePicker: (restoreFocus: HTMLElement | null) => void
  onBrowseSessions: (restoreFocus: HTMLElement | null) => void
  onOpenManager: () => void
  onCreateWorkspace: () => void
}

function ChatWorkspaceContextFooter(props: ChatWorkspaceContextFooterProps): ReactElement {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement | null>(null)

  const closeAndRun = (action: () => void) => {
    setOpen(false)
    action()
  }
  const title = props.displayMode === 'focused'
    ? (props.workspace ? workspaceDisplayName(props.workspace) : t('chat.currentWorkspace'))
    : props.displayMode === 'recent'
      ? (props.harness === 'auto-quant'
          ? t('autoQuant.recentResearch')
          : props.harness === 'prediction'
            ? t('autoPrediction.recentResearch')
            : t('chat.recentConversations'))
      : t('nav.item.workspaces')
  const subtitle = props.displayMode === 'focused'
    ? t('chat.currentWorkspace')
    : props.displayMode === 'recent'
      ? t('chat.allWorkspaces')
      : t('chat.multiModeDescription')
  const TriggerIcon = props.displayMode === 'recent' ? Clock3 : LayoutGrid
  const upgrade = props.workspace?.upgradeAvailable ?? null
  const upgradeVersion = upgrade?.to.replace(/^v(?=\d)/, '') ?? ''
  const contextLabel = props.harness === 'auto-quant'
    ? t('autoQuant.workspaceContextLabel', { name: title })
    : props.harness === 'prediction'
      ? t('autoPrediction.workspaceContextLabel', { name: title })
      : t('chat.workspaceContextLabel', { name: title })
  const contextMenuLabel = props.harness === 'auto-quant'
    ? t('autoQuant.workspaceContextMenu')
    : props.harness === 'prediction'
      ? t('autoPrediction.workspaceContextMenu')
      : t('chat.workspaceContextMenu')

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
    <div className="shrink-0 border-t border-border/60 bg-secondary p-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={<button
            ref={triggerRef}
            type="button"
            aria-label={upgrade
              ? t('chat.workspaceContextUpdateLabel', { name: title, version: upgradeVersion })
              : contextLabel}
            className="oa-pressable flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
          />}
        >
          <TriggerIcon className="h-3.5 w-3.5 shrink-0" aria-hidden />
          <span className="min-w-0 flex-1">
            <span className="block truncate font-medium text-foreground" title={props.displayMode === 'focused' && props.workspace ? workspaceDisplayTitle(props.workspace) : title}>
              {title}
            </span>
            <span className={`mt-0.5 block truncate text-[10px] ${upgrade ? 'font-medium text-primary' : 'text-muted-foreground/70'}`}>
              {upgrade ? t('chat.workspaceUpdateAvailable', { version: upgradeVersion }) : subtitle}
            </span>
          </span>
          {upgrade && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" aria-hidden />}
          <ChevronDown className={`h-3.5 w-3.5 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden />
        </PopoverTrigger>

        <PopoverContent
          role="dialog"
          aria-label={contextMenuLabel}
          side="top"
          align="start"
          sideOffset={4}
          initialFocus={false}
          className="z-40 max-h-[min(34rem,calc(100vh-1rem))] w-72 max-w-[calc(100vw-1rem)] gap-0 overflow-y-auto overscroll-contain rounded-lg border border-border/70 bg-popover p-1.5 text-popover-foreground shadow-lg ring-0 [scrollbar-gutter:stable]"
        >
          <p className="px-2 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/60">
            {t('chat.view')}
          </p>
          {modeOption('focused', t('chat.currentWorkspace'), <LayoutGrid size={14} strokeWidth={2} />, props.workspace === null)}
          {modeOption('recent', t('chat.recentMode'), <Clock3 size={14} strokeWidth={2} />)}
          {modeOption('multi', t('chat.multiMode'), <PanelsTopLeft size={14} strokeWidth={2} />)}

          <div className="my-1 border-t border-border/60" />

          <button
            type="button"
            onClick={() => closeAndRun(() => props.onOpenWorkspacePicker(triggerRef.current))}
            disabled={props.workspaces.length === 0}
            className="flex min-h-9 w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-default disabled:opacity-40"
          >
            <LayoutGrid size={14} strokeWidth={2} aria-hidden />
            <span className="min-w-0 flex-1 truncate">{t('chat.switchWorkspace')}</span>
            <ChevronRight size={13} strokeWidth={2} className="shrink-0 text-muted-foreground/60" aria-hidden />
          </button>

          <button
            type="button"
            onClick={() => closeAndRun(props.onConfigure)}
            disabled={!props.workspace}
            className="flex min-h-9 w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-default disabled:opacity-40"
          >
            <SettingsIcon size={14} strokeWidth={2} aria-hidden />
            <span className="min-w-0 flex-1 truncate">{t('workspace.configure')}</span>
          </button>
          {upgrade && (
            <button
              type="button"
              onClick={() => closeAndRun(props.onUpgrade)}
              aria-label={t('chat.reviewWorkspaceUpdateLabel', { version: upgradeVersion })}
              className="flex min-h-9 w-full items-center gap-2.5 rounded-md bg-primary/10 px-2.5 py-2 text-left text-xs font-medium text-primary transition-colors hover:bg-primary/15"
            >
              <Layers3 size={14} strokeWidth={2} aria-hidden />
              <span className="min-w-0 flex-1 truncate">{t('chat.reviewWorkspaceUpdate')}</span>
              <span className="shrink-0 tabular-nums text-[10px] text-primary/75">v{upgradeVersion}</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => closeAndRun(() => props.onBrowseSessions(triggerRef.current))}
            disabled={props.workspaces.length === 0}
            className="flex min-h-9 w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-default disabled:opacity-40"
          >
            <ChevronRight size={14} strokeWidth={2} aria-hidden />
            <span className="min-w-0 flex-1 truncate">
              {props.harness === 'auto-quant'
                ? t('autoQuant.browseResearch')
                : props.harness === 'prediction'
                  ? t('autoPrediction.browseResearch')
                  : t('chat.browseWorkspace')}
            </span>
          </button>
          {props.showManager && (
            <button
              type="button"
              onClick={() => closeAndRun(props.onOpenManager)}
              className="flex min-h-9 w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <Network size={14} strokeWidth={2} aria-hidden />
              <span className="min-w-0 flex-1 truncate">{t('workspaceManager.title')}</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => closeAndRun(props.onCreateWorkspace)}
            className="flex min-h-9 w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <PanelsTopLeft size={14} strokeWidth={2} aria-hidden />
            <span className="min-w-0 flex-1 truncate">{props.createWorkspaceLabel}</span>
          </button>
        </PopoverContent>
      </Popover>
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
            className="oa-nav-row flex min-h-8 w-full items-center gap-2 px-3 text-left text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground hover:text-foreground"
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
            <div ref={runningRef} className="oa-disclosure-enter">
              {running.map(renderRow)}
            </div>
          )}
        </section>
      )}

      <div className="flex items-center gap-2 px-3 pb-1 pt-1.5">
        <span className="min-w-0 flex-1 truncate text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/60">
          {props.harness === 'auto-quant'
            ? t('autoQuant.recentResearch')
            : props.harness === 'prediction'
              ? t('autoPrediction.recentResearch')
              : t('chat.recentConversations')}
        </span>
        {recent.length > 0 && (
          <span className="text-[10px] tabular-nums text-muted-foreground/45">{recent.length}</span>
        )}
      </div>

      <div ref={recentRef}>
        {props.sessions.length === 0 ? (
          <p className="px-3 py-3 text-xs leading-relaxed text-muted-foreground/60">
            {props.emptyCopy}
          </p>
        ) : recent.length === 0 ? (
          <p className="px-3 py-2 text-[11px] leading-relaxed text-muted-foreground/55">
            {t('chat.allConversationsRunning')}
          </p>
        ) : visibleRecent.map(renderRow)}
      </div>

      {recent.length > visibleRecent.length && (
        <button
          type="button"
          className="oa-nav-row group flex min-h-9 w-full items-center gap-2 px-3 py-1.5 text-left text-xs font-medium text-primary hover:bg-primary/5"
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
            className="shrink-0 text-primary/65 transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none"
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
  row: HarnessSession
  workspaceLabel?: string
  isActive: boolean
  onSelect: () => void
  onPause: () => void
  onResume: () => void
  onDelete: () => void
  onArchive?: () => void
  onRestore?: () => void
  onSettings?: () => void
}): ReactElement {
  const { t } = useTranslation()
  const row = props.row
  return (
    <SessionRow
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
            <p className="mt-1 text-xs text-muted-foreground">
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
          {orderedSessions.length > 0 && (
            <span className="text-[11px] text-muted-foreground/45 tabular-nums shrink-0">
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
              icon: <X size={13} strokeWidth={2.5} />,
              onSelect: props.onDelete,
              danger: true,
            },
          ]}
        />
      </div>
      {expanded && orderedSessions.length > 0 && (
        <div ref={sessionListRef} className="oa-disclosure-enter ml-[18px] border-l border-border/50">
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
