import { createContext, useContext } from 'react'
import type {
  AgentId,
  AgentInfo,
  CommanderOpenInput,
  CommanderOpenResult,
  CommanderSnapshot,
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
  /** Global persistent Commander state; deliberately separate from business Workspaces. */
  readonly commander: CommanderSnapshot | null
  readonly commanderLoaded: boolean
  readonly commanderError: string | null
  /** True once the first workspaces-list fetch has resolved. */
  readonly hasLoaded: boolean
  /** True once the templates fetch has settled (success OR failure). */
  readonly templatesLoaded: boolean
  readonly templatesError: string | null
  /** Explicit durable desk pointer that defines AutoQuant readiness. */
  readonly autoQuantDefaultWorkspaceId: string | null
  readonly autoQuantPreferenceLoaded: boolean
  readonly autoQuantPreferenceError: string | null
  readonly autoPredictionDefaultWorkspaceId?: string | null
  readonly autoPredictionPreferenceLoaded?: boolean
  readonly autoPredictionPreferenceError?: string | null
  /** Workspace ID currently fetching activation preview or activating. */
  readonly activatingWorkspaceId?: string | null
  /** Preview and activate a standby workspace (with confirmation when needed). */
  requestActivateWorkspace?(wsId: string): Promise<boolean>
  refresh(): Promise<void>
  refreshTemplates(): Promise<void>
  refreshAutoQuantPreference(): Promise<void>
  refreshAutoPredictionPreference?(): Promise<void>
  refreshCommander(): Promise<void>
  openCommander(input?: CommanderOpenInput): Promise<CommanderOpenResult>
  spawn(wsId: string, opts?: SpawnOpts, source?: WorkspaceSource): Promise<void>
  openHeadlessRun(
    wsId: string,
    resumeId: string,
    opts?: { title?: string },
  ): Promise<void>
  setDefaultAgent(agent: string | null): Promise<void>
  setIssueDefaultAgent(agent: string | null): Promise<void>
  initializeAutoQuant(): Promise<Workspace>
  initializeAutoPrediction?(): Promise<Workspace>
  initializeChat(): Promise<Workspace>
  setAutoQuantDefaultWorkspace(workspaceId: string): Promise<void>
  setAutoPredictionDefaultWorkspace?(workspaceId: string): Promise<void>
  quickChat(
    prompt: string,
    agent?: string,
    credentialSlug?: string,
    targetWsId?: string,
    template?: 'chat' | 'auto-quant-v2' | 'auto-prediction',
    model?: string | null,
    reasoningEffort?: import('../api').ModelReasoningEffort,
    credentialSource?: 'native',
      surface?: 'terminal' | 'webpi',
  ): Promise<string>
  pauseSession(wsId: string, sessionId: string): Promise<void>
  resumeSession(wsId: string, sessionId: string, source?: WorkspaceSource): Promise<void>
  openWebSession(wsId: string, sessionId: string, source?: WorkspaceSource): Promise<void>
  requestDeleteSession(wsId: string, sessionId: string): void
  setSessionPresence(
    wsId: string,
    resumeId: string,
    presence: import('../components/workspace/api').SessionPresence,
  ): Promise<void>
  setSessionDisplayName(
    wsId: string,
    resumeId: string,
    displayName: string | null,
  ): Promise<void>
  updateSessionRuntime(
    wsId: string,
    sessionId: string,
    update: import('../components/workspace/api').PausedSessionRuntimeUpdate,
  ): Promise<void>
  openAgentConfig(
    wsId: string,
    agent?: AgentId,
    section?: 'general' | 'launch' | 'ai' | 'template' | 'absorb',
    absorbSourceWsId?: string,
  ): void
  saveWorkspaceMetadata(
    wsId: string,
    metadata: { displayName?: string | null; description?: string | null },
  ): Promise<void>
  renameWorkspace(wsId: string, displayName: string): Promise<void>
}

export const WorkspacesContext = createContext<WorkspacesContextValue | null>(null)

export function useWorkspaces(): WorkspacesContextValue {
  const ctx = useContext(WorkspacesContext)
  if (!ctx) throw new Error('useWorkspaces must be used within WorkspacesProvider')
  return ctx
}

export function useOptionalWorkspaces(): WorkspacesContextValue | null {
  return useContext(WorkspacesContext)
}
