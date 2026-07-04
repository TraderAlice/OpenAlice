import { readCredentials, setCredentialLastModel, type Credential } from '@/core/config.js'
import {
  compatibleCredentials,
  credentialToWorkspaceAiCred,
  matchCredentialByApiKey,
  resolveInjectionModel,
} from './credential-injection.js'
import type { CliAdapter, WorkspaceAiCred } from './cli-adapter.js'
import type { Logger } from './logger.js'
import type { WorkspaceMeta } from './workspace-registry.js'

/**
 * Provider-agnostic runtimes that cannot rely on a first-party CLI login in
 * OpenAlice's launch path. They need either a usable workspace AI config file
 * or an Alice vault credential we can inject before spawn/headless dispatch.
 */
export const LOGINLESS_AGENTS = new Set(['opencode', 'pi'])

export type AgentCredentialSource =
  | 'runtime-login'
  | 'workspace-config'
  | 'launcher-vault'
  | 'missing'
  | 'unknown-agent'
  | 'disabled-agent'

export interface AgentCredentialReadiness {
  readonly agent: string
  readonly ready: boolean
  readonly requiresCredential: boolean
  readonly source: AgentCredentialSource
  readonly hasWorkspaceConfig: boolean
  readonly hasUsableWorkspaceConfig: boolean
  readonly detectedCredentialSlug: string | null
  readonly compatibleCredentialSlugs: readonly string[]
  readonly injectableCredentialSlugs: readonly string[]
  readonly settingsTarget?: 'ai-provider'
  readonly message?: string
}

export class AgentCredentialError extends Error {
  readonly error = 'no_ai_credential'
  readonly settingsTarget = 'ai-provider'

  constructor(readonly agent: string, message = `agent "${agent}" needs an AI credential`) {
    super(message)
    this.name = 'AgentCredentialError'
  }

  toBody(): { error: string; agent: string; settingsTarget: 'ai-provider'; message: string } {
    return {
      error: this.error,
      agent: this.agent,
      settingsTarget: this.settingsTarget,
      message: this.message,
    }
  }
}

