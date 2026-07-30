/**
 * Bridge from Alice's central credential store to a workspace's per-CLI AI
 * config.
 *
 * The central store (`aiProviderSchema.credentials` in `core/config.ts`) holds
 * the vendor-neutral secret: `{ vendor, authType, apiKey?, baseUrl? }`. Each CLI
 * adapter instead consumes a `WorkspaceAiCred` (`cli-adapter.ts`) and renders it
 * into its own file format. A credential carries no model — model is always a
 * per-use choice — so the caller supplies it (plus the adapter-specific
 * `authMode` / `wireApi` knobs) via `overrides`. The vault's `lastModel` is a
 * remembered default, not a lock; callers may still supply a per-use model.
 *
 * This is the one place that maps Credential → WorkspaceAiCred, used by
 * template-driven injection at workspace-create time and reusable by any future
 * "apply credential to workspace" path.
 */

import { resolveAnthropicAuthMode } from '@/core/credential-inference.js'
import {
  credentialWires,
  type Credential,
  type CredentialWireShape,
} from '@/core/config.js'
import { DEFAULT_MODEL_BY_VENDOR } from '@/ai-providers/preset-catalog.js'
import { modelSupportsReasoning, resolveModelSemantics } from '@/ai-providers/model-semantics.js'
import type {
  AdapterRegistry,
  AgentProviderCapabilities,
  CliAdapter,
  WorkspaceAiCred,
} from './cli-adapter.js'
import type { Logger } from './logger.js'
import type { AgentCredentialDecl } from './template-registry.js'

/**
 * Provider-specific support inside an adapter's declared wire set.
 *
 * MiniMax is currently the deliberate exception to the generic OpenAI-compatible set:
 * its Anthropic endpoint is the documented coding-agent path and returns
 * native thinking blocks. The OpenAI endpoint requires `reasoning_split` and
 * returns an array-shaped `reasoning_details` extension that Pi and opencode's
 * generic OpenAI transports do not parse losslessly. The affected adapters
 * declare that vendor policy; this shared layer only applies the declaration.
 */
export function agentWirePreference(
  capabilities: AgentProviderCapabilities,
  vendor?: string | null,
): readonly CredentialWireShape[] {
  return (vendor ? capabilities.vendorPolicies?.[vendor]?.wirePreference : undefined)
    ?? capabilities.wirePreference
}

function inferredMinimaxAnthropicEndpoint(
  wires: Partial<Record<CredentialWireShape, string>>,
): string | undefined {
  const chatEndpoint = wires['openai-chat']?.trim()
  if (!chatEndpoint) return undefined
  try {
    const url = new URL(chatEndpoint)
    if (url.hostname !== 'api.minimax.io' && url.hostname !== 'api.minimaxi.com') return undefined
    return `${url.origin}/anthropic`
  } catch {
    return undefined
  }
}

function wireEndpoint(
  wires: Partial<Record<CredentialWireShape, string>>,
  shape: CredentialWireShape,
  vendor?: string | null,
): string | undefined {
  if (Object.prototype.hasOwnProperty.call(wires, shape)) return wires[shape] ?? ''
  if (vendor === 'minimax' && shape === 'anthropic') {
    return inferredMinimaxAnthropicEndpoint(wires)
  }
  return undefined
}

/**
 * The subset of a credential vault an agent can actually be driven by: those
 * with at least one wire shape the agent speaks (see `pickAgentWire`). Used by
 * quick-chat to populate the runtime's credential dropdown — a cred the agent
 * can't speak must never be offered (the codex Responses-lock funnel in reverse).
 * Returns `[slug, cred]` pairs, input order preserved.
 */
export function compatibleCredentials(
  credentials: Record<string, Credential>,
  adapter: CliAdapter,
): Array<[string, Credential]> {
  const capabilities = adapter.capabilities.aiProvider
  if (!capabilities) return []
  return Object.entries(credentials).filter(
    ([, cred]) => pickAgentWire(credentialWires(cred), capabilities, undefined, cred.vendor) !== null,
  )
}

/**
 * Reverse-map an on-disk workspace AI config back to the vault credential that
 * seeded it, by apiKey (the stable identity — a vault key is one account). This
 * is the "which cred is this workspace using" detection: read the agent's
 * `readAiConfig`, hand the apiKey here. Returns the slug, or null when the key
 * matches nothing in the vault (hand-edited / stale).
 */
export function matchCredentialByApiKey(
  credentials: Record<string, Credential>,
  apiKey: string | null | undefined,
): string | null {
  if (!apiKey) return null
  for (const [slug, cred] of Object.entries(credentials)) {
    if (cred.apiKey && cred.apiKey === apiKey) return slug
  }
  return null
}

