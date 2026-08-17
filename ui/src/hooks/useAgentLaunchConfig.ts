import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { configApi, type WorkspaceCredentialDefault } from '../api/config'
import type { ModelReasoningEffort, ModelReasoningMode, PresetModel } from '../api'
import {
  preferencesApi,
  type QuickChatLaunchPreference,
  type QuickChatPreferences,
} from '../api/preferences'
import {
  detectWorkspaceCredential,
  getAgentReadiness,
  getAgentRuntimeReadiness,
  listAgentCredentials,
  type AgentCredentialReadiness,
  type AgentInfo,
  type AgentRuntimeReadinessRow,
  type AgentRuntimeReadinessSnapshot,
  type SavedCredential,
  type Workspace,
  type WorkspaceCredentialDetection,
} from '../components/workspace/api'
import { requiresWorkspaceCredential, resolveAgentRuntime } from '../lib/agentRuntime'
import {
  runtimeEffortOptions,
  runtimeModelOptions,
  runtimeModelSemantics,
} from '../components/issue-runtime-options'
import {
  WORKSPACE_AGENT_CONFIG_CHANGED_EVENT,
  WORKSPACE_DEFAULTS_CHANGED_EVENT,
  type WorkspaceAgentConfigChangedDetail,
} from '../lib/workspaceAiEvents'

const AGENT_LAUNCH_PREFERENCES_CHANGED_EVENT = 'openalice:agent-launch-preferences-changed'

export type AgentLaunchAccessMode = 'auto' | 'native' | 'vault'

function launchAccessMode(launch: QuickChatLaunchPreference | null): AgentLaunchAccessMode {
  return launch?.accessMode ?? (launch?.credentialSlug ? 'vault' : 'auto')
}

export interface AgentLaunchAiDetails {
  readonly model: string | null
  /** Null when the native runtime owns the limit and its project config does not declare one. */
  readonly contextWindow: number | null
  readonly reasoning?: boolean
  readonly reasoningEffort?: ModelReasoningEffort
  readonly reasoningMode?: ModelReasoningMode
  readonly source: 'workspace' | 'new-injection'
}

function workspaceReasoningDetails(detected: WorkspaceCredentialDetection): Pick<
  AgentLaunchAiDetails,
  'reasoning' | 'reasoningEffort' | 'reasoningMode'
> {
  return {
    ...(typeof detected.reasoning === 'boolean' ? { reasoning: detected.reasoning } : {}),
    ...(detected.reasoningEffort ? { reasoningEffort: detected.reasoningEffort } : {}),
    ...(detected.reasoningMode ? { reasoningMode: detected.reasoningMode } : {}),
  }
}

function injectedReasoningDetails(credential: Pick<
  SavedCredential,
  'resolvedReasoning' | 'resolvedReasoningEffort' | 'resolvedReasoningMode'
>): Pick<AgentLaunchAiDetails, 'reasoning' | 'reasoningEffort' | 'reasoningMode'> {
  return {
    ...(typeof credential.resolvedReasoning === 'boolean'
      ? { reasoning: credential.resolvedReasoning }
      : {}),
    ...(credential.resolvedReasoningEffort
      ? { reasoningEffort: credential.resolvedReasoningEffort }
      : {}),
    ...(credential.resolvedReasoningMode
      ? { reasoningMode: credential.resolvedReasoningMode }
      : {}),
  }
}

/** Resolve the visible credential without allowing global defaults to flash
 * over a Workspace whose on-disk agent config is still being inspected. */
export function resolveAgentCredential(
  credentials: readonly Pick<SavedCredential, 'slug'>[] | null,
  pickedCredential: string | null,
  detectedCredential: string | null,
  workspaceCredentialReady: boolean,
  workspaceDefaultCredential: string | null = null,
  lastCredential: string | null = null,
  workspaceCredentialResolved = true,
  preferencesResolved = true,
): string | null {
  const available = (slug: string | null): slug is string => (
    slug !== null && credentials?.some((credential) => credential.slug === slug) === true
  )
  if (available(pickedCredential)) return pickedCredential
  if (!workspaceCredentialResolved) return null
  if (available(detectedCredential)) return detectedCredential
  if (workspaceCredentialReady) return null
  if (available(workspaceDefaultCredential)) return workspaceDefaultCredential
  // Credentials and preferences load in parallel. Do not briefly expose (or
  // launch with) the first vault entry before the remembered choice arrives.
  if (!preferencesResolved) return null
  if (available(lastCredential)) return lastCredential
  return credentials?.[0]?.slug ?? null
}

