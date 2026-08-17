import { useCallback, useEffect, useMemo, useState } from 'react'

import type { QuickChatLaunchPreference } from '../api/preferences'
import { credentialAccessLabel } from '../components/workspace/AgentLaunchControls'
import type {
  AgentInfo,
  PausedSessionRuntimeUpdate,
} from '../components/workspace/api'
import {
  useAgentLaunchConfig,
  type AgentLaunchConfigState,
  type AgentLaunchPreferencesState,
} from './useAgentLaunchConfig'

const PINNED_PROVIDER = {
  credentialSource: 'runtime-or-workspace' as const,
  wirePreference: [] as const,
}

export interface PinnedRuntimeBinding {
  readonly credentialSource?: 'native' | 'vault' | 'workspace'
  readonly credentialSlug?: string | null
  readonly model?: string | null
  readonly reasoningEffort?: QuickChatLaunchPreference['reasoningEffort']
}

export interface UsePinnedRuntimeDraftOptions {
  readonly workspaceId: string
  readonly agent: string
  readonly agents: readonly AgentInfo[]
  readonly initial: QuickChatLaunchPreference
  /** Reset the local draft when the editor becomes active or the persisted binding changes. */
  readonly active?: boolean
}

export interface PinnedRuntimeCapability {
  readonly access: string
  readonly model: string
  readonly effort: string
}

export interface PinnedRuntimeDraft {
  readonly config: AgentLaunchConfigState
  readonly draft: QuickChatLaunchPreference
  readonly initial: QuickChatLaunchPreference
  readonly dirty: boolean
  toRuntimeUpdate(): PausedSessionRuntimeUpdate
  capability(fallback: { access: string; model: string; effort: string }): PinnedRuntimeCapability
  formatCapability(fallback: { access: string; model: string; effort: string }): string
}

export function pinnedLaunchEquals(
  a: QuickChatLaunchPreference,
  b: QuickChatLaunchPreference,
): boolean {
  return (a.accessMode ?? 'native') === (b.accessMode ?? 'native')
    && (a.credentialSlug ?? null) === (b.credentialSlug ?? null)
    && (a.model ?? null) === (b.model ?? null)
    && (a.reasoningEffort ?? null) === (b.reasoningEffort ?? null)
}

export function pinnedLaunchFromBinding(
  agent: string,
  binding: PinnedRuntimeBinding | null | undefined,
): QuickChatLaunchPreference {
  const vault = binding?.credentialSource === 'vault' && Boolean(binding.credentialSlug)
  return {
    agent,
    accessMode: vault ? 'vault' : 'native',
    credentialSlug: vault ? binding?.credentialSlug ?? null : null,
    model: binding?.model ?? null,
    reasoningEffort: binding?.reasoningEffort ?? null,
  }
}

export function pinnedLaunchToRuntimeUpdate(
  launch: QuickChatLaunchPreference,
): PausedSessionRuntimeUpdate {
  const vault = launch.accessMode === 'vault' && Boolean(launch.credentialSlug)
  return {
    credentialSource: vault ? 'vault' : 'native',
    ...(vault ? { credentialSlug: launch.credentialSlug } : {}),
    model: launch.model ?? null,
    reasoningEffort: launch.reasoningEffort ?? null,
  }
}

export function formatPinnedCapability(parts: PinnedRuntimeCapability): string {
  return `${parts.access} · ${parts.model} · ${parts.effort}`
}

function pinAgent(agents: readonly AgentInfo[], agentId: string): AgentInfo[] {
  const found = agents.filter((agent) => agent.id === agentId)
  if (found.length > 0) {
    return found.map((agent) => (
      agent.capabilities.aiProvider
        ? agent
        : {
            ...agent,
            capabilities: {
              ...agent.capabilities,
              aiProvider: PINNED_PROVIDER,
            },
          }
    ))
  }
  return [{
    id: agentId,
    displayName: agentId,
    kind: 'agent',
    capabilities: {
      parallelPerCwd: true,
      resumeLast: true,
      resumeById: true,
      transcriptDiscovery: 'none',
      aiProvider: PINNED_PROVIDER,
    },
  }]
}

function capabilityFromConfig(
  config: AgentLaunchConfigState,
  fallback: PinnedRuntimeCapability,
): PinnedRuntimeCapability {
  const vault = config.accessMode === 'vault' && Boolean(config.launchCredentialSlug)
  return {
    access: vault
      ? credentialAccessLabel(config.credential)
        || config.launchCredentialSlug
        || fallback.access
      : fallback.access,
    model: config.launchModel ?? config.defaultModel ?? fallback.model,
    effort: config.launchReasoningEffort ?? fallback.effort,
  }
}

/**
 * Local cred/model/effort draft for an already-chosen Agent runtime.
 * Used by Session Settings, the Issue AI editor, and Workspace preference
 * editors. Never writes installation or Workspace launch recents.
 */
export function usePinnedRuntimeDraft({
  workspaceId,
  agent,
  agents,
  initial,
  active = true,
}: UsePinnedRuntimeDraftOptions): PinnedRuntimeDraft {
  const initialKey = JSON.stringify(initial)
  const [draft, setDraft] = useState(initial)

  useEffect(() => {
    if (!active) return
    setDraft(initial)
    // Persist identity is the serialized launch, not object identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, initialKey])

  const rememberLaunch = useCallback(async (launch: QuickChatLaunchPreference) => {
    setDraft({
      ...launch,
      accessMode: launch.accessMode === 'vault' ? 'vault' : 'native',
    })
  }, [])

  const preferences = useMemo<AgentLaunchPreferencesState>(() => ({
    lastCredentialByAgent: draft.credentialSlug ? { [agent]: draft.credentialSlug } : {},
    recentChatWorkspaceId: workspaceId,
    recentLaunch: draft,
    loaded: true,
    rememberLaunch,
    adoptRecentChatWorkspace: () => undefined,
  }), [agent, draft, rememberLaunch, workspaceId])

  const pinnedAgents = useMemo(() => pinAgent(agents, agent), [agent, agents])
  const config = useAgentLaunchConfig({
    agents: pinnedAgents,
    defaultAgent: agent,
    preferences,
    workspaceId,
    hasWorkspace: true,
    managedWorkspaceLaunch: true,
  })

  const toRuntimeUpdate = useCallback(
    () => pinnedLaunchToRuntimeUpdate(draft),
    [draft],
  )

  const capability = useCallback((fallback: PinnedRuntimeCapability) => (
    capabilityFromConfig(config, fallback)
  ), [config])

  const formatCapability = useCallback((fallback: PinnedRuntimeCapability) => (
    formatPinnedCapability(capabilityFromConfig(config, fallback))
  ), [config])

  return {
    config,
    draft,
    initial,
    dirty: !pinnedLaunchEquals(draft, initial),
    toRuntimeUpdate,
    capability,
    formatCapability,
  }
}
