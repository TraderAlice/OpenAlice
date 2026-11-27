/**
 * WorkspacesContext — shared state for the Workspaces feature.
 *
 * Session selection is driven entirely by OpenAlice's tab system: a session
 * tab carries `{ kind: 'workspace', params: { wsId, sessionId } }`, and
 * which session is "active" is whichever tab is focused. The provider's
 * job is to:
 *
 *   - poll the workspaces list and templates/agents one-shot
 *   - drive spawn/pause/resume/delete actions against the backend
 *   - reconcile tab state with server state (e.g., close orphan tabs when
 *     a session/workspace disappears from the list)
 *
 * Closing a tab via its X button does NOT delete or pause the session —
 * VS-Code-style "close editor view, server keeps running". To actually
 * remove a session, use the sidebar's × button.
 */

import { setLaunchPreview } from '../components/conversation/launch-preview'
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'

import { useTranslation } from 'react-i18next'

import '../components/workspace/workspaces.css'

import { ConfirmDialog } from '../components/ConfirmDialog'
import { useToast } from '../components/Toast'
import {
  publishTerminalViewAttributes,
  useTerminalAppearance,
} from '../components/workspace/terminalAppearance'
import { WorkspaceAIConfigModal, type Tab } from '../components/workspace/WorkspaceAIConfigModal'
import {
  activateWorkspace as apiActivateWorkspace,
  deleteSession as apiDeleteSession,
  type AgentId,
  getIssueDefaultAgent,
  getAutoQuantDefaultWorkspace,
  getAutoPredictionDefaultWorkspace,
  getWorkspaceActivationPreview,
  getCommander,
  getWorkspaceSessionDirectory,
  getWorkspaceDefaultAgent,
  listTemplates,
  listWorkspaces,
  initializeAutoQuantWorkspace as apiInitializeAutoQuantWorkspace,
  initializeAutoPredictionWorkspace as apiInitializeAutoPredictionWorkspace,
  initializeChatWorkspace as apiInitializeChatWorkspace,
  openCommander as apiOpenCommander,
  openWebSession as apiOpenWebSession,
  openResumeSession,
  pauseSession as apiPauseSession,
  quickChat as apiQuickChat,
  resumeSession as apiResumeSession,
  setSessionDisplayName as apiSetSessionDisplayName,
  setSessionPresence as apiSetSessionPresence,
  type SessionPresence,
  setIssueDefaultAgent as apiSetIssueDefaultAgent,
  setAutoQuantDefaultWorkspace as apiSetAutoQuantDefaultWorkspace,
  setAutoPredictionDefaultWorkspace as apiSetAutoPredictionDefaultWorkspace,
  setWorkspaceDefaultAgent as apiSetWorkspaceDefaultAgent,
  spawnSession,
  updatePausedSessionRuntime as apiUpdatePausedSessionRuntime,
  updateWorkspaceMetadata,
  type PausedSessionRuntimeUpdate,
  COMMANDER_WORKSPACE_ID,
  type CommanderOpenInput,
  type CommanderOpenResult,
  type CommanderSnapshot,
  type SessionRecord,
  type TemplateInfo,
  type Workspace,
  type WorkspaceActivationPreview,
} from '../components/workspace/api'
import { workspaceDisplayName } from '../components/workspace/display'
import { useWorkspace } from '../tabs/store'
import type { WorkspaceSource } from '../tabs/types'
import {
  WorkspacesContext,
  type SpawnOpts,
  type WorkspacesContextValue,
} from './workspaces-context'
import { WorkspaceActionsContext } from './workspace-actions-context'
import { reconcileWorkspaceList } from './workspace-list-reconcile'
import { reconcileJsonSnapshot } from '../lib/reconcile-json-state'
import { useAgentRuntimes } from '../hooks/useAgentRuntimes'

function deprecatedExportTab(agent: AgentId | undefined): Tab | undefined {
  if (agent === 'claude' || agent === 'codex' || agent === 'opencode' || agent === 'pi') return agent
  return undefined
}

const LIST_POLL_MS = 3000

