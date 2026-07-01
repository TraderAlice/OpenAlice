import { createContext, useContext } from 'react'
import type {
  AgentInfo,
  TemplateInfo,
  Workspace,
} from '../components/workspace/api'
import type { WorkspaceSource } from '../tabs/types'

export interface SpawnOpts {
  readonly resume?: 'last' | string
  readonly agent?: string
  /** Seed a fresh session with a first message (quick-chat). Ignored when resuming. */
  readonly initialPrompt?: string
}

export interface WorkspacesContextValue {
  readonly workspaces: readonly Workspace[]
  readonly templates: readonly TemplateInfo[]
  readonly agents: readonly AgentInfo[]
  readonly defaultAgent: string | null
  readonly listError: string | null
  /** True once the first workspaces-list fetch has resolved. */
  readonly hasLoaded: boolean
  /** True once the templates fetch has settled (success OR failure). */
  readonly templatesLoaded: boolean
  refresh(): void
  spawn(wsId: string, opts?: SpawnOpts, source?: WorkspaceSource): Promise<void>
  setDefaultAgent(agent: string | null): Promise<void>
  quickChat(prompt: string, agent?: string, credentialSlug?: string, targetWsId?: string): Promise<void>
  pauseSession(wsId: string, sessionId: string): Promise<void>
  resumeSession(wsId: string, sessionId: string, source?: WorkspaceSource): Promise<void>
  requestDeleteSession(wsId: string, sessionId: string): void
  openAgentConfig(wsId: string): void
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
