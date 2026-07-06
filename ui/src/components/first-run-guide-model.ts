import type { TradingServiceStatus } from '../api/trading'
import type { UTAConfig, WireShape } from '../api/types'
import type { CredentialSummary } from '../api/config'
import type { AgentInfo } from './workspace/api'

const AGENT_WIRE_PREFERENCE: Record<string, WireShape[]> = {
  claude: ['anthropic'],
  codex: ['openai-responses'],
  opencode: ['openai-chat', 'anthropic', 'openai-responses'],
  pi: ['openai-chat', 'anthropic', 'openai-responses'],
}

const LOGIN_RUNTIME_AGENTS = new Set(['claude', 'codex'])

export const FIRST_RUN_STEP_KEYS = ['lite', 'ai', 'broker', 'finish'] as const
export type FirstRunStepKey = typeof FIRST_RUN_STEP_KEYS[number]

const STEP_OVERRIDE_ALIASES: Record<string, FirstRunStepKey> = {
  lite: 'lite',
  safe: 'lite',
  ai: 'ai',
  agent: 'ai',
  credential: 'ai',
  credentials: 'ai',
  runtime: 'ai',
  broker: 'broker',
  trading: 'broker',
  uta: 'broker',
  mode: 'broker',
  finish: 'finish',
  done: 'finish',
  checklist: 'finish',
}

export function parseFirstRunStepOverride(search: string, enabled: boolean): FirstRunStepKey | null {
  if (!enabled) return null
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search)
  const raw = params.get('onboardingStep') ?? params.get('step')
  if (!raw) return null
  return STEP_OVERRIDE_ALIASES[raw.trim().toLowerCase()] ?? null
}

export function buildFirstRunGuideAccess(input: {
  hasUsableAiChain: boolean
}) {
  return {
    canDismiss: input.hasUsableAiChain,
    maxReachableStepKey: input.hasUsableAiChain ? 'finish' as const : 'ai' as const,
  }
}

export function buildFirstRunGuideModel(input: {
  agents: readonly Pick<AgentInfo, 'id' | 'displayName' | 'kind' | 'installed'>[]
  credentials: readonly Pick<CredentialSummary, 'wires'>[]
  tradingStatus: TradingServiceStatus | null
  utas: UTAConfig[]
  loaded: boolean
  dismissed: boolean
}) {
  const agentRuntimes = input.agents.filter((a) => a.kind !== 'utility')
  const agentsKnown = agentRuntimes.length > 0
  const installedAgents = agentRuntimes.filter((a) => a.installed !== false)
  const installedAgent = installedAgents[0]
  const piAgent = agentRuntimes.find((a) => a.id === 'pi')
  const hasManagedPi = piAgent ? piAgent.installed !== false : false
  const hasAgentRuntime = agentsKnown && installedAgents.length > 0
  const noCredentials = input.credentials.length === 0
  const runtimeRows = agentRuntimes.map((agent) => {
    const installed = agent.installed !== false
    const compatibleCredentialCount = input.credentials.filter((credential) =>
      (AGENT_WIRE_PREFERENCE[agent.id] ?? ['openai-chat', 'anthropic', 'openai-responses'])
        .some((shape) => shape in credential.wires),
    ).length
    const loginRuntime = LOGIN_RUNTIME_AGENTS.has(agent.id)
    const chainReady = installed && compatibleCredentialCount > 0
    const accessLabel = !installed
      ? 'CLI not installed'
      : compatibleCredentialCount > 0
        ? 'Ready'
        : loginRuntime
          ? 'Login check pending'
          : 'Needs AI key'
    return {
      id: agent.id,
      displayName: agent.displayName,
      installed,
      loginRuntime,
      compatibleCredentialCount,
      chainReady,
      accessLabel,
    }
  }).sort((a, b) => {
    if (a.chainReady !== b.chainReady) return a.chainReady ? -1 : 1
    if (a.installed !== b.installed) return a.installed ? -1 : 1
    return 0
  })
  const hasUsableAiChain = runtimeRows.some((row) => row.chainReady)
  const mode = input.tradingStatus?.mode ?? 'lite'
  const modeSource = input.tradingStatus?.modeSource ?? 'auto'
  const hasUTA = input.utas.length > 0 || input.tradingStatus?.hasUTAConfig === true
  const needsUTASetup = mode !== 'lite' && !hasUTA
  const freshLite = mode === 'lite' && modeSource === 'auto' && !hasUTA
  const shouldShow = input.loaded && agentsKnown && !input.dismissed && (
    !hasAgentRuntime || !hasUsableAiChain || freshLite || needsUTASetup
  )
  const runtimeLabel = hasAgentRuntime
    ? `${installedAgents.length} runtime${installedAgents.length === 1 ? '' : 's'} installed`
    : piAgent
      ? 'Managed Pi runtime not detected'
      : 'Agent runtime not detected'
  const aiAccessLabel = noCredentials
    ? hasAgentRuntime && (installedAgent?.id === 'codex' || installedAgent?.id === 'claude')
      ? 'CLI login or AI key'
      : 'AI key needed'
    : 'AI key ready'

  return {
    shouldShow,
    hasAgentRuntime,
    installedAgent,
    hasManagedPi,
    runtimeRows,
    hasUsableAiChain,
    noCredentials,
    mode,
    modeSource,
    hasUTA,
    needsUTASetup,
    freshLite,
    runtimeLabel,
    aiAccessLabel,
  }
}
