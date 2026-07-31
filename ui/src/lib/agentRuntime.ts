import type { AgentId, AgentInfo, AgentRuntimeReadinessSnapshot } from '../components/workspace/api'

/** Whether this adapter must receive a concrete Workspace provider binding. */
export function requiresWorkspaceCredential(
  agent: Pick<AgentInfo, 'capabilities'> | null,
): boolean {
  return agent?.capabilities.aiProvider?.credentialSource === 'workspace-required'
}

const WORKSPACE_AI_AGENT_IDS = new Set<AgentId>(['claude', 'codex', 'opencode', 'pi'])

/** Native runtimes supported by the per-Workspace AI configuration modal. */
export function isWorkspaceAiAgent(agentId: string | null): agentId is AgentId {
  return agentId !== null && WORKSPACE_AI_AGENT_IDS.has(agentId as AgentId)
}

/**
 * Resolve the runtime behind a chat-style composer. Explicit and saved choices
 * win; otherwise prefer a verified runtime, then the only installed runtime.
 * Keeping this outside either page makes Quick Chat and Workspace Manager
 * follow the same runtime-selection contract.
 */
export function resolveAgentRuntime(
  agents: readonly Pick<AgentInfo, 'id' | 'installed'>[],
  selectedAgent: string | null,
  defaultAgent: string | null,
  runtimeReadiness: AgentRuntimeReadinessSnapshot | null,
): string | null {
  const hasAgent = (agentId: string | null): agentId is string => (
    agentId !== null && agents.some((agent) => agent.id === agentId)
  )
  if (hasAgent(selectedAgent)) return selectedAgent
  if (hasAgent(defaultAgent)) return defaultAgent

  const readyAgent = agents.find((agent) => runtimeReadiness?.agents[agent.id]?.ready === true)
  if (readyAgent) return readyAgent.id

  const installedAgents = agents.filter((agent) => agent.installed !== false)
  return installedAgents.length === 1 ? installedAgents[0].id : null
}