/** Match only a credential that the user has explicitly bound to Claude/Codex.
 * Merely storing a compatible vault entry must not replace the runtime's native
 * global login, provider, or model defaults. */
export function resolveExplicitLoginBackedCredential(
  credentials: readonly Pick<SavedCredential, 'slug'>[] | null,
  explicitCredential: string | null,
): string | null {
  if (explicitCredential === null) return null
  return credentials?.some((credential) => credential.slug === explicitCredential) === true
    ? explicitCredential
    : null
}

/** Only an explicit visible credential choice crosses the launch boundary.
 * A null choice leaves the native runtime login/provider state untouched. */
export function resolveAgentLaunchCredentialSlug(
  canSelectCredential: boolean,
  effectiveCredential: string | null,
): string | undefined {
  return canSelectCredential ? (effectiveCredential ?? undefined) : undefined
}

/** Describe the exact model/context that the next launch will use. Existing
 * Workspace config wins only when it belongs to the selected credential. */
export function resolveAgentLaunchAiDetails(
  needsCredential: boolean,
  effectiveCredential: string | null,
  credential: Pick<
    SavedCredential,
    'slug' | 'resolvedModel' | 'resolvedContextWindow' | 'resolvedReasoning' | 'resolvedReasoningEffort' | 'resolvedReasoningMode'
  > | null,
  detected: WorkspaceCredentialDetection | null,
  creationDefault: WorkspaceCredentialDefault | undefined,
  hasWorkspace: boolean,
): AgentLaunchAiDetails | null {
  // Native runtimes retain their own login fallback. Show only config that is
  // already on disk, or a creation default that will actually be seeded into a
  // brand-new Workspace. Their project files do not consistently declare
  // context limits, so keep that fact unknown instead of borrowing a provider
  // default.
  if (!needsCredential) {
    if (
      effectiveCredential &&
      credential?.slug === effectiveCredential &&
      (!hasWorkspace || detected?.slug !== effectiveCredential)
    ) {
      const creationModel = !hasWorkspace && creationDefault?.credentialSlug === effectiveCredential
        ? creationDefault.model
        : undefined
      return {
        model: creationModel ?? credential.resolvedModel ?? null,
        contextWindow: null,
        ...injectedReasoningDetails(credential),
        source: 'new-injection',
      }
    }
    if (hasWorkspace && detected?.configured === true) {
      return {
        model: detected.model ?? (
          detected.slug !== null && credential?.slug === detected.slug
            ? credential.resolvedModel ?? null
            : null
        ),
        contextWindow: detected.contextWindow,
        ...workspaceReasoningDetails(detected),
        source: 'workspace',
      }
    }
    if (
      !hasWorkspace &&
      creationDefault !== undefined &&
      credential?.slug === creationDefault.credentialSlug
    ) {
      return {
        model: creationDefault.model ?? credential.resolvedModel ?? null,
        contextWindow: null,
        ...injectedReasoningDetails(credential),
        source: 'new-injection',
      }
    }
    return null
  }

  // A usable hand-edited Workspace config has no vault slug, and a formerly
  // linked credential can later be deleted. The runtime can still use that
  // on-disk config, so keep its real model/context visible instead of falling
  // back to an empty summary.
  if (hasWorkspace && detected?.configured === true && (
    !effectiveCredential || detected.slug === effectiveCredential
  )) {
    return {
      model: detected.model,
      contextWindow: detected.contextWindow,
      ...workspaceReasoningDetails(detected),
      source: 'workspace',
    }
  }
  if (!effectiveCredential || credential?.slug !== effectiveCredential) return null
  if (hasWorkspace && detected?.slug === effectiveCredential) {
    return {
      model: detected.model ?? credential.resolvedModel ?? null,
      contextWindow: detected.contextWindow ?? credential.resolvedContextWindow ?? null,
      ...workspaceReasoningDetails(detected),
      source: 'workspace',
    }
  }
  const creationModel = !hasWorkspace && creationDefault?.credentialSlug === effectiveCredential
    ? creationDefault.model
    : undefined
  return {
    model: creationModel ?? credential.resolvedModel ?? null,
    contextWindow: creationDefault?.contextWindow ?? credential.resolvedContextWindow ?? null,
    ...injectedReasoningDetails(credential),
    source: 'new-injection',
  }
}