function trimString(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * "Usable" here means the runtime has enough concrete provider state to avoid
 * dying immediately on model/provider resolution. baseUrl may be empty for
 * first-party OpenAI/Anthropic-compatible defaults; apiKey + model are the
 * load-bearing fields for OpenAlice-managed opencode/Pi configs.
 */
export function isUsableWorkspaceAiCred(agentId: string, cred: WorkspaceAiCred | null | undefined): boolean {
  if (!LOGINLESS_AGENTS.has(agentId)) return true
  return trimString(cred?.apiKey).length > 0 && trimString(cred?.model).length > 0
}

function injectableCredentials(
  credentials: Record<string, Credential>,
  agentId: string,
): Array<[string, Credential, WorkspaceAiCred]> {
  const out: Array<[string, Credential, WorkspaceAiCred]> = []
  for (const [slug, credential] of compatibleCredentials(credentials, agentId)) {
    const model = resolveInjectionModel(credential)
    const wsCred = credentialToWorkspaceAiCred(credential, agentId, model ? { model } : {})
    if (wsCred && isUsableWorkspaceAiCred(agentId, wsCred)) out.push([slug, credential, wsCred])
  }
  return out
}

async function readWorkspaceConfig(meta: WorkspaceMeta, adapter: CliAdapter | undefined): Promise<WorkspaceAiCred | null> {
  if (!adapter?.readAiConfig) return null
  return adapter.readAiConfig(meta.dir).catch(() => null)
}

export async function getAgentCredentialReadiness(opts: {
  readonly meta: WorkspaceMeta
  readonly agentId: string
  readonly adapter: CliAdapter | undefined
  readonly credentials?: Record<string, Credential>
}): Promise<AgentCredentialReadiness> {
  const { meta, agentId, adapter } = opts
  if (!adapter) {
    return {
      agent: agentId,
      ready: false,
      requiresCredential: false,
      source: 'unknown-agent',
      hasWorkspaceConfig: false,
      hasUsableWorkspaceConfig: false,
      detectedCredentialSlug: null,
      compatibleCredentialSlugs: [],
      injectableCredentialSlugs: [],
      message: `unknown agent runtime: ${agentId}`,
    }
  }
  if (!meta.agents.includes(agentId)) {
    return {
      agent: agentId,
      ready: false,
      requiresCredential: LOGINLESS_AGENTS.has(agentId),
      source: 'disabled-agent',
      hasWorkspaceConfig: false,
      hasUsableWorkspaceConfig: false,
      detectedCredentialSlug: null,
      compatibleCredentialSlugs: [],
      injectableCredentialSlugs: [],
      message: `agent "${agentId}" is not enabled on this workspace`,
    }
  }
  if (!LOGINLESS_AGENTS.has(agentId)) {
    return {
      agent: agentId,
      ready: true,
      requiresCredential: false,
      source: 'runtime-login',
      hasWorkspaceConfig: false,
      hasUsableWorkspaceConfig: false,
      detectedCredentialSlug: null,
      compatibleCredentialSlugs: [],
      injectableCredentialSlugs: [],
    }
  }

  const credentials = opts.credentials ?? await readCredentials()
  const cfg = await readWorkspaceConfig(meta, adapter)
  const detectedCredentialSlug = matchCredentialByApiKey(credentials, cfg?.apiKey)
  const compatible = compatibleCredentials(credentials, agentId)
  const injectable = injectableCredentials(credentials, agentId)
  const hasUsableWorkspaceConfig = isUsableWorkspaceAiCred(agentId, cfg)

  if (hasUsableWorkspaceConfig) {
    return {
      agent: agentId,
      ready: true,
      requiresCredential: true,
      source: 'workspace-config',
      hasWorkspaceConfig: cfg !== null,
      hasUsableWorkspaceConfig: true,
      detectedCredentialSlug,
      compatibleCredentialSlugs: compatible.map(([slug]) => slug),
      injectableCredentialSlugs: injectable.map(([slug]) => slug),
    }
  }

  if (injectable.length > 0) {
    return {
      agent: agentId,
      ready: true,
      requiresCredential: true,
      source: 'launcher-vault',
      hasWorkspaceConfig: cfg !== null,
      hasUsableWorkspaceConfig: false,
      detectedCredentialSlug,
      compatibleCredentialSlugs: compatible.map(([slug]) => slug),
      injectableCredentialSlugs: injectable.map(([slug]) => slug),
    }
  }

  return {
    agent: agentId,
    ready: false,
    requiresCredential: true,
    source: 'missing',
    hasWorkspaceConfig: cfg !== null,
    hasUsableWorkspaceConfig: false,
    detectedCredentialSlug,
    compatibleCredentialSlugs: compatible.map(([slug]) => slug),
    injectableCredentialSlugs: [],
    settingsTarget: 'ai-provider',
    message: `agent "${agentId}" needs a workspace AI config or an Alice credential with a remembered/default model`,
  }
}

export async function ensureAgentCredentialReady(opts: {
  readonly meta: WorkspaceMeta
  readonly agentId: string
  readonly adapter: CliAdapter | undefined
  /** Explicit vault pick from a UI credential selector; ignored when not injectable. */
  readonly pickedCredentialSlug?: string
  readonly logger?: Logger
}): Promise<AgentCredentialReadiness> {
  const { meta, agentId, adapter, pickedCredentialSlug, logger } = opts
  if (!LOGINLESS_AGENTS.has(agentId)) {
    return getAgentCredentialReadiness({ meta, agentId, adapter })
  }
  if (!adapter?.writeAiConfig) {
    throw new AgentCredentialError(agentId, `agent "${agentId}" cannot accept an injected AI credential`)
  }

  const credentials = await readCredentials()
  const cfg = await readWorkspaceConfig(meta, adapter)
  const compatible = compatibleCredentials(credentials, agentId)
  const injectable = injectableCredentials(credentials, agentId)
  const injectableMap = new Map(injectable.map(([slug, credential, wsCred]) => [slug, { credential, wsCred }]))
  const detectedCredentialSlug = matchCredentialByApiKey(credentials, cfg?.apiKey)
  const picked = pickedCredentialSlug && injectableMap.has(pickedCredentialSlug) ? pickedCredentialSlug : null

  if (!picked && isUsableWorkspaceAiCred(agentId, cfg)) {
    return {
      agent: agentId,
      ready: true,
      requiresCredential: true,
      source: 'workspace-config',
      hasWorkspaceConfig: cfg !== null,
      hasUsableWorkspaceConfig: true,
      detectedCredentialSlug,
      compatibleCredentialSlugs: compatible.map(([slug]) => slug),
      injectableCredentialSlugs: injectable.map(([slug]) => slug),
    }
  }

  const chosenSlug =
    picked ??
    (detectedCredentialSlug && injectableMap.has(detectedCredentialSlug) ? detectedCredentialSlug : null) ??
    injectable[0]?.[0] ??
    null
  if (!chosenSlug) {
    throw new AgentCredentialError(
      agentId,
      `agent "${agentId}" needs a workspace AI config or an Alice credential with a remembered/default model`,
    )
  }
  const chosen = injectableMap.get(chosenSlug)
  if (!chosen) throw new AgentCredentialError(agentId)

  await adapter.writeAiConfig(meta.dir, chosen.wsCred)
  if (chosen.wsCred.model) {
    await setCredentialLastModel(chosenSlug, chosen.wsCred.model).catch(() => undefined)
  }
  logger?.info('workspace.agent_cred_injected', {
    id: meta.id,
    agent: agentId,
    slug: chosenSlug,
    ...(chosen.wsCred.model ? { model: chosen.wsCred.model } : {}),
    ...(detectedCredentialSlug && detectedCredentialSlug !== chosenSlug ? { replaced: detectedCredentialSlug } : {}),
  })

  return {
    agent: agentId,
    ready: true,
    requiresCredential: true,
    source: 'launcher-vault',
    hasWorkspaceConfig: true,
    hasUsableWorkspaceConfig: true,
    detectedCredentialSlug: chosenSlug,
    compatibleCredentialSlugs: compatible.map(([slug]) => slug),
    injectableCredentialSlugs: injectable.map(([slug]) => slug),
  }
}
