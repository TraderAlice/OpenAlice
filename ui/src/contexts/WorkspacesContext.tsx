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
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react'

import { useTranslation } from 'react-i18next'

import '../components/workspace/workspaces.css'

import { ConfirmDialog } from '../components/ConfirmDialog'
import { WorkspaceAIConfigModal } from '../components/workspace/WorkspaceAIConfigModal'
import {
  deleteSession as apiDeleteSession,
  getWorkspaceDefaultAgent,
  listAgents,
  listTemplates,
  listWorkspaces,
  pauseSession as apiPauseSession,
  quickChat as apiQuickChat,
  resumeSession as apiResumeSession,
  setWorkspaceDefaultAgent as apiSetWorkspaceDefaultAgent,
  spawnSession,
  updateWorkspaceMetadata,
  type AgentInfo,
  type SessionRecord,
  type TemplateInfo,
  type Workspace,
} from '../components/workspace/api'
import { useWorkspace } from '../tabs/store'

const LIST_POLL_MS = 3000

export interface SpawnOpts {
  readonly resume?: 'last' | string
  readonly agent?: string
  /** Seed a fresh session with a first message (quick-chat). Ignored when resuming. */
  readonly initialPrompt?: string
}

interface WorkspacesContextValue {
  readonly workspaces: readonly Workspace[]
  readonly templates: readonly TemplateInfo[]
  readonly agents: readonly AgentInfo[]
  readonly defaultAgent: string | null
  readonly listError: string | null
  /** True once the first workspaces-list fetch has resolved. Until then an
   *  empty list means "not loaded yet", not "no workspaces" — the sidebar shows
   *  a skeleton instead of a blank pane / empty state. */
  readonly hasLoaded: boolean
  /** True once the templates fetch has settled (success OR failure). Until then
   *  an empty `templates` means "not loaded yet", not "no templates" — surfaces
   *  that null-render or show a "no X configured" state when a template is
   *  missing MUST gate on this, or they collapse to a blank pane during the
   *  cold-start window (e.g. the Ask Alice sidebar hides its own skeleton). */
  readonly templatesLoaded: boolean
  refresh(): void
  spawn(wsId: string, opts?: SpawnOpts): Promise<void>
  setDefaultAgent(agent: string | null): Promise<void>
  /**
   * Quick-chat launch: reuse-or-create the chat workspace, spawn a fresh
   * session seeded with `prompt`, and focus into its terminal tab. Rejects on
   * failure so the composer can surface it.
   */
  quickChat(prompt: string, agent?: string, credentialSlug?: string, targetWsId?: string): Promise<void>
  pauseSession(wsId: string, sessionId: string): Promise<void>
  resumeSession(wsId: string, sessionId: string): Promise<void>
  /**
   * Request session deletion — opens a confirm dialog (delete is destructive
   * and the row's × sits right next to the open-conversation hit area, so a
   * misclick shouldn't nuke a session). The actual delete runs on confirm.
   */
  requestDeleteSession(wsId: string, sessionId: string): void
  /** Open the per-workspace AI-provider config modal for `wsId`. */
  openAgentConfig(wsId: string): void
  /** Write workspace-owned display metadata (`.alice/workspace.json`). */
  renameWorkspace(wsId: string, displayName: string): Promise<void>
}

const WorkspacesContext = createContext<WorkspacesContextValue | null>(null)