export function formatContextWindow(value: number): string {
  if (value >= 1_000_000 && value % 1_000_000 === 0) return `${value / 1_000_000}M`
  if (value >= 1_000 && value % 1_000 === 0) return `${value / 1_000}K`
  return String(value)
}

export interface AgentLaunchPreferencesState {
  readonly lastCredentialByAgent: Readonly<Record<string, string>>
  readonly recentChatWorkspaceId: string | null
  readonly recentLaunch: QuickChatLaunchPreference | null
  readonly loaded: boolean
  rememberLaunch(launch: QuickChatLaunchPreference): Promise<void>
  adoptRecentChatWorkspace(workspaceId: string | null): void
}

function fallbackPreferences(): QuickChatPreferences {
  return { lastCredentialByAgent: {}, recentChatWorkspaceId: null, recentLaunch: null }
}

/** Shared persistence boundary for every chat-style launcher. Keeping this
 * separate lets Quick Chat resolve its recent Workspace before the launch
 * config hook needs that Workspace id. */
export function useAgentLaunchPreferences(): AgentLaunchPreferencesState {
  const [preferences, setPreferences] = useState<QuickChatPreferences>(fallbackPreferences)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    let live = true
    void preferencesApi.getQuickChat()
      .then((next) => {
        if (!live) return
        setPreferences(next)
        setLoaded(true)
      })
      .catch(() => {
        if (live) setLoaded(true)
      })

    const onChanged = (event: Event) => {
      const detail = (event as CustomEvent<QuickChatPreferences>).detail
      if (detail) setPreferences(detail)
    }
    window.addEventListener(AGENT_LAUNCH_PREFERENCES_CHANGED_EVENT, onChanged)
    return () => {
      live = false
      window.removeEventListener(AGENT_LAUNCH_PREFERENCES_CHANGED_EVENT, onChanged)
    }
  }, [])

  const rememberLaunch = useCallback(async (launch: QuickChatLaunchPreference): Promise<void> => {
    setPreferences((current) => ({
      ...current,
      lastCredentialByAgent: launch.credentialSlug === null
        ? Object.fromEntries(Object.entries(current.lastCredentialByAgent).filter(([key]) => key !== launch.agent))
        : { ...current.lastCredentialByAgent, [launch.agent]: launch.credentialSlug },
      recentLaunch: launch,
    }))
    try {
      const saved = await preferencesApi.rememberQuickChatLaunch(launch)
      if (saved) {
        setPreferences(saved)
        window.dispatchEvent(new CustomEvent(AGENT_LAUNCH_PREFERENCES_CHANGED_EVENT, { detail: saved }))
      }
    } catch {
      // The visible choice remains valid for this launch even when remembering
      // it fails; the backend remains authoritative on the next page load.
    }
  }, [])

  const adoptRecentChatWorkspace = useCallback((workspaceId: string | null) => {
    setPreferences((current) => ({ ...current, recentChatWorkspaceId: workspaceId }))
  }, [])

  return {
    lastCredentialByAgent: preferences.lastCredentialByAgent,
    recentChatWorkspaceId: preferences.recentChatWorkspaceId,
    recentLaunch: preferences.recentLaunch ?? null,
    loaded,
    rememberLaunch,
    adoptRecentChatWorkspace,
  }
}

function workspaceInteractiveLaunch(workspace: Workspace | null): QuickChatLaunchPreference | null {
  if (!workspace) return null
  const mode = workspace.runtimeSettings?.runtime.interactive
  const agent = mode?.defaultAgent ?? mode?.recent.agent ?? workspace.defaultAgent
  if (!agent) return null
  const preference = mode?.agents[agent] ?? mode?.recent.agents[agent]
  if (!preference || preference.accessMode === 'native') {
    return {
      agent,
      accessMode: 'native',
      credentialSlug: null,
      model: preference?.model ?? null,
      reasoningEffort: preference?.reasoningEffort ?? null,
    }
  }
  return {
    agent,
    accessMode: 'vault',
    credentialSlug: preference.credentialSlug ?? null,
    model: preference.model ?? null,
    reasoningEffort: preference.reasoningEffort ?? null,
  }
}

/** Workspace Quick Chat keeps its draft locally and lets the successful launch
 * persist the accepted tuple in `.alice/settings.json`. Installation-level
 * preferences remain responsible only for locating the recent Workspace. */
