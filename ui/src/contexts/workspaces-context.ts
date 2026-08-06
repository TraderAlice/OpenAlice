import { createContext, useContext } from 'react'
import type {
  AgentId,
  AgentInfo,
  ManagerQuickStartResult,
  ManagerWorkspaceSnapshot,
  SpawnOptions,
  TemplateInfo,
  Workspace,
} from '../components/workspace/api'
import type { WorkspaceSource } from '../tabs/types'

export type SpawnOpts = SpawnOptions

export interface WorkspacesContextValue {
  readonly workspaces: readonly Workspace[]
  readonly templates: readonly TemplateInfo[]
  readonly agents: readonly AgentInfo[]
  readonly defaultAgent: string | null
  readonly issueDefaultAgent: string | null
  readonly listError: string | null
  /** Launcher-owned Manager state; deliberately separate from business Workspaces. */
  readonly workspaceManager: ManagerWorkspaceSnapshot | null
  readonly workspaceManagerLoaded: boolean
  readonly workspaceManagerError: string | null
  /** True once the first workspaces-list fetch has resolved. */
  readonly hasLoaded: boolean
  /** True once the templates fetch has settled (success OR failure). */
  readonly templatesLoaded: boolean
  readonly templatesError: string | null
  /** Explicit durable desk pointer that defines AutoQuant readiness. */
  readonly autoQuantDefaultWorkspaceId: string | null
  readonly autoQuantPreferenceLoaded: boolean
  readonly autoQuantPreferenceError: string | null
  refresh(): Promise<void>
  refreshTemplates(): Promise<void>
  refreshAutoQuantPreference(): Promise<void>
  refreshWorkspaceManager(): Promise<void>
  quickStartWorkspaceManager(
    prompt: string,
    agent: string,
    credentialSlug?: string,
    model?: string | null,
    reasoningEffort?: import('../api').ModelReasoningEffort,
  ): Promise<ManagerQuickStartResult>
  spawn(wsId: string, opts?: SpawnOpts, source?: WorkspaceSource): Promise<void>
  openHeadlessRun(
    wsId: string,
    resumeId: string,
    opts?: { title?: string },
  ): Promise<void>
  setDefaultAgent(agent: string | null): Promise<void>
  setIssueDefaultAgent(agent: string | null): Promise<void>
  initializeAutoQuant(): Promise<Workspace>
  setAutoQuantDefaultWorkspace(workspaceId: string): Promise<void>
  quickChat(
    prompt: string,
    agent?: string,
    credentialSlug?: string,
    targetWsId?: string,
    template?: 'chat' | 'auto-quant-v2',
    model?: string | null,
    reasoningEffort?: import('../api').ModelReasoningEffort,
  ): Promise<string>
  pauseSession(wsId: string, sessionId: string): Promise<void>
  resumeSession(wsId: string, sessionId: string, source?: WorkspaceSource): Promise<void>
  openWebPiSession(wsId: string, sessionId: string, source?: WorkspaceSource): Promise<void>
  requestDeleteSession(wsId: string, sessionId: string): void
  openAgentConfig(wsId: string, agent?: AgentId, section?: 'general' | 'launch' | 'ai' | 'template' | 'absorb'): void
  saveWorkspaceMetadata(
    wsId: string,
    metadata: { displayName?: string | null; description?: string | null; defaultAgent?: string | null },
  ): Promise<void>
  renameWorkspace(wsId: string, displayName: string): Promise<void>
}

export const WorkspacesContext = createContext<WorkspacesContextValue | null>(null)

export function useWorkspaces(): WorkspacesContextValue {
  const ctx = useContext(WorkspacesContext)
  if (!ctx) throw new Error('useWorkspaces must be used within WorkspacesProvider')
  return ctx
}
