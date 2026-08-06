import { createHash } from 'node:crypto'

import { isModelReasoningEffort } from '@/ai-providers/model-semantics.js'
import type { Credential } from '@/core/config.js'
import { readCredentials } from '@/core/config.js'

import type {
  CliAdapter,
  ResolvedSessionRuntimeBinding,
  SessionRuntimeBinding,
  WorkspaceAiCred,
} from './cli-adapter.js'
import {
  credentialToWorkspaceAiCred,
  matchCredentialByApiKey,
  resolveInjectionModel,
} from './credential-injection.js'

export class SessionRuntimeBindingError extends Error {
  constructor(
    readonly code:
      | 'credential_not_found'
      | 'credential_incompatible'
      | 'workspace_binding_missing'
      | 'workspace_binding_changed'
      | 'adapter_contract_missing',
    message: string,
  ) {
    super(message)
    this.name = 'SessionRuntimeBindingError'
  }
}

/** Optional choices captured exactly once when a product Session is created. */
export interface SessionRuntimeSelection {
  readonly credentialSlug?: string
  readonly model?: string
  readonly reasoningEffort?: SessionRuntimeBinding['reasoningEffort']
}

/**
 * Freeze an explicit native-runtime binding without consulting Workspace files.
 *
 * This is intentionally separate from `createSessionRuntimeBinding()`: fresh
 * Sessions may adopt a Workspace-local creation default, while an existing
 * legacy Session whose identity predates runtime bindings must not silently
 * adopt whatever provider happens to be in that Workspace today. Native auth,
 * model, and provider discovery remain owned by the child runtime; OpenAlice
 * may still project an independently persisted model or effort override.
 */
export function createNativeSessionRuntimeBinding(input: {
  readonly adapter: CliAdapter
  readonly selection?: Omit<SessionRuntimeSelection, 'credentialSlug'>
}): ResolvedSessionRuntimeBinding {
  assertedAgentContract(input.adapter)
  const selection = input.selection ?? {}
  const binding: SessionRuntimeBinding = {
    version: 1,
    credential: { source: 'native' },
    ...modelFields(selection.model, selection.reasoningEffort),
  }
  return {
    binding,
    ai: binding.model || binding.reasoningEffort
      ? { model: binding.model ?? null, reasoningEffort: binding.reasoningEffort ?? null }
      : null,
  }
}

function providerFingerprint(ai: WorkspaceAiCred): string {
  return createHash('sha256').update(JSON.stringify({
    baseUrl: ai.baseUrl ?? null,
    apiKey: ai.apiKey ?? null,
    wireShape: ai.wireShape ?? null,
    authMode: ai.authMode ?? null,
  })).digest('hex')
}

function assertedAgentContract(adapter: CliAdapter): void {
  if (!adapter.sessionRuntime) {
    throw new SessionRuntimeBindingError(
      'adapter_contract_missing',
      `Agent runtime "${adapter.id}" does not implement Session runtime projection`,
    )
  }
}

function modelFields(
  model: string | null | undefined,
  reasoningEffort: SessionRuntimeBinding['reasoningEffort'],
): Pick<SessionRuntimeBinding, 'model' | 'reasoningEffort'> {
  return {
    ...(model ? { model } : {}),
    ...(reasoningEffort ? { reasoningEffort } : {}),
  }
}

function credentialFor(
  credentials: Readonly<Record<string, Credential>>,
  credentialSlug: string,
): Credential {
  const credential = credentials[credentialSlug]
  if (!credential) {
    throw new SessionRuntimeBindingError(
      'credential_not_found',
      `Session credential "${credentialSlug}" is no longer available`,
    )
  }
  return credential
}

function resolveVault(
  adapter: CliAdapter,
  credentials: Readonly<Record<string, Credential>>,
  credentialSlug: string,
  input: {
    readonly requestedWireShape?: WorkspaceAiCred['wireShape']
    readonly model?: string
    readonly reasoningEffort?: SessionRuntimeBinding['reasoningEffort']
  },
): ResolvedSessionRuntimeBinding {
  const credential = credentialFor(credentials, credentialSlug)
  const selectedModel = input.model ?? resolveInjectionModel(credential) ?? undefined
  const ai = credentialToWorkspaceAiCred(credential, adapter, {
    ...(input.requestedWireShape ? { wireShape: input.requestedWireShape } : {}),
    ...(selectedModel ? { model: selectedModel } : {}),
    ...(input.reasoningEffort ? { reasoningEffort: input.reasoningEffort } : {}),
  })
  if (!ai?.wireShape) {
    throw new SessionRuntimeBindingError(
      'credential_incompatible',
      `Credential "${credentialSlug}" is not compatible with ${adapter.displayName}`,
    )
  }
  const binding: SessionRuntimeBinding = {
    version: 1,
    credential: {
      source: 'vault',
      credentialSlug,
      wireShape: ai.wireShape,
    },
    ...modelFields(ai.model, ai.reasoningEffort ?? undefined),
  }
  return { binding, ai }
}