export function useWorkspaceAgentLaunchPreferences(
  workspace: Workspace | null,
  installation: AgentLaunchPreferencesState,
): AgentLaunchPreferencesState {
  const persistedLaunch = workspaceInteractiveLaunch(workspace)
  const persistedLaunchKey = JSON.stringify(persistedLaunch)
  const [draft, setDraft] = useState<{ workspaceId: string; launch: QuickChatLaunchPreference | null } | null>(null)

  useEffect(() => {
    setDraft(workspace ? { workspaceId: workspace.id, launch: persistedLaunch } : null)
    // Workspace inventory polling replaces object identities. Reset the draft
    // only when the persisted tuple actually changes, otherwise an in-progress
    // picker choice would disappear on every poll.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [persistedLaunchKey, workspace?.id])

  const launch = workspace
    ? (draft?.workspaceId === workspace.id ? draft.launch : persistedLaunch)
    : installation.recentLaunch
  const lastCredentialByAgent = useMemo(() => {
    if (!workspace?.runtimeSettings) return workspace ? {} : installation.lastCredentialByAgent
    return Object.fromEntries(
      Object.entries({
        ...workspace.runtimeSettings.runtime.interactive.recent.agents,
        ...workspace.runtimeSettings.runtime.interactive.agents,
      })
        .filter((entry): entry is [string, { accessMode: 'vault'; credentialSlug: string }] => (
          entry[1].accessMode === 'vault' && typeof entry[1].credentialSlug === 'string'
        ))
        .map(([agent, preference]) => [agent, preference.credentialSlug]),
    )
  }, [installation.lastCredentialByAgent, workspace])

  const rememberLaunch = useCallback(async (next: QuickChatLaunchPreference) => {
    if (!workspace) return installation.rememberLaunch(next)
    setDraft({ workspaceId: workspace.id, launch: next })
  }, [installation, workspace])

  return {
    lastCredentialByAgent,
    recentChatWorkspaceId: installation.recentChatWorkspaceId,
    recentLaunch: launch,
    loaded: workspace ? true : installation.loaded,
    rememberLaunch,
    adoptRecentChatWorkspace: installation.adoptRecentChatWorkspace,
  }
}

export interface UseAgentLaunchConfigOptions {
  readonly agents: readonly AgentInfo[]
  readonly defaultAgent: string | null
  readonly preferences: AgentLaunchPreferencesState
  readonly workspaceId: string | null
  readonly hasWorkspace: boolean
  /** Managed product Workspace: native project config is deprecated and must
   * not participate in the normal launch picker. */
  readonly managedWorkspaceLaunch?: boolean
}

export interface AgentLaunchConfigState {
  readonly agents: readonly AgentInfo[]
  readonly effectiveAgent: string | null
  readonly selectedAgent: AgentInfo | null
  readonly runtimeReadiness: AgentRuntimeReadinessSnapshot | null
  readonly selectedRuntimeReadiness: AgentRuntimeReadinessRow | null
  readonly needsCredential: boolean
  /** The runtime can accept an explicit OpenAlice-managed Workspace override. */
  readonly canSelectCredential: boolean
  readonly accessMode: AgentLaunchAccessMode
  readonly credentials: readonly SavedCredential[] | null
  readonly effectiveCredential: string | null
  readonly credential: SavedCredential | null
  readonly detectedCredential: WorkspaceCredentialDetection | null
  readonly workspaceConfigResolved: boolean
  readonly defaultModel: string | null
  readonly modelOptions: readonly PresetModel[]
  readonly launchModel: string | undefined
  readonly effortOptions: readonly ModelReasoningEffort[]
  /** Explicit picker value. Undefined means use the selected model's registered default. */
  readonly selectedReasoningEffort: ModelReasoningEffort | undefined
  /** Effective value frozen into a fresh Session launch. */
  readonly launchReasoningEffort: ModelReasoningEffort | undefined
  readonly aiDetails: AgentLaunchAiDetails | null
  readonly selectedRuntimeUsesGlobalConfig: boolean
  readonly credentialSelectionReady: boolean
  readonly noCredentials: boolean
  readonly needsProviderSetup: boolean
  readonly selectedMissing: boolean
  readonly anyInstalled: boolean
  readonly agentsKnown: boolean
  readonly launchCredentialSlug: string | undefined
  selectAgent(agent: string): void
  selectCredential(credentialSlug: string): void
  selectRuntimeDefault(): void
  selectWorkspaceDefault(): void
  selectModel(model: string | null): void
  selectReasoningEffort(effort: ModelReasoningEffort | null): void
  resetCredentialSelection(): void
}

/** Canonical launch-state hook for Quick Chat, Workspace Manager, and future
 * chat-style surfaces. It owns runtime selection/readiness plus the complete
 * credential -> model -> context resolution chain. */
export function useAgentLaunchConfig({
  agents,
  defaultAgent,
  preferences,
  workspaceId,
  hasWorkspace,
  managedWorkspaceLaunch = false,
}: UseAgentLaunchConfigOptions): AgentLaunchConfigState {
  const [runtimeReadiness, setRuntimeReadiness] = useState<AgentRuntimeReadinessSnapshot | null>(null)
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null)
  const [credentialList, setCredentialList] = useState<{
    agent: string
    credentials: SavedCredential[]
  } | null>(null)
  const [pickedCredential, setPickedCredential] = useState<{
    agent: string
    workspaceId: string | null
    accessMode: AgentLaunchAccessMode
    slug: string | null
  } | null>(null)
  const [workspaceConfigDetection, setWorkspaceConfigDetection] = useState<{
    agent: string
    workspaceId: string
    revision: number
    detectedCredential: WorkspaceCredentialDetection | null
    agentReadiness: AgentCredentialReadiness | null
  } | null>(null)
  const [workspaceCredentialDefaults, setWorkspaceCredentialDefaults] = useState<Record<string, WorkspaceCredentialDefault>>({})
  const [presets, setPresets] = useState<Awaited<ReturnType<typeof configApi.getPresets>>['presets']>([])
  const [agentConfigRevision, setAgentConfigRevision] = useState(0)
  const immediateLaunchRef = useRef<QuickChatLaunchPreference | null>(preferences.recentLaunch)
  if (preferences.recentLaunch !== immediateLaunchRef.current) {
    immediateLaunchRef.current = preferences.recentLaunch
  }

  const preferredAgent = selectedAgentId ?? preferences.recentLaunch?.agent ?? null
  const effectiveAgent = resolveAgentRuntime(agents, preferredAgent, defaultAgent, runtimeReadiness)
  const selectedAgent = agents.find((agent) => agent.id === effectiveAgent) ?? null
  const selectedRuntimeReadiness = effectiveAgent ? runtimeReadiness?.agents[effectiveAgent] ?? null : null
  const selectedRuntimeUsesGlobalConfig = selectedRuntimeReadiness?.ready === true && (
    selectedRuntimeReadiness.source === 'global-config' ||
    selectedRuntimeReadiness.source === 'managed-runtime' ||
    selectedRuntimeReadiness.source === 'global-login'
  )
  const needsCredential = requiresWorkspaceCredential(selectedAgent)
  const canSelectCredential = Boolean(selectedAgent?.capabilities.aiProvider)
  const credentials = credentialList?.agent === effectiveAgent
    ? credentialList.credentials
    : null
  const workspaceConfigResolved = managedWorkspaceLaunch || effectiveAgent === null || workspaceId === null || (
    workspaceConfigDetection?.agent === effectiveAgent &&
    workspaceConfigDetection.workspaceId === workspaceId &&
    workspaceConfigDetection.revision === agentConfigRevision
  )
  const detectedCredential = !managedWorkspaceLaunch && workspaceConfigResolved
    ? workspaceConfigDetection?.detectedCredential ?? null
    : null
  const agentReadiness = !managedWorkspaceLaunch && workspaceConfigResolved
    ? workspaceConfigDetection?.agentReadiness ?? null
    : null

  useEffect(() => {
    let live = true
    void getAgentRuntimeReadiness()
      .then((snapshot) => { if (live) setRuntimeReadiness(snapshot) })
      .catch(() => { if (live) setRuntimeReadiness(null) })
    return () => { live = false }
  }, [])

  useEffect(() => {
    let live = true
    void configApi.getPresets()
      .then(({ presets: next }) => { if (live) setPresets(next) })
      .catch(() => { if (live) setPresets([]) })
    return () => { live = false }
  }, [])

  useEffect(() => {
    let live = true
    const refreshCredentials = () => {
      if (effectiveAgent === null) {
        setCredentialList(null)
        return
      }
      void listAgentCredentials(effectiveAgent)
        .then((available) => {
          if (live) setCredentialList({ agent: effectiveAgent, credentials: available })
        })
        .catch(() => {
          if (live) setCredentialList({ agent: effectiveAgent, credentials: [] })
        })
    }
    refreshCredentials()
    window.addEventListener('openalice:credentials-changed', refreshCredentials)
    return () => {
      live = false
      window.removeEventListener('openalice:credentials-changed', refreshCredentials)
    }
  }, [effectiveAgent])

  useEffect(() => {
    let live = true
    const refreshDefaults = () => {
      void configApi.getWorkspaceCredentialDefaults()
        .then((defaults) => {
          if (!live) return
          setWorkspaceCredentialDefaults(defaults.defaults)
        })
        .catch(() => undefined)
    }
    refreshDefaults()
    window.addEventListener(WORKSPACE_DEFAULTS_CHANGED_EVENT, refreshDefaults)
    return () => {
      live = false
      window.removeEventListener(WORKSPACE_DEFAULTS_CHANGED_EVENT, refreshDefaults)
    }
  }, [])

  useEffect(() => {
    const onWorkspaceAgentConfigChanged = (event: Event) => {
      const detail = (event as CustomEvent<WorkspaceAgentConfigChangedDetail>).detail
      if (!detail || (detail.wsId === workspaceId && detail.agent === effectiveAgent)) {
        // Refresh the Workspace-owned fallback. The recent Quick Start tuple
        // remains independent and intentionally continues to win when present.
        setPickedCredential(null)
        setAgentConfigRevision((revision) => revision + 1)
      }
    }
    window.addEventListener(WORKSPACE_AGENT_CONFIG_CHANGED_EVENT, onWorkspaceAgentConfigChanged)
    return () => window.removeEventListener(WORKSPACE_AGENT_CONFIG_CHANGED_EVENT, onWorkspaceAgentConfigChanged)
  }, [effectiveAgent, workspaceId])

  useEffect(() => {
    if (managedWorkspaceLaunch || effectiveAgent === null || workspaceId === null) return
    let live = true
    void Promise.allSettled([
      detectWorkspaceCredential(workspaceId, effectiveAgent),
      needsCredential ? getAgentReadiness(workspaceId) : Promise.resolve(null),
    ]).then(([detected, readiness]) => {
      if (!live) return
      const readinessBundle = readiness.status === 'fulfilled' ? readiness.value : null
      setWorkspaceConfigDetection({
        agent: effectiveAgent,
        workspaceId,
        revision: agentConfigRevision,
        detectedCredential: detected.status === 'fulfilled' ? detected.value : null,
        agentReadiness: readinessBundle?.agents[effectiveAgent] ?? null,
      })
    })
    return () => { live = false }
  }, [agentConfigRevision, effectiveAgent, managedWorkspaceLaunch, needsCredential, workspaceId])

  const workspaceCredentialReady = needsCredential &&
    agentReadiness?.ready === true &&
    agentReadiness.requiresCredential === true &&
    agentReadiness.source === 'workspace-config'
  const scopedPickedAccess = pickedCredential?.agent === effectiveAgent &&
    pickedCredential.workspaceId === workspaceId
    ? pickedCredential
    : null
  const scopedRecentLaunch = preferences.loaded && preferences.recentLaunch?.agent === effectiveAgent
    ? preferences.recentLaunch
    : null
  const recentCredential = scopedRecentLaunch?.credentialSlug
  const recentCredentialAvailable = typeof recentCredential === 'string' &&
    credentials?.some((candidate) => candidate.slug === recentCredential) === true
  const requestedAccessMode = scopedPickedAccess?.accessMode ?? (
    managedWorkspaceLaunch && scopedRecentLaunch === null
      ? 'native'
      : launchAccessMode(scopedRecentLaunch)
  )
  const accessMode: AgentLaunchAccessMode = requestedAccessMode === 'vault' && !(
        scopedPickedAccess?.slug
          ? credentials?.some((candidate) => candidate.slug === scopedPickedAccess.slug) === true
          : recentCredentialAvailable
      )
      ? 'auto'
      : requestedAccessMode
  const preferredCredential = accessMode === 'vault'
    ? scopedPickedAccess?.slug ?? (recentCredentialAvailable ? recentCredential : undefined)
    : accessMode === 'native'
      ? null
      : undefined
  const loginBackedCreationDefault = !hasWorkspace && effectiveAgent
    ? workspaceCredentialDefaults[effectiveAgent]?.credentialSlug ?? null
    : null
  const explicitLoginBackedCredential = accessMode === 'native'
    ? null
    : preferredCredential !== undefined
      ? preferredCredential
      : hasWorkspace
      ? !workspaceConfigResolved
        ? null
        : detectedCredential?.configured === true
          ? detectedCredential.slug
          : effectiveAgent ? preferences.lastCredentialByAgent[effectiveAgent] ?? null : null
      : loginBackedCreationDefault ?? (
          effectiveAgent ? preferences.lastCredentialByAgent[effectiveAgent] ?? null : null
        )
  const effectiveCredential = accessMode === 'native'
    ? null
    : needsCredential
    ? resolveAgentCredential(
        credentials,
        preferredCredential ?? null,
        detectedCredential?.slug ?? null,
        workspaceCredentialReady,
        effectiveAgent ? workspaceCredentialDefaults[effectiveAgent]?.credentialSlug ?? null : null,
        effectiveAgent ? preferences.lastCredentialByAgent[effectiveAgent] ?? null : null,
        workspaceConfigResolved,
        preferences.loaded,
      )
    : resolveExplicitLoginBackedCredential(credentials, explicitLoginBackedCredential)
  const credential = credentials?.find((candidate) => candidate.slug === effectiveCredential) ?? null
  const launchCredentialSlug = typeof preferredCredential === 'string' &&
    credentials?.some((candidate) => candidate.slug === preferredCredential) === true
    ? preferredCredential
    : undefined
  const recentTupleMatchesCredential = scopedRecentLaunch !== null &&
    launchAccessMode(scopedRecentLaunch) === accessMode &&
    scopedRecentLaunch.credentialSlug === (launchCredentialSlug ?? null)
  const launchModel = recentTupleMatchesCredential
    ? scopedRecentLaunch.model ?? undefined
    : undefined
  const selectedReasoningEffort = recentTupleMatchesCredential
    ? scopedRecentLaunch.reasoningEffort ?? undefined
    : undefined
  const baseAiDetails = accessMode === 'native'
    ? null
    : resolveAgentLaunchAiDetails(
        needsCredential,
        effectiveCredential,
        credential,
        detectedCredential,
        effectiveAgent ? workspaceCredentialDefaults[effectiveAgent] : undefined,
        hasWorkspace,
      )
  const defaultModel = launchCredentialSlug
    ? credential?.resolvedModel ?? null
    : baseAiDetails?.model ?? null
  const modelOptions = runtimeModelOptions({
    agent: effectiveAgent,
    credential: launchCredentialSlug ? credential : null,
    defaultModel,
    presets,
  })
  const effectiveModel = launchModel ?? defaultModel
  const selectedModelSemantics = runtimeModelSemantics(effectiveModel, modelOptions)
  const launchReasoningEffort = selectedReasoningEffort
  const effortOptions = runtimeEffortOptions({
    agent: effectiveAgent,
    semantics: selectedModelSemantics,
    modelKnown: selectedModelSemantics !== null,
  })
  const aiDetails = launchModel || launchReasoningEffort
    ? {
        model: effectiveModel,
        contextWindow: selectedModelSemantics?.contextWindow ?? baseAiDetails?.contextWindow ?? null,
        ...(selectedModelSemantics?.reasoning?.mode ?? baseAiDetails?.reasoningMode
          ? { reasoningMode: selectedModelSemantics?.reasoning?.mode ?? baseAiDetails?.reasoningMode }
          : {}),
        ...(launchReasoningEffort ? { reasoningEffort: launchReasoningEffort } : {}),
        source: 'new-injection' as const,
      }
    : baseAiDetails
  const noCredentials = accessMode !== 'native' && needsCredential &&
    workspaceConfigResolved &&
    !workspaceCredentialReady &&
    !selectedRuntimeUsesGlobalConfig &&
    credentials !== null &&
    credentials.length === 0
  const credentialSelectionReady = accessMode === 'native' || !needsCredential || selectedRuntimeUsesGlobalConfig || (
    credentials !== null && workspaceConfigResolved && preferences.loaded
  )

  const selectAgent = useCallback((agent: string) => {
    setSelectedAgentId(agent)
    setPickedCredential(null)
    const launch = {
      agent,
      accessMode: preferences.lastCredentialByAgent[agent] ? 'vault' as const : managedWorkspaceLaunch ? 'native' as const : 'auto' as const,
      credentialSlug: preferences.lastCredentialByAgent[agent] ?? null,
      model: null,
      reasoningEffort: null,
    }
    immediateLaunchRef.current = launch
    void preferences.rememberLaunch(launch)
  }, [managedWorkspaceLaunch, preferences])

  const selectCredential = useCallback((credentialSlug: string) => {
    if (!canSelectCredential || effectiveAgent === null) return
    setPickedCredential({ agent: effectiveAgent, workspaceId, accessMode: 'vault', slug: credentialSlug })
    const launch = {
      agent: effectiveAgent,
      accessMode: 'vault' as const,
      credentialSlug,
      model: null,
      reasoningEffort: null,
    }
    immediateLaunchRef.current = launch
    void preferences.rememberLaunch(launch)
  }, [canSelectCredential, effectiveAgent, preferences, workspaceId])

  const selectRuntimeDefault = useCallback(() => {
    if (!canSelectCredential || effectiveAgent === null) return
    setPickedCredential({ agent: effectiveAgent, workspaceId, accessMode: 'native', slug: null })
    const launch = {
      agent: effectiveAgent,
      accessMode: 'native' as const,
      credentialSlug: null,
      model: null,
      reasoningEffort: null,
    }
    immediateLaunchRef.current = launch
    void preferences.rememberLaunch(launch)
  }, [canSelectCredential, effectiveAgent, preferences, workspaceId])

  const selectWorkspaceDefault = useCallback(() => {
    if (effectiveAgent === null) return
    setPickedCredential({ agent: effectiveAgent, workspaceId, accessMode: 'auto', slug: null })
    const launch = {
      agent: effectiveAgent,
      accessMode: 'auto' as const,
      credentialSlug: null,
      model: null,
      reasoningEffort: null,
    }
    immediateLaunchRef.current = launch
    void preferences.rememberLaunch(launch)
  }, [effectiveAgent, preferences, workspaceId])

  const selectModel = useCallback((model: string | null) => {
    if (effectiveAgent === null) return
    const launch = {
      agent: effectiveAgent,
      accessMode,
      credentialSlug: launchCredentialSlug ?? null,
      model,
      reasoningEffort: null,
    }
    immediateLaunchRef.current = launch
    void preferences.rememberLaunch(launch)
  }, [accessMode, effectiveAgent, launchCredentialSlug, preferences])

  const selectReasoningEffort = useCallback((reasoningEffort: ModelReasoningEffort | null) => {
    if (effectiveAgent === null) return
    const immediate = immediateLaunchRef.current
    const model = immediate?.agent === effectiveAgent &&
      launchAccessMode(immediate) === accessMode &&
      immediate.credentialSlug === (launchCredentialSlug ?? null)
      ? immediate.model
      : launchModel ?? null
    const launch = {
      agent: effectiveAgent,
      accessMode,
      credentialSlug: launchCredentialSlug ?? null,
      model,
      reasoningEffort,
    }
    immediateLaunchRef.current = launch
    void preferences.rememberLaunch(launch)
  }, [accessMode, effectiveAgent, launchCredentialSlug, launchModel, preferences])

  const resetCredentialSelection = useCallback(() => setPickedCredential(null), [])

  return useMemo(() => ({
    agents,
    effectiveAgent,
    selectedAgent,
    runtimeReadiness,
    selectedRuntimeReadiness,
    needsCredential,
    canSelectCredential,
    accessMode,
    credentials,
    effectiveCredential,
    credential,
    detectedCredential,
    workspaceConfigResolved,
    defaultModel,
    modelOptions,
    launchModel,
    effortOptions,
    selectedReasoningEffort,
    launchReasoningEffort,
    aiDetails,
    selectedRuntimeUsesGlobalConfig,
    credentialSelectionReady,
    noCredentials,
    needsProviderSetup: noCredentials,
    selectedMissing: selectedAgent?.installed === false,
    anyInstalled: agents.some((agent) => agent.installed !== false),
    agentsKnown: agents.length > 0,
    launchCredentialSlug,
    selectAgent,
    selectCredential,
    selectRuntimeDefault,
    selectWorkspaceDefault,
    selectModel,
    selectReasoningEffort,
    resetCredentialSelection,
  }), [
    agents,
    aiDetails,
    accessMode,
    canSelectCredential,
    credentials,
    credential,
    credentialSelectionReady,
    defaultModel,
    detectedCredential,
    effortOptions,
    effectiveAgent,
    effectiveCredential,
    launchCredentialSlug,
    launchModel,
    selectedReasoningEffort,
    launchReasoningEffort,
    modelOptions,
    needsCredential,
    noCredentials,
    runtimeReadiness,
    selectAgent,
    selectCredential,
    selectRuntimeDefault,
    selectWorkspaceDefault,
    selectModel,
    selectReasoningEffort,
    selectedAgent,
    selectedRuntimeReadiness,
    selectedRuntimeUsesGlobalConfig,
    workspaceConfigResolved,
    resetCredentialSelection,
  ])
}