/**
 * The model to inject for a credential: its remembered `lastModel`, else the
 * vendor's catalog default, else null (custom creds with no history — let the
 * runtime decide). This is the single resolution point shared by quick-chat
 * injection; a Workspace may still override it for one use.
 */
export function resolveInjectionModel(cred: Pick<Credential, 'vendor' | 'lastModel'>): string | null {
  return cred.lastModel ?? DEFAULT_MODEL_BY_VENDOR[cred.vendor] ?? null
}

/** Pick the wire an agent should use from a credential's capabilities (null = none compatible). */
export function pickAgentWire(
  wires: Partial<Record<CredentialWireShape, string>>,
  capabilities: AgentProviderCapabilities,
  requestedShape?: CredentialWireShape,
  vendor?: string | null,
): { shape: CredentialWireShape; baseUrl: string } | null {
  const pref = agentWirePreference(capabilities, vendor)
  if (requestedShape !== undefined) {
    const requestedEndpoint = wireEndpoint(wires, requestedShape, vendor)
    if (pref.includes(requestedShape) && requestedEndpoint !== undefined) {
      return { shape: requestedShape, baseUrl: requestedEndpoint }
    }
    // Heal Workspace defaults through the adapter's narrowly declared legacy
    // fallback. Other explicit protocol mismatches remain loud incompatibilities.
    const fallbackShape = vendor
      ? capabilities.vendorPolicies?.[vendor]?.legacyRequestedWireFallbacks?.[requestedShape]
      : undefined
    if (fallbackShape) {
      const fallbackEndpoint = wireEndpoint(wires, fallbackShape, vendor)
      if (fallbackEndpoint !== undefined) {
        return { shape: fallbackShape, baseUrl: fallbackEndpoint }
      }
    }
    return null
  }
  for (const shape of pref) {
    const endpoint = wireEndpoint(wires, shape, vendor)
    if (endpoint !== undefined) return { shape, baseUrl: endpoint }
  }
  return null
}

export interface CredentialInjectionOverrides {
  /** Model id to run. Required in practice (a credential has none). */
  model?: string
  /** Explicit protocol when a credential exposes several agent-compatible wires. */
  wireShape?: CredentialWireShape
  /** Explicit model-specific context preference for custom-model runtimes. */
  contextWindow?: number | null
  /** Unknown-model override for Pi/opencode. Registered model facts win. */
  reasoning?: boolean | null
  /** Explicit effort override. Known model defaults are filled by the registry. */
  reasoningEffort?: WorkspaceAiCred['reasoningEffort']
  /** Anthropic wire only — which header carries the key. Defaults via baseUrl heuristic. */
  authMode?: 'x-api-key' | 'bearer'
  /** Codex only — Responses vs Chat Completions. Adapter defaults to 'chat'. */
  wireApi?: 'chat' | 'responses'
}

/**
 * Map a central Credential into the `WorkspaceAiCred` the given agent's adapter
 * expects, picking the wire shape the agent speaks from the credential's
 * capabilities. Returns null when the credential has NO wire the agent supports
 * (caller must surface this — never silently inject a wrong shape).
 */
export function credentialToWorkspaceAiCred(
  credential: Pick<Credential, 'vendor' | 'apiKey' | 'baseUrl' | 'wireShape' | 'wires'>,
  adapter: CliAdapter,
  overrides: CredentialInjectionOverrides = {},
): WorkspaceAiCred | null {
  const capabilities = adapter.capabilities.aiProvider
  if (!capabilities) return null
  const wires = credentialWires(credential as Credential)
  const picked = pickAgentWire(wires, capabilities, overrides.wireShape, credential.vendor)
  if (!picked) return null

  const cred: WorkspaceAiCred = {
    baseUrl: picked.baseUrl || null,
    apiKey: credential.apiKey ?? null,
    model: overrides.model ?? null,
    // The chosen wire shape drives how the consuming adapter is configured
    // (which @ai-sdk package / api field / wire_api).
    wireShape: picked.shape,
  }

  const registration = capabilities.modelRegistration
  if (registration?.contextWindow) {
    const explicitContextWindow = positiveNumber(overrides.contextWindow)
    if (explicitContextWindow !== null) cred.contextWindow = explicitContextWindow
  }
  if (registration?.reasoning) {
    if (typeof overrides.reasoning === 'boolean') cred.reasoning = overrides.reasoning
  }
  if (overrides.reasoningEffort) cred.reasoningEffort = overrides.reasoningEffort

  if (picked.shape === 'anthropic') {
    cred.authMode = resolveAnthropicAuthMode({
      authMode: overrides.authMode,
      baseUrl: picked.baseUrl,
    })
  }
  if (overrides.wireApi) cred.wireApi = overrides.wireApi

  return applyRegisteredModelSemantics(cred, capabilities, credential.vendor)
}