export function WorkspacesProvider({ children }: { children: ReactNode }) {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [templates, setTemplates] = useState<TemplateInfo[]>([])
  const [templatesLoaded, setTemplatesLoaded] = useState(false)
  const [agents, setAgents] = useState<AgentInfo[]>([])
  const [defaultAgent, setDefaultAgentState] = useState<string | null>(null)
  const [listError, setListError] = useState<string | null>(null)
  // Don't reconcile orphan tabs until we've successfully fetched the
  // workspaces list at least once — otherwise the initial `[]` looks like
  // "every workspace was just deleted" and a deep-linked workspace URL
  // gets its freshly-opened tab closed before the first poll lands.
  const [hasLoaded, setHasLoaded] = useState(false)
  // AI-provider config modal target. Lifted to context so the sidebar
  // gear button (no workspace tab needed) and the WorkspacePage header
  // button share one modal instance — and the modal survives activity
  // switches (rendered here, not inside an activity-scoped component).
  const [configuringWsId, setConfiguringWsId] = useState<string | null>(null)
  const [pendingSessionDelete, setPendingSessionDelete] = useState<{ wsId: string; sessionId: string } | null>(null)
  const { t } = useTranslation()

  const openOrFocus = useWorkspace((s) => s.openOrFocus)
  const closeTab = useWorkspace((s) => s.closeTab)

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const list = await listWorkspaces()
      setWorkspaces(list)
      setHasLoaded(true)
      setListError(null)
    } catch (err) {
      setListError((err as Error).message)
    }
  }, [])

  useEffect(() => {
    void refresh()
    const id = setInterval(() => void refresh(), LIST_POLL_MS)
    return () => clearInterval(id)
  }, [refresh])

  useEffect(() => {
    void listTemplates()
      .then(setTemplates)
      .catch(() => setTemplates([]))
      .finally(() => setTemplatesLoaded(true))
    void listAgents().then(setAgents).catch(() => setAgents([]))
    void getWorkspaceDefaultAgent().then(setDefaultAgentState).catch(() => setDefaultAgentState(null))
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

  const spawn = useCallback(
    async (wsId: string, opts: SpawnOpts = {}): Promise<void> => {
      try {
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
          agentSessionId: sess.agentSessionId,
          pid: sess.pid,
          startedAt: sess.startedAt,
          title: sess.title,
        }
        setWorkspaces((prev) =>
          prev.map((w) =>
            w.id === wsId ? { ...w, sessions: [...w.sessions, newRecord] } : w,
          ),
        )
        openOrFocus({ kind: 'workspace', params: { wsId, sessionId: sess.sessionId } })
        void refresh()
      } catch (err) {
        console.error('workspaces.spawn_failed', { wsId, opts, err })
      }
    },
    [refresh, openOrFocus],
  )

  const setDefaultAgent = useCallback(async (agent: string | null): Promise<void> => {
    const saved = await apiSetWorkspaceDefaultAgent(agent)
    setDefaultAgentState(saved)
  }, [])

  const quickChat = useCallback(
    async (prompt: string, agent?: string, credentialSlug?: string, targetWsId?: string): Promise<void> => {
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
        agentSessionId: session.agentSessionId,
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
      openOrFocus({ kind: 'workspace', params: { wsId: workspace.id, sessionId: session.sessionId } })
      void refresh()
    },
    [refresh, openOrFocus],
  )

  const pauseSession = useCallback(
    async (wsId: string, sessionId: string): Promise<void> => {
      setWorkspaces((prev) =>
        patchSession(prev, wsId, sessionId, {
          state: 'paused',
          pid: null,
          startedAt: null,
          lastActiveAt: new Date().toISOString(),
        }),
      )
      await apiPauseSession(wsId, sessionId)
      void refresh()
    },
    [refresh],
  )

  const resumeSession = useCallback(
    async (wsId: string, sessionId: string): Promise<void> => {
      const resp = await apiResumeSession(wsId, sessionId)
      if (resp) {
        setWorkspaces((prev) =>
          patchSession(prev, wsId, sessionId, {
            state: 'running',
            pid: resp.pid,
            startedAt: resp.startedAt,
            lastActiveAt: new Date().toISOString(),
          }),
        )
      }
      openOrFocus({ kind: 'workspace', params: { wsId, sessionId } })
      void refresh()
    },
    [refresh, openOrFocus],
  )

  const renameWorkspace = useCallback(
    async (wsId: string, displayName: string): Promise<void> => {
      const updated = await updateWorkspaceMetadata(wsId, { displayName })
      setWorkspaces((prev) => prev.map((w) => (w.id === wsId ? updated : w)))
      void refresh()
    },
    [refresh],
  )

  const deleteSession = useCallback(
    async (wsId: string, sessionId: string): Promise<void> => {
      // Optimistic remove.
      setWorkspaces((prev) =>
        prev.map((w) =>
          w.id === wsId ? { ...w, sessions: w.sessions.filter((s) => s.id !== sessionId) } : w,
        ),
      )
      // Close any tab pinned to this session immediately (don't wait for the
      // reconcile effect — gives instant UI feedback).
      const tabsSnap = useWorkspace.getState().tabs
      for (const tabId of Object.keys(tabsSnap)) {
        const tab = tabsSnap[tabId]
        if (tab && tab.spec.kind === 'workspace' && tab.spec.params.sessionId === sessionId) {
          closeTab(tabId)
        }
      }
      await apiDeleteSession(wsId, sessionId)
      void refresh()
    },
    [refresh, closeTab],
  )

  // Public delete = confirm first (the × sits next to the open-conversation hit
  // area; a misclick shouldn't nuke a session). The provider owns the dialog.
  const requestDeleteSession = useCallback((wsId: string, sessionId: string): void => {
    setPendingSessionDelete({ wsId, sessionId })
  }, [])

  const pendingDeleteSession = pendingSessionDelete
    ? (workspaces.find((w) => w.id === pendingSessionDelete.wsId)?.sessions
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
        listError,
        hasLoaded,
        templatesLoaded,
        refresh,
        spawn,
        setDefaultAgent,
        quickChat,
        pauseSession,
        resumeSession,
        requestDeleteSession,
        openAgentConfig: (wsId: string) => setConfiguringWsId(wsId),
        renameWorkspace,
      }}
    >
      {children}
      {configuringWsId !== null && (
        <WorkspaceAIConfigModal
          wsId={configuringWsId}
          onClose={() => setConfiguringWsId(null)}
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

export function useWorkspaces(): WorkspacesContextValue {
  const ctx = useContext(WorkspacesContext)
  if (!ctx) throw new Error('useWorkspaces must be used within WorkspacesProvider')
  return ctx
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