export function WorkspacesProvider({ children, renderContent }: { children: ReactNode; renderContent?: (content: ReactNode) => ReactNode }) {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [templates, setTemplates] = useState<TemplateInfo[]>([])
  const [templatesLoaded, setTemplatesLoaded] = useState(false)
  const [templatesError, setTemplatesError] = useState<string | null>(null)
  const [autoQuantDefaultWorkspaceId, setAutoQuantDefaultWorkspaceId] = useState<string | null>(null)
  const [autoQuantPreferenceLoaded, setAutoQuantPreferenceLoaded] = useState(false)
  const [autoQuantPreferenceError, setAutoQuantPreferenceError] = useState<string | null>(null)
  const [autoPredictionDefaultWorkspaceId, setAutoPredictionDefaultWorkspaceId] = useState<string | null>(null)
  const [autoPredictionPreferenceLoaded, setAutoPredictionPreferenceLoaded] = useState(false)
  const [autoPredictionPreferenceError, setAutoPredictionPreferenceError] = useState<string | null>(null)
  const { agents } = useAgentRuntimes()
  const [defaultAgent, setDefaultAgentState] = useState<string | null>(null)
  const [issueDefaultAgent, setIssueDefaultAgentState] = useState<string | null>(null)
  const [listError, setListError] = useState<string | null>(null)
  const [commander, setCommander] = useState<CommanderSnapshot | null>(null)
  const [commanderLoaded, setCommanderLoaded] = useState(false)
  const [commanderError, setCommanderError] = useState<string | null>(null)
  // Don't reconcile orphan tabs until we've successfully fetched the
  // workspaces list at least once — otherwise the initial `[]` looks like
  // "every workspace was just deleted" and a deep-linked workspace URL
  // gets its freshly-opened tab closed before the first poll lands.
  const [hasLoaded, setHasLoaded] = useState(false)
  // AI-provider config modal target. Lifted to context so the sidebar
  // gear button (no workspace tab needed) and the WorkspacePage header
  // button share one modal instance — and the modal survives activity
  // switches (rendered here, not inside an activity-scoped component).
  const [configuringAgentTarget, setConfiguringAgentTarget] = useState<{
    wsId: string
    agent?: AgentId
    section?: 'general' | 'launch' | 'ai' | 'template' | 'absorb'
    absorbSourceWsId?: string
  } | null>(null)
  const [pendingSessionDelete, setPendingSessionDelete] = useState<{ wsId: string; sessionId: string } | null>(null)
  const [activatingWorkspaceId, setActivatingWorkspaceId] = useState<string | null>(null)
  const [pendingActivation, setPendingActivation] = useState<{
    wsId: string
    preview: WorkspaceActivationPreview
    resolve: (activated: boolean) => void
  } | null>(null)
  const { t } = useTranslation()
  const toast = useToast()
  const terminalAppearance = useTerminalAppearance()

  const ensureTerminalAppearancePublished = useCallback(async (): Promise<void> => {
    try {
      await publishTerminalViewAttributes(terminalAppearance.viewAttributes)
    } catch (err) {
      // A missing push means hidden queries stay silent; never fall back to a
      // fabricated palette or block the rest of the product from starting.
      console.warn('workspaces.terminal_appearance_publish_failed', err)
    }
  }, [terminalAppearance.viewAttributes])

  const openOrFocus = useWorkspace((s) => s.openOrFocus)
  const closeTab = useWorkspace((s) => s.closeTab)
  const setSidebar = useWorkspace((s) => s.setSidebar)

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const list = await listWorkspaces()
      setWorkspaces((current) => reconcileWorkspaceList(current, list))
      setHasLoaded(true)
      setListError(null)
    } catch (err) {
      setListError((err as Error).message)
    }
  }, [])

  const refreshCommander = useCallback(async (): Promise<void> => {
    try {
      const incoming = await getCommander()
      setCommander((current) => reconcileJsonSnapshot(current, incoming))
      setCommanderError(null)
    } catch (err) {
      setCommanderError((err as Error).message)
    } finally {
      setCommanderLoaded(true)
    }
  }, [])

  const refreshTemplates = useCallback(async (): Promise<void> => {
    try {
      setTemplates(await listTemplates())
      setTemplatesError(null)
    } catch (error) {
      setTemplatesError((error as Error).message)
    } finally {
      setTemplatesLoaded(true)
    }
  }, [])

  const refreshAutoQuantPreference = useCallback(async (): Promise<void> => {
    try {
      const status = await getAutoQuantDefaultWorkspace()
      setAutoQuantDefaultWorkspaceId(status.defaultWorkspaceId)
      setAutoQuantPreferenceError(null)
    } catch (error) {
      setAutoQuantPreferenceError((error as Error).message)
    } finally {
      setAutoQuantPreferenceLoaded(true)
    }
  }, [])

  const refreshAutoPredictionPreference = useCallback(async (): Promise<void> => {
    try {
      const status = await getAutoPredictionDefaultWorkspace()
      setAutoPredictionDefaultWorkspaceId(status.defaultWorkspaceId)
      setAutoPredictionPreferenceError(null)
    } catch (error) {
      setAutoPredictionPreferenceError((error as Error).message)
    } finally {
      setAutoPredictionPreferenceLoaded(true)
    }
  }, [])

  useEffect(() => {
    void ensureTerminalAppearancePublished()
  }, [ensureTerminalAppearancePublished])

  useEffect(() => {
    void refresh()
    const id = setInterval(() => void refresh(), LIST_POLL_MS)
    return () => clearInterval(id)
  }, [refresh])

  useEffect(() => {
    void refreshCommander()
    const id = setInterval(() => void refreshCommander(), LIST_POLL_MS)
    return () => clearInterval(id)
  }, [refreshCommander])

  useEffect(() => {
    void refreshTemplates()
    void getWorkspaceDefaultAgent().then(setDefaultAgentState).catch(() => setDefaultAgentState(null))
    void getIssueDefaultAgent().then(setIssueDefaultAgentState).catch(() => setIssueDefaultAgentState(null))
    void refreshAutoQuantPreference()
    void refreshAutoPredictionPreference()
  }, [refreshAutoPredictionPreference, refreshAutoQuantPreference, refreshTemplates])

  // Reconcile tabs against the workspaces list. If a workspace or session
  // disappeared (deleted on disk / on the server), close any tabs that
  // referenced it so they don't dangle as 404s.
  useEffect(() => {
    if (!hasLoaded) return
    const validW = new Set<string>()
    const validS = new Set<string>() // key = `${wsId}::${sessionId}`
    for (const w of workspaces) {
      validW.add(w.id)
      for (const s of w.sessions) validS.add(`${w.id}::${s.id}`)
    }
    const tabsSnap = useWorkspace.getState().tabs
    for (const tabId of Object.keys(tabsSnap)) {
      const tab = tabsSnap[tabId]
      if (!tab || tab.spec.kind !== 'workspace') continue
      const wsId = tab.spec.params.wsId
      const sid = tab.spec.params.sessionId
      if (!validW.has(wsId)) {
        closeTab(tabId)
        continue
      }
      if (sid && !validS.has(`${wsId}::${sid}`)) {
        closeTab(tabId)
      }
    }
  }, [hasLoaded, workspaces, closeTab])

  const spawn = useCallback(
    async (wsId: string, opts: SpawnOpts = {}, source?: WorkspaceSource): Promise<void> => {
      try {
        await ensureTerminalAppearancePublished()
        const sess = await spawnSession(wsId, opts)
        const nowIso = new Date().toISOString()
        const newRecord: SessionRecord = {
          id: sess.sessionId,
          wsId,
          agent: sess.agent,
          name: sess.name,
          createdAt: nowIso,
          lastActiveAt: nowIso,
          state: 'running',
          surface: sess.surface ?? 'terminal',
          resumeId: sess.resumeId,
          pid: sess.pid,
          startedAt: sess.startedAt,
          title: sess.title,
        }
        setWorkspaces((prev) =>
          prev.map((w) =>
            w.id === wsId ? { ...w, sessions: [...w.sessions, newRecord] } : w,
          ),
        )
        openOrFocus({
          kind: 'workspace',
          params: {
            wsId,
            sessionId: sess.sessionId,
            ...(source ? { source } : {}),
          },
        })
        void refresh()
      } catch (err) {
        console.error('workspaces.spawn_failed', { wsId, opts, err })
      }
    },
    [ensureTerminalAppearancePublished, refresh, openOrFocus],
  )

  const setDefaultAgent = useCallback(async (agent: string | null): Promise<void> => {
    const saved = await apiSetWorkspaceDefaultAgent(agent)
    setDefaultAgentState(saved)
  }, [])

  const [interactiveConsent, setInteractiveConsent] = useState<{ resolve: (confirmed: boolean) => void } | null>(null)
  const confirmInteractiveSession = useCallback(async (wsId: string, resumeId: string): Promise<boolean> => {
    if (wsId === COMMANDER_WORKSPACE_ID) return true
    const directory = await getWorkspaceSessionDirectory(wsId, resumeId)
    const identity = directory.sessions.find((entry) => entry.resumeId === resumeId)
    if (!identity?.issueAttached && identity?.rosterVisibility !== 'hidden') return true
    return new Promise<boolean>((resolve) => {
      setInteractiveConsent((previous) => {
        previous?.resolve(false)
        return { resolve }
      })
    })
  }, [])

  const openHeadlessRun = useCallback(
    async (
      wsId: string,
      resumeId: string,
      opts: { title?: string } = {},
    ): Promise<void> => {
      if (!await confirmInteractiveSession(wsId, resumeId)) return
      const { session } = await openResumeSession(wsId, resumeId, opts)
      let nextSession = session
      if (session.state === 'paused') {
        await ensureTerminalAppearancePublished()
        const resumed = await apiResumeSession(wsId, session.id)
        if (resumed) {
          nextSession = {
            ...session,
            state: 'running',
            surface: 'terminal',
            pid: resumed.pid,
            startedAt: resumed.startedAt,
            resumeId: resumed.resumeId ?? session.resumeId,
            lastActiveAt: new Date().toISOString(),
          }
        }
      }
      setWorkspaces((prev) =>
        prev.map((workspace) =>
          workspace.id === wsId
            ? {
                ...workspace,
                sessions: workspace.sessions.some((candidate) => candidate.id === nextSession.id)
                  ? workspace.sessions.map((candidate) =>
                      candidate.id === nextSession.id ? nextSession : candidate,
                    )
                  : [...workspace.sessions, nextSession],
              }
            : workspace,
        ),
      )
      // A resumed headless conversation is user-facing Chat, even though its
      // durable Session still belongs to a Workspace underneath.
      setSidebar('chat')
      openOrFocus({
        kind: 'workspace',
        params: { wsId, sessionId: nextSession.id, source: 'chat' },
      })
      void refresh()
    },
    [confirmInteractiveSession, ensureTerminalAppearancePublished, openOrFocus, refresh, setSidebar],
  )

  const setIssueDefaultAgent = useCallback(async (agent: string | null): Promise<void> => {
    const saved = await apiSetIssueDefaultAgent(agent)
    setIssueDefaultAgentState(saved)
  }, [])

  const initializeAutoQuant = useCallback(async (): Promise<Workspace> => {
    const workspace = await apiInitializeAutoQuantWorkspace()
    setWorkspaces((current) => [
      workspace,
      ...current.filter((candidate) => candidate.id !== workspace.id),
    ])
    setAutoQuantDefaultWorkspaceId(workspace.id)
    setAutoQuantPreferenceError(null)
    void refresh()
    return workspace
  }, [refresh])

  const initializeAutoPrediction = useCallback(async (): Promise<Workspace> => {
    const workspace = await apiInitializeAutoPredictionWorkspace()
    setWorkspaces((current) => [
      workspace,
      ...current.filter((candidate) => candidate.id !== workspace.id),
    ])
    setAutoPredictionDefaultWorkspaceId(workspace.id)
    setAutoPredictionPreferenceError(null)
    void refresh()
    return workspace
  }, [refresh])

  const initializeChat = useCallback(async (): Promise<Workspace> => {
    const workspace = await apiInitializeChatWorkspace()
    setWorkspaces((current) => [
      workspace,
      ...current.filter((candidate) => candidate.id !== workspace.id),
    ])
    void refresh()
    return workspace
  }, [refresh])

  const setAutoQuantDefaultWorkspace = useCallback(async (workspaceId: string): Promise<void> => {
    const saved = await apiSetAutoQuantDefaultWorkspace(workspaceId)
    setAutoQuantDefaultWorkspaceId(saved.defaultWorkspaceId)
    setAutoQuantPreferenceError(null)
  }, [])

  const setAutoPredictionDefaultWorkspace = useCallback(async (workspaceId: string): Promise<void> => {
    const saved = await apiSetAutoPredictionDefaultWorkspace(workspaceId)
    setAutoPredictionDefaultWorkspaceId(saved.defaultWorkspaceId)
    setAutoPredictionPreferenceError(null)
  }, [])

  const quickChat = useCallback(
    async (
      prompt: string,
      agent?: string,
      credentialSlug?: string,
      targetWsId?: string,
      template?: 'chat' | 'auto-quant-v2' | 'auto-prediction',
      model?: string | null,
      reasoningEffort?: import('../api').ModelReasoningEffort,
      credentialSource?: 'native',
      surface?: 'terminal' | 'webpi',
    ): Promise<string> => {
      await ensureTerminalAppearancePublished()
      const { workspace, session } = await apiQuickChat(
        prompt,
        agent,
        credentialSlug,
        targetWsId,
        template,
        model,
        reasoningEffort,
        credentialSource,
        surface,
      )
      if (session.surface === 'webpi') setLaunchPreview(workspace.id, session.sessionId, prompt)
      const nowIso = new Date().toISOString()
      const newRecord: SessionRecord = {
        id: session.sessionId,
        wsId: workspace.id,
        agent: session.agent,
        name: session.name,
        createdAt: nowIso,
        lastActiveAt: nowIso,
        state: 'running',
        surface: session.surface ?? 'terminal',
        resumeId: session.resumeId,
        pid: session.pid,
        startedAt: session.startedAt,
        title: session.title,
      }
      // Upsert so the terminal slot mounts immediately (before the 3s poll):
      // append to the reused workspace, or insert the just-created one. The
      // server's `workspace.sessions` already includes the new session
      // (publicMeta reads the registry post-create), so dedupe on id in BOTH
      // branches before appending the optimistic record.
      const withRecord = (sessions: readonly SessionRecord[]): SessionRecord[] => [
        ...sessions.filter((s) => s.id !== newRecord.id),
        newRecord,
      ]
      setWorkspaces((prev) => {
        if (prev.some((w) => w.id === workspace.id)) {
          return prev.map((w) =>
            w.id === workspace.id ? { ...w, sessions: withRecord(w.sessions) } : w,
          )
        }
        return [{ ...workspace, sessions: withRecord(workspace.sessions) }, ...prev]
      })
      openOrFocus({
        kind: 'workspace',
        params: {
          wsId: workspace.id,
          sessionId: session.sessionId,
          source: workspace.template === 'auto-quant-v2'
            ? 'auto-quant'
            : workspace.template === 'auto-prediction' ? 'prediction' : 'chat',
        },
      })
      void refresh()
      return workspace.id
    },
    [ensureTerminalAppearancePublished, refresh, openOrFocus],
  )

  const openCommander = useCallback(async (
    input: CommanderOpenInput = {},
  ): Promise<CommanderOpenResult> => {
    await ensureTerminalAppearancePublished()
    const result = await apiOpenCommander(input)
    if (input.prompt?.trim() && result.session.surface === 'webpi') {
      setLaunchPreview(COMMANDER_WORKSPACE_ID, result.session.id, input.prompt.trim())
    }
    setCommander(result.commander)
    setCommanderLoaded(true)
    setCommanderError(null)
    return result
  }, [ensureTerminalAppearancePublished])

  const pauseSession = useCallback(
    async (wsId: string, sessionId: string): Promise<void> => {
      const patch = {
        state: 'paused' as const,
        pid: null,
        startedAt: null,
        lastActiveAt: new Date().toISOString(),
      }
      if (wsId === COMMANDER_WORKSPACE_ID) {
        setCommander((current) => patchCommanderSession(current, sessionId, patch))
      } else {
        setWorkspaces((prev) => patchSession(prev, wsId, sessionId, patch))
      }
      await apiPauseSession(wsId, sessionId)
      if (wsId === COMMANDER_WORKSPACE_ID) void refreshCommander()
      else void refresh()
    },
    [refresh, refreshCommander],
  )

  const resumeSession = useCallback(
    async (wsId: string, sessionId: string, source?: WorkspaceSource): Promise<void> => {
      const record = workspaces.find((ws) => ws.id === wsId)?.sessions.find((entry) => entry.id === sessionId)
      if (record && !await confirmInteractiveSession(wsId, record.resumeId)) throw new Error('Session opening was cancelled.')
      await ensureTerminalAppearancePublished()
      const resp = await apiResumeSession(wsId, sessionId)
      const patch = {
        state: 'running' as const,
        surface: 'terminal' as const,
        pid: resp.pid,
        startedAt: resp.startedAt,
        lastActiveAt: new Date().toISOString(),
      }
      if (wsId === COMMANDER_WORKSPACE_ID) {
        setCommander((current) => patchCommanderSession(current, sessionId, patch))
        setSidebar('commander')
        openOrFocus({ kind: 'commander', params: {} })
        void refreshCommander()
      } else {
        setWorkspaces((prev) => patchSession(prev, wsId, sessionId, patch))
        openOrFocus({
          kind: 'workspace',
          params: { wsId, sessionId, ...(source ? { source } : {}) },
        })
        void refresh()
      }
    },
    [confirmInteractiveSession, workspaces, ensureTerminalAppearancePublished, refresh, refreshCommander, openOrFocus, setSidebar],
  )

  const openWebSession = useCallback(
    async (wsId: string, sessionId: string, source?: WorkspaceSource): Promise<void> => {
      const record = workspaces.find((ws) => ws.id === wsId)?.sessions.find((entry) => entry.id === sessionId)
      if (record && !await confirmInteractiveSession(wsId, record.resumeId)) throw new Error('Session opening was cancelled.')
      const snapshot = await apiOpenWebSession(wsId, sessionId)
      const patch = {
        state: 'running' as const,
        surface: 'webpi' as const,
        pid: snapshot.pid,
        startedAt: snapshot.startedAt,
        lastActiveAt: new Date().toISOString(),
      }
      if (wsId === COMMANDER_WORKSPACE_ID) {
        setCommander((current) => patchCommanderSession(current, sessionId, patch))
        setSidebar('commander')
        openOrFocus({ kind: 'commander', params: {} })
        void refreshCommander()
      } else {
        setWorkspaces((prev) => patchSession(prev, wsId, sessionId, patch))
        openOrFocus({
          kind: 'workspace',
          params: { wsId, sessionId, ...(source ? { source } : {}) },
        })
        void refresh()
      }
    },
    [confirmInteractiveSession, workspaces, openOrFocus, refresh, refreshCommander, setSidebar],
  )

  const saveWorkspaceMetadata = useCallback(
    async (
      wsId: string,
      metadata: { displayName?: string | null; description?: string | null },
    ): Promise<void> => {
      const updated = await updateWorkspaceMetadata(wsId, metadata)
      setWorkspaces((prev) => prev.map((w) => (w.id === wsId ? updated : w)))
      void refresh()
    },
    [refresh],
  )

  const renameWorkspace = useCallback(
    async (wsId: string, displayName: string): Promise<void> => {
      await saveWorkspaceMetadata(wsId, { displayName })
    },
    [saveWorkspaceMetadata],
  )

  const deleteSession = useCallback(
    async (wsId: string, sessionId: string): Promise<void> => {
      const workspaceState = useWorkspace.getState()
      const focusedGroup = workspaceState.tree.kind === 'leaf' ? workspaceState.tree.group : null
      const focusedTab = focusedGroup?.activeTabId
        ? workspaceState.tabs[focusedGroup.activeTabId] ?? null
        : null
      const focusedOwnsSession = focusedTab?.spec.kind === 'workspace'
        ? focusedTab.spec.params.wsId === wsId && focusedTab.spec.params.sessionId === sessionId
        : false

      // Deleting the Session currently on screen has a deterministic landing:
      // its Workspace-level new-conversation composer. Open/focus that hub before closing
      // the pinned tab so closeTab's neighbour rule cannot send the user to an
      // unrelated editor.
      if (focusedOwnsSession) {
        const source = focusedTab?.spec.kind === 'workspace'
          ? focusedTab.spec.params.source
          : undefined
        openOrFocus({
          kind: 'workspace',
          params: { wsId, ...(source ? { source } : {}) },
        })
      }

      // Optimistic remove.
      if (wsId === COMMANDER_WORKSPACE_ID) {
        setCommander((current) => clearCommanderSession(current, sessionId))
      } else {
        setWorkspaces((prev) =>
          prev.map((w) =>
            w.id === wsId ? { ...w, sessions: w.sessions.filter((s) => s.id !== sessionId) } : w,
          ),
        )
      }
      // Close any tab pinned to this session immediately (don't wait for the
      // reconcile effect — gives instant UI feedback).
      const tabsSnap = workspaceState.tabs
      for (const tabId of Object.keys(tabsSnap)) {
        const tab = tabsSnap[tabId]
        const ownsSession = tab?.spec.kind === 'workspace'
          ? tab.spec.params.wsId === wsId && tab.spec.params.sessionId === sessionId
          : false
        if (ownsSession) {
          closeTab(tabId)
        }
      }
      await apiDeleteSession(wsId, sessionId)
      if (wsId === COMMANDER_WORKSPACE_ID) void refreshCommander()
      else void refresh()
    },
    [refresh, refreshCommander, closeTab, openOrFocus],
  )

  // Public delete = confirm first (the × sits next to the open-conversation hit
  // area; a misclick shouldn't nuke a session). The provider owns the dialog.
  const requestDeleteSession = useCallback((wsId: string, sessionId: string): void => {
    setPendingSessionDelete({ wsId, sessionId })
  }, [])

  const setSessionPresence = useCallback(async (
    wsId: string,
    resumeId: string,
    presence: SessionPresence,
  ): Promise<void> => {
    try {
      await apiSetSessionPresence(wsId, resumeId, presence)
      void refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('workspace.sessionPresenceFailed'))
      throw err
    }
  }, [refresh, t, toast])

  const setSessionDisplayName = useCallback(async (
    wsId: string,
    resumeId: string,
    displayName: string | null,
  ): Promise<void> => {
    const result = await apiSetSessionDisplayName(wsId, resumeId, displayName)
    // Clearing removes the field rather than writing an empty string.
    setWorkspaces((prev) => prev.map((workspace) => {
      if (workspace.id !== wsId) return workspace
      return {
        ...workspace,
        sessions: workspace.sessions.map((session) => {
          if (session.resumeId !== resumeId) return session
          if (result.displayName) return { ...session, displayName: result.displayName }
          const { displayName: _cleared, ...rest } = session
          return rest
        }),
      }
    }))
    if (wsId === COMMANDER_WORKSPACE_ID) {
      setCommander((current) => {
        if (!current?.session || current.session.resumeId !== resumeId) return current
        const nextSession = result.displayName
          ? { ...current.session, displayName: result.displayName }
          : (({ displayName: _cleared, ...rest }) => rest)(current.session)
        return { ...current, session: nextSession }
      })
      void refreshCommander()
    } else {
      void refresh()
    }
  }, [refresh, refreshCommander])

  const updateSessionRuntime = useCallback(async (
    wsId: string,
    sessionId: string,
    update: PausedSessionRuntimeUpdate,
  ): Promise<void> => {
    const updated = await apiUpdatePausedSessionRuntime(wsId, sessionId, update)
    if (wsId === COMMANDER_WORKSPACE_ID) {
      setCommander((current) => patchCommanderSession(current, sessionId, {
        runtime: updated.runtime,
        ...(updated.displayName ? { displayName: updated.displayName } : {}),
      }))
      void refreshCommander()
    } else {
      setWorkspaces((prev) => patchSession(prev, wsId, sessionId, {
        runtime: updated.runtime,
        ...(updated.displayName ? { displayName: updated.displayName } : {}),
      }))
      void refresh()
    }
  }, [refresh, refreshCommander])

  const commitActivateWorkspace = useCallback(async (wsId: string): Promise<boolean> => {
    setActivatingWorkspaceId(wsId)
    try {
      const result = await apiActivateWorkspace(wsId)
      const activated = result.workspace
      setWorkspaces((prev) => prev.map((candidate) => {
        if (candidate.id === activated.id) {
          return { ...candidate, ...activated, activationState: 'active' }
        }
        if (result.previousActiveId && candidate.id === result.previousActiveId) {
          return { ...candidate, activationState: 'standby' }
        }
        return candidate
      }))
      if (activated.template === 'auto-quant-v2') {
        setAutoQuantDefaultWorkspaceId(activated.id)
        setAutoQuantPreferenceError(null)
      } else if (activated.template === 'auto-prediction') {
        setAutoPredictionDefaultWorkspaceId(activated.id)
        setAutoPredictionPreferenceError(null)
      }
      await Promise.all([
        refresh(),
        refreshAutoQuantPreference(),
        refreshAutoPredictionPreference(),
      ])
      toast.success(
        t('workspace.activation.activatedToast', {
          workspace: workspaceDisplayName(activated),
        }),
      )
      return true
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('workspace.activation.activateFailed'))
      return false
    } finally {
      setActivatingWorkspaceId((current) => (current === wsId ? null : current))
    }
  }, [refresh, refreshAutoPredictionPreference, refreshAutoQuantPreference, t, toast])

  const requestActivateWorkspace = useCallback(async (wsId: string): Promise<boolean> => {
    setActivatingWorkspaceId(wsId)
    try {
      const preview = await getWorkspaceActivationPreview(wsId)
      if (preview.alreadyActive) {
        await refresh()
        setActivatingWorkspaceId((current) => (current === wsId ? null : current))
        return true
      }
      const currentActive = preview.currentActive
      const needsConfirm = Boolean(
        currentActive
        && (
          currentActive.openIssueCount > 0
          || currentActive.scheduledIssueCount > 0
          || currentActive.inFlightRunCount > 0
        ),
      )
      if (!needsConfirm) {
        return await commitActivateWorkspace(wsId)
      }
      setActivatingWorkspaceId((current) => (current === wsId ? null : current))
      return await new Promise<boolean>((resolve) => {
        setPendingActivation((previous) => {
          previous?.resolve(false)
          return { wsId, preview, resolve }
        })
      })
    } catch (err) {
      setActivatingWorkspaceId((current) => (current === wsId ? null : current))
      toast.error(err instanceof Error ? err.message : t('workspace.activation.activateFailed'))
      return false
    }
  }, [commitActivateWorkspace, refresh, t, toast])

  const openAgentConfig = useCallback((
    wsId: string,
    agent?: AgentId,
    section?: 'general' | 'launch' | 'ai' | 'template' | 'absorb',
    absorbSourceWsId?: string,
  ): void => {
    setConfiguringAgentTarget({
      wsId,
      ...(agent ? { agent } : {}),
      ...(section ? { section } : {}),
      ...(absorbSourceWsId ? { absorbSourceWsId } : {}),
    })
  }, [])

  const workspaceActions = useMemo(() => ({ openHeadlessRun }), [openHeadlessRun])

  const contextValue = useMemo<WorkspacesContextValue>(() => ({
    workspaces,
    templates,
    agents,
    defaultAgent,
    issueDefaultAgent,
    listError,
    commander,
    commanderLoaded,
    commanderError,
    hasLoaded,
    templatesLoaded,
    templatesError,
    autoQuantDefaultWorkspaceId,
    autoQuantPreferenceLoaded,
    autoQuantPreferenceError,
    autoPredictionDefaultWorkspaceId,
    autoPredictionPreferenceLoaded,
    autoPredictionPreferenceError,
    activatingWorkspaceId,
    requestActivateWorkspace,
    refresh,
    refreshTemplates,
    refreshAutoQuantPreference,
    refreshAutoPredictionPreference,
    refreshCommander,
    openCommander,
    spawn,
    openHeadlessRun,
    setDefaultAgent,
    setIssueDefaultAgent,
    initializeAutoQuant,
    initializeAutoPrediction,
    initializeChat,
    setAutoQuantDefaultWorkspace,
    setAutoPredictionDefaultWorkspace,
    quickChat,
    pauseSession,
    resumeSession,
    openWebSession,
    requestDeleteSession,
    setSessionPresence,
    setSessionDisplayName,
    updateSessionRuntime,
    openAgentConfig,
    saveWorkspaceMetadata,
    renameWorkspace,
  }), [
    activatingWorkspaceId,
    agents,
    autoPredictionDefaultWorkspaceId,
    autoPredictionPreferenceError,
    autoPredictionPreferenceLoaded,
    autoQuantDefaultWorkspaceId,
    autoQuantPreferenceError,
    autoQuantPreferenceLoaded,
    commander,
    commanderError,
    commanderLoaded,
    defaultAgent,
    hasLoaded,
    initializeAutoQuant,
    initializeAutoPrediction,
    initializeChat,
    issueDefaultAgent,
    listError,
    openAgentConfig,
    openCommander,
    openHeadlessRun,
    openWebSession,
    pauseSession,
    quickChat,
    refresh,
    refreshAutoPredictionPreference,
    refreshAutoQuantPreference,
    refreshCommander,
    refreshTemplates,
    renameWorkspace,
    requestActivateWorkspace,
    requestDeleteSession,
    setSessionPresence,
    setSessionDisplayName,
    updateSessionRuntime,
    resumeSession,
    saveWorkspaceMetadata,
    setAutoQuantDefaultWorkspace,
    setAutoPredictionDefaultWorkspace,
    setDefaultAgent,
    setIssueDefaultAgent,
    spawn,
    templates,
    templatesError,
    templatesLoaded,
    workspaces,
  ])

  const pendingDeleteSession = pendingSessionDelete
    ? (pendingSessionDelete.wsId === COMMANDER_WORKSPACE_ID
        ? (commander?.session?.id === pendingSessionDelete.sessionId ? commander.session : null)
        : workspaces.find((w) => w.id === pendingSessionDelete.wsId)?.sessions
            .find((s) => s.id === pendingSessionDelete.sessionId) ?? null)
    : null
  const pendingDeleteLabel =
    pendingDeleteSession?.title?.trim() || pendingDeleteSession?.name || ''

  const pendingActivationTarget = pendingActivation
    ? workspaces.find((w) => w.id === pendingActivation.wsId) ?? null
    : null
  const pendingActivationTargetLabel = pendingActivationTarget
    ? workspaceDisplayName(pendingActivationTarget)
    : pendingActivation?.wsId ?? ''
  const pendingActivationPrevious = pendingActivation?.preview.currentActive ?? null
  const pendingActivationPreviousLabel = pendingActivationPrevious
    ? (pendingActivationPrevious.displayName?.trim() || pendingActivationPrevious.tag)
    : ''
  const pendingActivationCounts: string[] = pendingActivationPrevious
    ? [
        pendingActivationPrevious.openIssueCount > 0
          ? String(t('workspace.activation.confirmOpenIssues', { count: pendingActivationPrevious.openIssueCount }))
          : null,
        pendingActivationPrevious.scheduledIssueCount > 0
          ? String(t('workspace.activation.confirmScheduledIssues', { count: pendingActivationPrevious.scheduledIssueCount }))
          : null,
        pendingActivationPrevious.inFlightRunCount > 0
          ? String(t('workspace.activation.confirmInFlightRuns', { count: pendingActivationPrevious.inFlightRunCount }))
          : null,
      ].filter((item): item is string => item !== null)
    : []

  const content = <>
        {children}
        {configuringAgentTarget !== null && (
          <WorkspaceAIConfigModal
            wsId={configuringAgentTarget.wsId}
            initialAgent={deprecatedExportTab(configuringAgentTarget.agent)}
            initialSection={configuringAgentTarget.section ?? (
              deprecatedExportTab(configuringAgentTarget.agent)
                ? 'ai'
                : configuringAgentTarget.agent
                  ? 'launch'
                  : 'general'
            )}
            initialAbsorbSourceId={configuringAgentTarget.absorbSourceWsId}
            onAiSaved={({ model, runtimeLabel, workspaceLabel }) => {
              toast.success(model
                ? t('workspaceSettings.ai.savedModelToast', {
                    model,
                    runtime: runtimeLabel,
                    workspace: workspaceLabel,
                  })
                : t('workspaceSettings.ai.savedConfigToast', {
                    runtime: runtimeLabel,
                    workspace: workspaceLabel,
                  }))
            }}
            onClose={() => setConfiguringAgentTarget(null)}
          />
        )}
        {interactiveConsent && <ConfirmDialog
          title={t('workspace.interactiveOwnership.title')}
          message={t('workspace.interactiveOwnership.message')}
          confirmLabel={t('workspace.interactiveOwnership.confirm')}
          cancelLabel={t('common.cancel')}
          variant="primary"
          onConfirm={() => { interactiveConsent.resolve(true); setInteractiveConsent(null) }}
          onClose={() => { interactiveConsent.resolve(false); setInteractiveConsent(null) }}
        />}
        {pendingSessionDelete !== null && (
          <ConfirmDialog
            title={t('chat.deleteSessionTitle')}
            message={t('chat.deleteSessionMessage', {
              title: pendingDeleteLabel || pendingSessionDelete.sessionId,
            })}
            confirmLabel={t('common.delete')}
            onConfirm={async () => {
              await deleteSession(pendingSessionDelete.wsId, pendingSessionDelete.sessionId)
              setPendingSessionDelete(null)
            }}
            onClose={() => setPendingSessionDelete(null)}
          />
        )}
        {pendingActivation !== null && (
          <ConfirmDialog
            title={t('workspace.activation.confirmTitle', { workspace: pendingActivationTargetLabel })}
            message={(
              <div className="space-y-2.5">
                <p>
                  {t('workspace.activation.confirmSummary', { previous: pendingActivationPreviousLabel })}
                </p>
                {pendingActivationCounts.length > 0 && (
                  <ul className="list-disc space-y-1 pl-5 text-[12px] text-muted-foreground">
                    {pendingActivationCounts.map((item) => (
                      <li key={item} className="tabular-nums text-foreground">{item}</li>
                    ))}
                  </ul>
                )}
                <p className="text-[12px] text-muted-foreground">
                  {t('workspace.activation.confirmSafeNote')}
                </p>
              </div>
            )}
            confirmLabel={t('workspace.activation.activate')}
            cancelLabel={t('common.cancel')}
            workingLabel={t('workspace.activation.activating')}
            variant="primary"
            onConfirm={async () => {
              const target = pendingActivation
              const activated = await commitActivateWorkspace(target.wsId)
              setPendingActivation(null)
              target.resolve(activated)
            }}
            onClose={() => {
              const target = pendingActivation
              setPendingActivation(null)
              target.resolve(false)
            }}
          />
        )}
  </>

  return (
    <WorkspaceActionsContext.Provider value={workspaceActions}>
      <WorkspacesContext.Provider value={contextValue}>
        {renderContent ? renderContent(content) : content}
      </WorkspacesContext.Provider>
    </WorkspaceActionsContext.Provider>
  )
}

function patchSession(
  workspaces: readonly Workspace[],
  wsId: string,
  sessionId: string,
  patch: Partial<SessionRecord>,
): Workspace[] {
  return workspaces.map((w) =>
    w.id === wsId
      ? { ...w, sessions: w.sessions.map((s) => (s.id === sessionId ? { ...s, ...patch } : s)) }
      : w,
  )
}

function patchCommanderSession(
  commander: CommanderSnapshot | null,
  sessionId: string,
  patch: Partial<SessionRecord>,
): CommanderSnapshot | null {
  if (commander === null || commander.session?.id !== sessionId) return commander
  return {
    ...commander,
    session: { ...commander.session, ...patch },
  }
}

function clearCommanderSession(
  commander: CommanderSnapshot | null,
  sessionId: string,
): CommanderSnapshot | null {
  if (commander === null || commander.session?.id !== sessionId) return commander
  return {
    ...commander,
    initialized: false,
    session: null,
  }
}
