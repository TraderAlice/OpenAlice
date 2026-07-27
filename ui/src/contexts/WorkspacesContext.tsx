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

import {
  useCallback,
  useEffect,
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
import { WorkspaceAIConfigModal } from '../components/workspace/WorkspaceAIConfigModal'
import {
  deleteSession as apiDeleteSession,
  type AgentId,
  getIssueDefaultAgent,
  getWorkspaceManager,
  getWorkspaceDefaultAgent,
  listAgents,
  listTemplates,
  listWorkspaces,
  openWebPiSession as apiOpenWebPiSession,
  openResumeSession,
  pauseSession as apiPauseSession,
  quickChat as apiQuickChat,
  quickStartWorkspaceManager as apiQuickStartWorkspaceManager,
  resumeSession as apiResumeSession,
  setIssueDefaultAgent as apiSetIssueDefaultAgent,
  setWorkspaceDefaultAgent as apiSetWorkspaceDefaultAgent,
  spawnSession,
  updateWorkspaceMetadata,
  type AgentInfo,
  MANAGER_WORKSPACE_ID,
  type ManagerQuickStartResult,
  type ManagerWorkspaceSnapshot,
  type SessionRecord,
  type TemplateInfo,
  type Workspace,
} from '../components/workspace/api'
import { useWorkspace } from '../tabs/store'
import type { WorkspaceSource } from '../tabs/types'
import { WorkspacesContext, type SpawnOpts } from './workspaces-context'
import { reconcileWorkspaceList } from './workspace-list-reconcile'

const LIST_POLL_MS = 3000

export function WorkspacesProvider({ children }: { children: ReactNode }) {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [templates, setTemplates] = useState<TemplateInfo[]>([])
  const [templatesLoaded, setTemplatesLoaded] = useState(false)
  const [agents, setAgents] = useState<AgentInfo[]>([])
  const [defaultAgent, setDefaultAgentState] = useState<string | null>(null)
  const [issueDefaultAgent, setIssueDefaultAgentState] = useState<string | null>(null)
  const [listError, setListError] = useState<string | null>(null)
  const [workspaceManager, setWorkspaceManager] = useState<ManagerWorkspaceSnapshot | null>(null)
  const [workspaceManagerLoaded, setWorkspaceManagerLoaded] = useState(false)
  const [workspaceManagerError, setWorkspaceManagerError] = useState<string | null>(null)
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
    section?: 'general' | 'ai' | 'template' | 'absorb'
  } | null>(null)
  const [pendingSessionDelete, setPendingSessionDelete] = useState<{ wsId: string; sessionId: string } | null>(null)
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

  const refreshWorkspaceManager = useCallback(async (): Promise<void> => {
    try {
      setWorkspaceManager(await getWorkspaceManager())
      setWorkspaceManagerError(null)
    } catch (err) {
      setWorkspaceManagerError((err as Error).message)
    } finally {
      setWorkspaceManagerLoaded(true)
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
    void refreshWorkspaceManager()
    const id = setInterval(() => void refreshWorkspaceManager(), LIST_POLL_MS)
    return () => clearInterval(id)
  }, [refreshWorkspaceManager])

  useEffect(() => {
    void listTemplates()
      .then(setTemplates)
      .catch(() => setTemplates([]))
      .finally(() => setTemplatesLoaded(true))
    void listAgents().then(setAgents).catch(() => setAgents([]))
    void getWorkspaceDefaultAgent().then(setDefaultAgentState).catch(() => setDefaultAgentState(null))
    void getIssueDefaultAgent().then(setIssueDefaultAgentState).catch(() => setIssueDefaultAgentState(null))
  }, [])

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

  // Manager Sessions use the same tab lifecycle but are intentionally absent
  // from the business Workspace list above. Reconcile them against their own
  // launcher-owned snapshot so a deleted Manager conversation cannot leave a
  // dangling terminal tab.
  useEffect(() => {
    if (!workspaceManagerLoaded || workspaceManager === null) return
    const validSessions = new Set(workspaceManager.sessions.map((session) => session.id))
    const tabsSnap = useWorkspace.getState().tabs
    for (const tabId of Object.keys(tabsSnap)) {
      const tab = tabsSnap[tabId]
      if (!tab || tab.spec.kind !== 'workspace-manager') continue
      const sessionId = tab.spec.params.sessionId
      if (sessionId && !validSessions.has(sessionId)) closeTab(tabId)
    }
  }, [closeTab, workspaceManager, workspaceManagerLoaded])

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

  const openHeadlessRun = useCallback(
    async (
      wsId: string,
      resumeId: string,
      opts: { title?: string } = {},
    ): Promise<void> => {
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
    [ensureTerminalAppearancePublished, openOrFocus, refresh, setSidebar],
  )

  const setIssueDefaultAgent = useCallback(async (agent: string | null): Promise<void> => {
    const saved = await apiSetIssueDefaultAgent(agent)
    setIssueDefaultAgentState(saved)
  }, [])

  const quickChat = useCallback(
    async (prompt: string, agent?: string, credentialSlug?: string, targetWsId?: string): Promise<string> => {
      await ensureTerminalAppearancePublished()
      const { workspace, session } = await apiQuickChat(prompt, agent, credentialSlug, targetWsId)
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
        params: { wsId: workspace.id, sessionId: session.sessionId, source: 'chat' },
      })
      void refresh()
      return workspace.id
    },
    [ensureTerminalAppearancePublished, refresh, openOrFocus],
  )

  const quickStartWorkspaceManager = useCallback(async (
    prompt: string,
    agent: string,
    credentialSlug?: string,
  ): Promise<ManagerQuickStartResult> => {
    const result = await apiQuickStartWorkspaceManager(prompt, agent, credentialSlug)
    setWorkspaceManager(result.manager)
    setWorkspaceManagerLoaded(true)
    setWorkspaceManagerError(null)
    return result
  }, [])

  const pauseSession = useCallback(
    async (wsId: string, sessionId: string): Promise<void> => {
      const patch = {
        state: 'paused' as const,
        pid: null,
        startedAt: null,
        lastActiveAt: new Date().toISOString(),
      }
      if (wsId === MANAGER_WORKSPACE_ID) {
        setWorkspaceManager((current) => patchManagerSession(current, sessionId, patch))
      } else {
        setWorkspaces((prev) => patchSession(prev, wsId, sessionId, patch))
      }
      await apiPauseSession(wsId, sessionId)
      if (wsId === MANAGER_WORKSPACE_ID) void refreshWorkspaceManager()
      else void refresh()
    },
    [refresh, refreshWorkspaceManager],
  )

  const resumeSession = useCallback(
    async (wsId: string, sessionId: string, source?: WorkspaceSource): Promise<void> => {
      await ensureTerminalAppearancePublished()
      const resp = await apiResumeSession(wsId, sessionId)
      if (resp) {
        const patch = {
          state: 'running' as const,
          surface: 'terminal' as const,
          pid: resp.pid,
          startedAt: resp.startedAt,
          lastActiveAt: new Date().toISOString(),
        }
        if (wsId === MANAGER_WORKSPACE_ID) {
          setWorkspaceManager((current) => patchManagerSession(current, sessionId, patch))
        } else {
          setWorkspaces((prev) => patchSession(prev, wsId, sessionId, patch))
        }
      }
      if (wsId === MANAGER_WORKSPACE_ID) {
        openOrFocus({ kind: 'workspace-manager', params: { sessionId } })
        void refreshWorkspaceManager()
      } else {
        openOrFocus({
          kind: 'workspace',
          params: { wsId, sessionId, ...(source ? { source } : {}) },
        })
        void refresh()
      }
    },
    [ensureTerminalAppearancePublished, refresh, refreshWorkspaceManager, openOrFocus],
  )

  const openWebPiSession = useCallback(
    async (wsId: string, sessionId: string, source?: WorkspaceSource): Promise<void> => {
      const snapshot = await apiOpenWebPiSession(wsId, sessionId)
      const patch = {
        state: 'running' as const,
        surface: 'webpi' as const,
        pid: snapshot.pid,
        startedAt: snapshot.startedAt,
        lastActiveAt: new Date().toISOString(),
      }
      if (wsId === MANAGER_WORKSPACE_ID) {
        setWorkspaceManager((current) => patchManagerSession(current, sessionId, patch))
        openOrFocus({ kind: 'workspace-manager', params: { sessionId } })
        void refreshWorkspaceManager()
      } else {
        setWorkspaces((prev) => patchSession(prev, wsId, sessionId, patch))
        openOrFocus({
          kind: 'workspace',
          params: { wsId, sessionId, ...(source ? { source } : {}) },
        })
        void refresh()
      }
    },
    [openOrFocus, refresh, refreshWorkspaceManager],
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
        : focusedTab?.spec.kind === 'workspace-manager'
          ? wsId === MANAGER_WORKSPACE_ID && focusedTab.spec.params.sessionId === sessionId
          : false

      // Deleting the Session currently on screen has a deterministic landing:
      // its Workspace-level Session library. Open/focus that hub before closing
      // the pinned tab so closeTab's neighbour rule cannot send the user to an
      // unrelated editor.
      if (focusedOwnsSession) {
        if (wsId === MANAGER_WORKSPACE_ID) {
          openOrFocus({ kind: 'workspace-manager', params: {} })
        } else {
          const source = focusedTab?.spec.kind === 'workspace'
            ? focusedTab.spec.params.source
            : undefined
          openOrFocus({
            kind: 'workspace',
            params: { wsId, ...(source ? { source } : {}) },
          })
        }
      }

      // Optimistic remove.
      if (wsId === MANAGER_WORKSPACE_ID) {
        setWorkspaceManager((current) => removeManagerSession(current, sessionId))
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
          : tab?.spec.kind === 'workspace-manager'
            ? wsId === MANAGER_WORKSPACE_ID && tab.spec.params.sessionId === sessionId
            : false
        if (ownsSession) {
          closeTab(tabId)
        }
      }
      await apiDeleteSession(wsId, sessionId)
      if (wsId === MANAGER_WORKSPACE_ID) void refreshWorkspaceManager()
      else void refresh()
    },
    [refresh, refreshWorkspaceManager, closeTab, openOrFocus],
  )

  // Public delete = confirm first (the × sits next to the open-conversation hit
  // area; a misclick shouldn't nuke a session). The provider owns the dialog.
  const requestDeleteSession = useCallback((wsId: string, sessionId: string): void => {
    setPendingSessionDelete({ wsId, sessionId })
  }, [])

  const pendingDeleteSession = pendingSessionDelete
    ? (pendingSessionDelete.wsId === MANAGER_WORKSPACE_ID
        ? workspaceManager?.sessions.find((s) => s.id === pendingSessionDelete.sessionId) ?? null
        : workspaces.find((w) => w.id === pendingSessionDelete.wsId)?.sessions
            .find((s) => s.id === pendingSessionDelete.sessionId) ?? null)
    : null
  const pendingDeleteLabel =
    pendingDeleteSession?.title?.trim() || pendingDeleteSession?.name || ''

  return (
    <WorkspacesContext.Provider
      value={{
        workspaces,
        templates,
        agents,
        defaultAgent,
        issueDefaultAgent,
        listError,
        workspaceManager,
        workspaceManagerLoaded,
        workspaceManagerError,
        hasLoaded,
        templatesLoaded,
        refresh,
        refreshWorkspaceManager,
        quickStartWorkspaceManager,
        spawn,
        openHeadlessRun,
        setDefaultAgent,
        setIssueDefaultAgent,
        quickChat,
        pauseSession,
        resumeSession,
        openWebPiSession,
        requestDeleteSession,
        openAgentConfig: (wsId: string, agent?: AgentId, section?: 'general' | 'ai' | 'template' | 'absorb') =>
          setConfiguringAgentTarget({
            wsId,
            ...(agent ? { agent } : {}),
            ...(section ? { section } : {}),
          }),
        saveWorkspaceMetadata,
        renameWorkspace,
      }}
    >
      {children}
      {configuringAgentTarget !== null && (
        <WorkspaceAIConfigModal
          wsId={configuringAgentTarget.wsId}
          initialAgent={configuringAgentTarget.agent}
          initialSection={configuringAgentTarget.section ?? (configuringAgentTarget.agent ? 'ai' : 'general')}
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
    </WorkspacesContext.Provider>
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

function patchManagerSession(
  manager: ManagerWorkspaceSnapshot | null,
  sessionId: string,
  patch: Partial<SessionRecord>,
): ManagerWorkspaceSnapshot | null {
  if (manager === null) return null
  return {
    ...manager,
    sessions: manager.sessions.map((session) => (
      session.id === sessionId ? { ...session, ...patch } : session
    )),
  }
}

function removeManagerSession(
  manager: ManagerWorkspaceSnapshot | null,
  sessionId: string,
): ManagerWorkspaceSnapshot | null {
  if (manager === null) return null
  return {
    ...manager,
    sessions: manager.sessions.filter((session) => session.id !== sessionId),
  }
}