/**
 * Project verified model facts into runtimes that register custom models.
 *
 * Known reasoning capability always wins over a stale/manual bit. Unknown
 * models retain an explicit override (or omit the field and let the runtime
 * fall back). A configured context window remains a user policy, but it is
 * capped at the provider-advertised maximum so we never claim an impossible
 * limit to Pi/opencode.
 */
export function applyRegisteredModelSemantics(
  cred: WorkspaceAiCred,
  capabilities: AgentProviderCapabilities,
  vendor: string | null | undefined,
): WorkspaceAiCred {
  const semantics = resolveModelSemantics(vendor, cred.model)
  if (!semantics) return cred

  const next: WorkspaceAiCred = { ...cred }
  const registration = capabilities.modelRegistration
  if (registration?.contextWindow) {
    const registeredContext = positiveNumber(semantics.contextWindow)
    const configuredContext = positiveNumber(cred.contextWindow)
    if (registeredContext !== null) {
      next.contextWindow = configuredContext === null
        ? registeredContext
        : Math.min(configuredContext, registeredContext)
    }
  }
  if (registration?.reasoning) {
    const reasoning = modelSupportsReasoning(semantics)
    if (reasoning !== null) next.reasoning = reasoning
  }
  if (!next.reasoningEffort && semantics.reasoning?.defaultEffort) {
    next.reasoningEffort = semantics.reasoning.defaultEffort
  }
  return next
}

function positiveNumber(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
}

/**
 * Seed a freshly-created workspace's per-agent AI config from a template's
 * `agentCredentials` declaration + Alice's central credential store.
 *
 * MUST run AFTER the launcher's initial commit: `writeAiConfig` writes the
 * secret into `.claude/settings.local.json` / `.codex/env.json` / `opencode.json`
 * / Pi's global models plus `.pi/settings.json`, which `_common.sh`'s
 * `setup_git_excludes` keeps out of git —
 * but only post-commit are we certain the key never lands in the initial commit.
 *
 * Every miss (no adapter, credential slug absent) is a loud
 * `warn` + skip, never a hard failure — a workspace that boots without a seeded
 * provider is still usable (the user configures it manually). Best-effort.
 */
export async function injectWorkspaceCredentials(opts: {
  readonly dir: string
  readonly agentCredentials: Readonly<Record<string, AgentCredentialDecl>>
  readonly adapterRegistry: AdapterRegistry
  readonly credentials: Record<string, Credential>
  readonly logger: Logger
}): Promise<void> {
  const { dir, agentCredentials, adapterRegistry, credentials, logger } = opts
  for (const [agentId, decl] of Object.entries(agentCredentials)) {
    const adapter = adapterRegistry.get(agentId)
    if (!adapter?.writeAiConfig) {
      logger.warn('workspace.cred_inject_skip_no_adapter', { agentId })
      continue
    }
    const credential = credentials[decl.credentialSlug]
    if (!credential) {
      logger.warn('workspace.cred_inject_missing_credential', {
        agentId, credentialSlug: decl.credentialSlug,
      })
      continue
    }
    const selectedModel = decl.model ?? resolveInjectionModel(credential)
    const reasoningMatchesModel = typeof decl.reasoning === 'boolean' && (
      decl.reasoningModel === selectedModel ||
      // Backward compatibility: an explicit model and override already form a
      // stable pair even in config written before reasoningModel existed.
      (decl.reasoningModel === undefined && decl.model === selectedModel)
    )
    const wsCred = credentialToWorkspaceAiCred(credential, adapter, {
      ...(selectedModel !== null ? { model: selectedModel } : {}),
      ...(decl.wireShape !== undefined ? { wireShape: decl.wireShape } : {}),
      ...(decl.contextWindow !== undefined
        ? { contextWindow: decl.contextWindow }
        : {}),
      ...(reasoningMatchesModel ? { reasoning: decl.reasoning } : {}),
      ...(decl.authMode !== undefined ? { authMode: decl.authMode } : {}),
      ...(decl.wireApi !== undefined ? { wireApi: decl.wireApi } : {}),
    })
    if (!wsCred) {
      // The credential has no wire shape this agent speaks (e.g. an OpenAI-Chat
      // key for codex, which is Responses-only). Loud skip — never inject a
      // mismatched shape.
      logger.warn('workspace.cred_inject_incompatible_wire', {
        agentId, credentialSlug: decl.credentialSlug,
      })
      continue
    }
    await adapter.writeAiConfig(dir, wsCred)
    logger.info('workspace.cred_injected', {
      agentId, credentialSlug: decl.credentialSlug, ...(selectedModel ? { model: selectedModel } : {}),
    })
  }
}