/** Resolve and freeze a fresh product Session's launch selection. */
export async function createSessionRuntimeBinding(input: {
  readonly adapter: CliAdapter
  readonly cwd: string
  readonly selection?: SessionRuntimeSelection
  readonly credentials?: Readonly<Record<string, Credential>>
}): Promise<ResolvedSessionRuntimeBinding> {
  assertedAgentContract(input.adapter)
  const selection = input.selection ?? {}
  if (selection.credentialSlug) {
    const credentials = input.credentials ?? await readCredentials()
    return resolveVault(input.adapter, credentials, selection.credentialSlug, {
      ...(selection.model ? { model: selection.model } : {}),
      ...(selection.reasoningEffort ? { reasoningEffort: selection.reasoningEffort } : {}),
    })
  }

  const workspace = await input.adapter.readAiConfig?.(input.cwd).catch(() => null) ?? null
  if (!workspace) {
    return createNativeSessionRuntimeBinding({ adapter: input.adapter, selection })
  }

  const selectedModel = selection.model ?? workspace.model ?? undefined
  const selectedEffort = selection.reasoningEffort ?? workspace.reasoningEffort ?? undefined
  if (!workspace.apiKey && !workspace.baseUrl) {
    const binding: SessionRuntimeBinding = {
      version: 1,
      credential: { source: 'native' },
      ...modelFields(selectedModel, selectedEffort),
    }
    return { binding, ai: { ...workspace, model: selectedModel ?? null, reasoningEffort: selectedEffort ?? null } }
  }

  const credentials = input.credentials ?? await readCredentials()
  const slug = matchCredentialByApiKey(credentials as Record<string, Credential>, workspace.apiKey)
  if (slug) {
    return resolveVault(input.adapter, credentials, slug, {
      ...(workspace.wireShape ? { requestedWireShape: workspace.wireShape } : {}),
      ...(selectedModel ? { model: selectedModel } : {}),
      ...(selectedEffort ? { reasoningEffort: selectedEffort } : {}),
    })
  }

  const ai = { ...workspace, model: selectedModel ?? null, reasoningEffort: selectedEffort ?? null }
  return {
    binding: {
      version: 1,
      credential: { source: 'workspace', fingerprint: providerFingerprint(ai) },
      ...modelFields(selectedModel, selectedEffort),
    },
    ai,
  }
}

/** Resolve a persisted binding without changing its credential/model choices. */
export async function resolveSessionRuntimeBinding(input: {
  readonly adapter: CliAdapter
  readonly cwd: string
  readonly binding: SessionRuntimeBinding
  readonly credentials?: Readonly<Record<string, Credential>>
}): Promise<ResolvedSessionRuntimeBinding> {
  assertedAgentContract(input.adapter)
  const credential = input.binding.credential
  if (credential.source === 'vault') {
    const resolved = resolveVault(
      input.adapter,
      input.credentials ?? await readCredentials(),
      credential.credentialSlug,
      {
        requestedWireShape: credential.wireShape,
        ...(input.binding.model ? { model: input.binding.model } : {}),
        ...(input.binding.reasoningEffort ? { reasoningEffort: input.binding.reasoningEffort } : {}),
      },
    )
    return { binding: input.binding, ai: resolved.ai }
  }
  if (credential.source === 'workspace') {
    const ai = await input.adapter.readAiConfig?.(input.cwd).catch(() => null) ?? null
    if (!ai) {
      throw new SessionRuntimeBindingError(
        'workspace_binding_missing',
        'The Workspace provider used by this Session is no longer available',
      )
    }
    if (providerFingerprint(ai) !== credential.fingerprint) {
      throw new SessionRuntimeBindingError(
        'workspace_binding_changed',
        'The Workspace provider used by this Session changed; restore it or start a new Session',
      )
    }
    return {
      binding: input.binding,
      ai: {
        ...ai,
        model: input.binding.model ?? null,
        reasoningEffort: input.binding.reasoningEffort ?? null,
      },
    }
  }
  return {
    binding: input.binding,
    ai: input.binding.model || input.binding.reasoningEffort
      ? {
          model: input.binding.model ?? null,
          reasoningEffort: input.binding.reasoningEffort ?? null,
        }
      : null,
  }
}

export function parseSessionRuntimeBinding(value: unknown): SessionRuntimeBinding | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  if (record['version'] !== 1) return null
  const rawCredential = record['credential']
  if (!rawCredential || typeof rawCredential !== 'object' || Array.isArray(rawCredential)) return null
  const credential = rawCredential as Record<string, unknown>
  const source = credential['source']
  let parsedCredential: SessionRuntimeBinding['credential']
  if (source === 'native') {
    parsedCredential = { source: 'native' }
  } else if (
    source === 'vault'
    && typeof credential['credentialSlug'] === 'string'
    && (
      credential['wireShape'] === 'anthropic'
      || credential['wireShape'] === 'google-generative-ai'
      || credential['wireShape'] === 'openai-chat'
      || credential['wireShape'] === 'openai-responses'
    )
  ) {
    parsedCredential = {
      source: 'vault',
      credentialSlug: credential['credentialSlug'],
      wireShape: credential['wireShape'],
    }
  } else if (source === 'workspace' && typeof credential['fingerprint'] === 'string') {
    parsedCredential = { source: 'workspace', fingerprint: credential['fingerprint'] }
  } else {
    return null
  }
  const model = record['model']
  const effort = record['reasoningEffort']
  if (model !== undefined && typeof model !== 'string') return null
  if (effort !== undefined && !isModelReasoningEffort(effort)) return null
  return {
    version: 1,
    credential: parsedCredential,
    ...(typeof model === 'string' && model.length > 0 ? { model } : {}),
    ...(isModelReasoningEffort(effort) ? { reasoningEffort: effort } : {}),
  }
}
