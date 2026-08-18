import type { AgentInfo } from '../components/workspace/api'

export const AGENT_RUNTIME_QUICK_ACCESS_LIMIT = 4

export function normalizeAgentRuntimeQuickAccessIds(ids: readonly unknown[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const id of ids) {
    if (typeof id !== 'string') continue
    const trimmed = id.trim()
    if (!trimmed || seen.has(trimmed)) continue
    seen.add(trimmed)
    result.push(trimmed)
    if (result.length >= AGENT_RUNTIME_QUICK_ACCESS_LIMIT) break
  }
  return result
}

export function isAgentRuntimeCatalogEntry(
  agent: Pick<AgentInfo, 'kind'>,
): boolean {
  return agent.kind !== 'utility'
}

export function isInstalledAgentRuntime(
  agent: Pick<AgentInfo, 'installed'>,
): boolean {
  return agent.installed !== false
}

export function agentRuntimeCatalog(
  agents: readonly AgentInfo[],
): AgentInfo[] {
  return agents.filter(isAgentRuntimeCatalogEntry)
}

export interface AgentRuntimeQuickAccessProjection {
  readonly catalog: readonly AgentInfo[]
  readonly primary: readonly AgentInfo[]
  readonly others: readonly AgentInfo[]
  readonly installed: readonly AgentInfo[]
  readonly notInstalled: readonly AgentInfo[]
}

/**
 * Pinned ids first (when they are known and installed), then the recently used
 * installed runtime, then remaining installed registry order. Uninstalled
 * runtimes never occupy a fallback slot. The full catalog stays in `others`
 * plus the complete installed / not-installed partitions.
 */
export function projectAgentRuntimeQuickAccess(
  agents: readonly AgentInfo[],
  pinnedIds: readonly string[],
  recentAgentId: string | null,
): AgentRuntimeQuickAccessProjection {
  const catalog = agentRuntimeCatalog(agents)
  const byId = new Map(catalog.map((agent) => [agent.id, agent]))
  const primary: AgentInfo[] = []
  const seen = new Set<string>()

  const pushInstalled = (id: string | null | undefined): void => {
    if (!id || seen.has(id) || primary.length >= AGENT_RUNTIME_QUICK_ACCESS_LIMIT) return
    const agent = byId.get(id)
    if (!agent || !isInstalledAgentRuntime(agent)) return
    seen.add(id)
    primary.push(agent)
  }

  for (const id of pinnedIds) pushInstalled(id)
  pushInstalled(recentAgentId)
  for (const agent of catalog) pushInstalled(agent.id)

  return {
    catalog,
    primary,
    others: catalog.filter((agent) => !seen.has(agent.id)),
    installed: catalog.filter(isInstalledAgentRuntime),
    notInstalled: catalog.filter((agent) => !isInstalledAgentRuntime(agent)),
  }
}

/** Existing stale pins stay removable. Only installed runtimes may occupy a new slot. */
export function canAddAgentRuntimeQuickAccess(
  pinnedIds: readonly string[],
  agent: Pick<AgentInfo, 'id' | 'installed'>,
): boolean {
  if (pinnedIds.includes(agent.id)) return true
  return isInstalledAgentRuntime(agent) && pinnedIds.length < AGENT_RUNTIME_QUICK_ACCESS_LIMIT
}
