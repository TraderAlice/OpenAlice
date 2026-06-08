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
import type { Credential } from '@/core/config.js'
import type { AdapterRegistry, WorkspaceAiCred } from './cli-adapter.js'
import type { Logger } from './logger.js'
import type { AgentCredentialDecl } from './template-registry.js'

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
 * expects. `agentId` selects which adapter-specific field is populated:
 *   - claude → `authMode` (derived via `resolveAnthropicAuthMode`)
 *   - codex  → `wireApi` (only when explicitly overridden; else adapter default)
 *   - opencode / pi → neither (plain OpenAI-compatible Chat Completions)
 */
export function credentialToWorkspaceAiCred(
  credential: Pick<Credential, 'apiKey' | 'baseUrl'>,
  agentId: string,
  overrides: CredentialInjectionOverrides = {},
): WorkspaceAiCred {
  const cred: WorkspaceAiCred = {
    baseUrl: credential.baseUrl ?? null,
    apiKey: credential.apiKey ?? null,
    model: overrides.model ?? null,
  }

  if (agentId === 'claude') {
    cred.authMode = resolveAnthropicAuthMode({
      authMode: overrides.authMode,
      baseUrl: credential.baseUrl,
    })
  } else if (agentId === 'codex') {
    // Leave undefined when not overridden so the codex adapter applies its own
    // default ('chat'); only custom-baseUrl providers write a wire_api at all.
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
    await adapter.writeAiConfig(dir, wsCred)
    logger.info('workspace.cred_injected', {
      agentId, credentialSlug: decl.credentialSlug, ...(decl.model ? { model: decl.model } : {}),
    })
  }
}
