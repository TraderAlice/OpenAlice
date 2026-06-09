/**
 * Bridge from Alice's central credential store to a workspace's per-CLI AI
 * config.
 *
 * The central store (`aiProviderSchema.credentials` in `core/config.ts`) holds
 * the vendor-neutral secret: `{ vendor, authType, apiKey?, baseUrl? }`. Each CLI
 * adapter instead consumes a `WorkspaceAiCred` (`cli-adapter.ts`) and renders it
 * into its own file format. A credential carries no model — model is always a
 * per-use choice — so the caller supplies it (plus the adapter-specific
 * `authMode` / `wireApi` knobs) via `overrides`.
 *
 * This is the one place that maps Credential → WorkspaceAiCred, used by
 * template-driven injection at workspace-create time and reusable by any future
 * "apply credential to workspace" path.
 */

import { resolveAnthropicAuthMode } from '@/core/credential-inference.js'
import { credentialWires, type Credential, type CredentialWireShape } from '@/core/config.js'
import type { AdapterRegistry, WorkspaceAiCred } from './cli-adapter.js'
import type { Logger } from './logger.js'
import type { AgentCredentialDecl } from './template-registry.js'

/**
 * The wire shapes each agent can speak, in preference order. The injector picks
 * the first one a credential actually has — so a credential serves an agent only
 * if it declares a compatible wire (codex's Responses-only lock means most
 * credentials can't drive it, which is the intended funnel toward pi/opencode).
 */
export const AGENT_WIRE_PREFERENCE: Record<string, CredentialWireShape[]> = {
  claude: ['anthropic'],
  codex: ['openai-responses'],
  opencode: ['openai-chat', 'anthropic', 'openai-responses'],
  pi: ['openai-chat', 'anthropic', 'openai-responses'],
}

/** Pick the wire an agent should use from a credential's capabilities (null = none compatible). */
export function pickAgentWire(
  wires: Partial<Record<CredentialWireShape, string>>,
  agentId: string,
): { shape: CredentialWireShape; baseUrl: string } | null {
  const pref = AGENT_WIRE_PREFERENCE[agentId] ?? ['openai-chat', 'anthropic', 'openai-responses']
  for (const shape of pref) {
    if (shape in wires) return { shape, baseUrl: wires[shape] ?? '' }
  }
  return null
}

export interface CredentialInjectionOverrides {
  /** Model id to run. Required in practice (a credential has none). */
  model?: string
  /** Claude only — which header carries the key. Defaults via baseUrl heuristic. */
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
  credential: Pick<Credential, 'apiKey' | 'baseUrl' | 'wireShape' | 'wires'>,
  agentId: string,
  overrides: CredentialInjectionOverrides = {},
): WorkspaceAiCred | null {
  const wires = credentialWires(credential as Credential)
  const picked = pickAgentWire(wires, agentId)
  if (!picked) return null

  const cred: WorkspaceAiCred = {
    baseUrl: picked.baseUrl || null,
    apiKey: credential.apiKey ?? null,
    model: overrides.model ?? null,
    // The chosen wire shape drives how the consuming adapter is configured
    // (which @ai-sdk package / api field / wire_api).
    wireShape: picked.shape,
  }

  if (agentId === 'claude') {
    cred.authMode = resolveAnthropicAuthMode({
      authMode: overrides.authMode,
      baseUrl: picked.baseUrl,
    })
  } else if (agentId === 'codex') {
    if (overrides.wireApi) cred.wireApi = overrides.wireApi
  }

  return cred
}

/**
 * Seed a freshly-created workspace's per-agent AI config from a template's
 * `agentCredentials` declaration + Alice's central credential store.
 *
 * MUST run AFTER the launcher's initial commit: `writeAiConfig` writes the
 * secret into `.claude/settings.local.json` / `.codex/env.json` / `opencode.json`
 * / `.pi-agent/`, which `_common.sh`'s `setup_git_excludes` keeps out of git —
 * but only post-commit are we certain the key never lands in the initial commit.
 *
 * Every miss (agent not enabled, no adapter, credential slug absent) is a loud
 * `warn` + skip, never a hard failure — a workspace that boots without a seeded
 * provider is still usable (the user configures it manually). Best-effort.
 */
export async function injectWorkspaceCredentials(opts: {
  readonly dir: string
  readonly agents: readonly string[]
  readonly agentCredentials: Readonly<Record<string, AgentCredentialDecl>>
  readonly adapterRegistry: AdapterRegistry
  readonly credentials: Record<string, Credential>
  readonly logger: Logger
}): Promise<void> {
  const { dir, agents, agentCredentials, adapterRegistry, credentials, logger } = opts
  for (const [agentId, decl] of Object.entries(agentCredentials)) {
    if (!agents.includes(agentId)) {
      logger.warn('workspace.cred_inject_skip_disabled', { agentId })
      continue
    }
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
    const wsCred = credentialToWorkspaceAiCred(credential, agentId, {
      ...(decl.model !== undefined ? { model: decl.model } : {}),
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
      agentId, credentialSlug: decl.credentialSlug, ...(decl.model ? { model: decl.model } : {}),
    })
  }
}
