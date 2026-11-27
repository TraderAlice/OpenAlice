import type { ModelReasoningEffort } from '../ai-providers/model-semantics.js'
import { readCredentials, type Credential } from '../core/config.js'
import {
  readAutoPredictionPreferences,
  readAutoQuantPreferences,
  readQuickChatPreferences,
} from '../core/preferences.js'
import type { WorkspaceToolContext } from '../core/workspace-tool-center.js'
import {
  AUTO_PREDICTION_WORKSPACE_TEMPLATE,
  AUTO_QUANT_WORKSPACE_TEMPLATE,
  CHAT_WORKSPACE_TEMPLATE,
} from '../workspaces/chat-workspace-resolver.js'
import { COMMANDER_WORKSPACE_ID } from '../workspaces/commander-workspace.js'
import { isAgentRuntime, type CliAdapter } from '../workspaces/cli-adapter.js'
import { compatibleCredentials } from '../workspaces/credential-injection.js'
import { logger as launcherLogger } from '../workspaces/logger.js'
import type { WorkspaceService } from '../workspaces/service.js'
import type { WorkspaceMeta } from '../workspaces/workspace-registry.js'
import {
  emptyWorkspaceRuntimeSettings,
  isDefaultRuntimeModel,
  readWorkspaceRuntimeSettings,
  replaceWorkspaceRuntimeDefaults,
  resolveWorkspaceRuntimeAgent,
  resolveWorkspaceRuntimeSelection,
  type ReadWorkspaceRuntimeSettingsResult,
  type WorkspaceRuntimeMode,
  type WorkspaceRuntimePreference,
} from '../workspaces/workspace-runtime-settings.js'

export interface WorkspaceRuntimeControlDeps {
  readCredentials?: () => Promise<Record<string, Credential>>
  readQuickChatPreferences?: () => Promise<{ recentChatWorkspaceId: string | null }>
  readAutoQuantPreferences?: () => Promise<{ defaultWorkspaceId: string | null }>
  readAutoPredictionPreferences?: () => Promise<{ defaultWorkspaceId: string | null }>
}

async function resolveTargetWorkspace(
  svc: WorkspaceService,
  input: { readonly wsId?: string; readonly harness?: 'chat' | 'autoquant' | 'prediction' },
  deps: WorkspaceRuntimeControlDeps,
): Promise<WorkspaceMeta> {
  if (input.harness) {
    if (input.harness === 'chat') {
      const prefs = await (deps.readQuickChatPreferences ?? readQuickChatPreferences)().catch(() => ({
        recentChatWorkspaceId: null,
      }))
      const preferred = prefs.recentChatWorkspaceId
        ? svc.registry.get(prefs.recentChatWorkspaceId)
        : undefined
      if (preferred?.template === CHAT_WORKSPACE_TEMPLATE) return preferred
      const fallback = svc.registry.list().find((ws) => ws.template === CHAT_WORKSPACE_TEMPLATE)
      if (!fallback) throw new Error('Chat workspace is not initialized')
      return fallback
    }
    const isPrediction = input.harness === 'prediction'
    const prefs = await (isPrediction
      ? (deps.readAutoPredictionPreferences ?? readAutoPredictionPreferences)()
      : (deps.readAutoQuantPreferences ?? readAutoQuantPreferences)()
    ).catch(() => ({ defaultWorkspaceId: null }))
    const expectedTemplate = isPrediction
      ? AUTO_PREDICTION_WORKSPACE_TEMPLATE
      : AUTO_QUANT_WORKSPACE_TEMPLATE
    const meta = prefs.defaultWorkspaceId ? svc.registry.get(prefs.defaultWorkspaceId) : undefined
    if (!meta || meta.template !== expectedTemplate) {
      throw new Error(
        isPrediction
          ? 'Prediction workspace is not initialized'
          : 'AutoQuant workspace is not initialized',
      )
    }
    return meta
  }

  const wsId = input.wsId
  if (!wsId) throw new Error('target workspace is required: pass --ws-id or --harness')
  if (wsId === COMMANDER_WORKSPACE_ID) {
    throw new Error('commander has no business runtime settings; pass --ws-id or --harness')
  }
  const byId = svc.registry.get(wsId)
  if (byId) return byId

  const normalized = wsId.trim().toLowerCase()
  const byTag = svc.registry.list().filter((ws) => ws.tag.trim().toLowerCase() === normalized)
  if (byTag.length === 1) return byTag[0]!
  if (byTag.length > 1) {
    throw new Error(
      `ambiguous workspace tag "${wsId}": matches ${byTag.map((w) => `${w.id} (${w.tag})`).join(', ')}; pass exact --ws-id`,
    )
  }
  throw new Error(`unknown workspace: ${wsId}`)
}

async function buildModeView(
  svc: WorkspaceService,
  meta: WorkspaceMeta,
  read: ReadWorkspaceRuntimeSettingsResult,
  mode: WorkspaceRuntimeMode,
  requestedAgent?: string,
) {
  const settings = read.ok ? read.settings : null
  const modeSettings = settings?.runtime[mode] ?? { agents: {}, recent: { agents: {} } }
  const effectiveAgent =
    requestedAgent
    ?? resolveWorkspaceRuntimeAgent(settings, mode)
    ?? (mode === 'headless'
      ? await svc.resolveHeadlessDefaultAgentId(meta).catch(() => undefined)
      : undefined)
    ?? null
  const selection = effectiveAgent
    ? resolveWorkspaceRuntimeSelection(settings, mode, effectiveAgent, undefined)
    : undefined
  return {
    defaultAgent: modeSettings.defaultAgent ?? null,
    effective: {
      agent: effectiveAgent,
      credentialSource: selection ? (selection.credentialSlug ? 'vault' : 'native') : null,
      ...(selection?.credentialSlug ? { credential: selection.credentialSlug } : {}),
      model: selection?.model ?? null,
      effort: selection?.reasoningEffort ?? null,
    },
    configured: {
      defaultAgent: modeSettings.defaultAgent ?? null,
      agents: modeSettings.agents,
    },
    recent: {
      agent: modeSettings.recent.agent ?? null,
      agents: modeSettings.recent.agents,
    },
  }
}

async function buildInspectResult(
  svc: WorkspaceService,
  meta: WorkspaceMeta,
  read: ReadWorkspaceRuntimeSettingsResult,
  requestedMode?: WorkspaceRuntimeMode,
  requestedAgent?: string,
): Promise<Record<string, unknown>> {
  const runtime: Record<string, unknown> = {}
  if (!requestedMode || requestedMode === 'interactive') {
    runtime['interactive'] = await buildModeView(svc, meta, read, 'interactive', requestedAgent)
  }
  if (!requestedMode || requestedMode === 'headless') {
    runtime['headless'] = await buildModeView(svc, meta, read, 'headless', requestedAgent)
  }
  return {
    workspace: {
      id: meta.id,
      tag: meta.tag,
      ...(meta.template ? { template: meta.template } : {}),
    },
    settingsStatus: read.ok ? 'configured' : read.reason,
    ...(!read.ok && read.reason === 'invalid' ? { settingsError: read.error } : {}),
    runtime,
  }
}

/** Workspace default runtime settings control plane — shared by CLI and MCP gateways. */
export function makeWorkspaceRuntimeControl(
  svc: WorkspaceService,
  deps: WorkspaceRuntimeControlDeps = {},
): NonNullable<WorkspaceToolContext['workspaceRuntimeControl']> {
  return {
    get: async (input) => {
      const meta = await resolveTargetWorkspace(svc, input, deps)
      const read = await readWorkspaceRuntimeSettings(meta.dir)
      return buildInspectResult(svc, meta, read, input.mode, input.agent)
    },

    set: async (input) => {
      const meta = await resolveTargetWorkspace(svc, input, deps)
      const read = await readWorkspaceRuntimeSettings(meta.dir)
      if (!read.ok && read.reason === 'invalid') {
        throw new Error(`cannot update invalid Workspace runtime settings: ${read.error}`)
      }
      const current = read.ok ? read.settings : emptyWorkspaceRuntimeSettings()
      const modesToUpdate: readonly WorkspaceRuntimeMode[] =
        input.mode === 'interactive'
          ? ['interactive']
          : input.mode === 'headless'
            ? ['headless']
            : ['interactive', 'headless']
      const hasPreferencePatch = Boolean(
        input.credential
        || input.credentialSource
        || input.model
        || input.clearModel
        || input.effort
        || input.clearEffort,
      )

      const validateAgent = (mode: WorkspaceRuntimeMode, agentId: string): CliAdapter => {
        const adapter = svc.adapters.get(agentId)
        if (!adapter || !isAgentRuntime(adapter)) {
          throw new Error(`unknown agent runtime: ${agentId}`)
        }
        if (mode === 'headless' && (!adapter.capabilities.headless || !adapter.composeHeadlessCommand)) {
          throw new Error(
            `agent runtime does not support headless launches: ${agentId}`
              + (input.mode ? '' : ' (pass --mode interactive)'),
          )
        }
        return adapter
      }

      const nextRuntime: Record<WorkspaceRuntimeMode, {
        defaultAgent: string | null
        agents: Record<string, WorkspaceRuntimePreference>
      }> = {
        interactive: {
          defaultAgent: current.runtime.interactive.defaultAgent ?? null,
          agents: { ...current.runtime.interactive.agents },
        },
        headless: {
          defaultAgent: current.runtime.headless.defaultAgent ?? null,
          agents: { ...current.runtime.headless.agents },
        },
      }

      const credentials = input.credential
        ? await (deps.readCredentials ?? readCredentials)().catch(() => ({} as Record<string, Credential>))
        : null

      for (const mode of modesToUpdate) {
        if (input.agent) {
          validateAgent(mode, input.agent)
          nextRuntime[mode].defaultAgent = input.agent
        }

        if (hasPreferencePatch) {
          const targetAgent =
            input.agent
            ?? resolveWorkspaceRuntimeAgent(current, mode)
            ?? (mode === 'interactive' ? resolveWorkspaceRuntimeAgent(current, 'headless') : undefined)
            ?? await svc.resolveHeadlessDefaultAgentId(meta).catch(() => undefined)
          if (!targetAgent) {
            throw new Error(`cannot infer target agent for ${mode} mode; pass --agent <id>`)
          }
          const adapter = validateAgent(mode, targetAgent)
          const base =
            current.runtime[mode].agents[targetAgent]
            ?? current.runtime[mode].recent.agents[targetAgent]

          const credentialChanged = input.credentialSource === 'native'
            ? base?.accessMode === 'vault'
            : input.credential !== undefined
              ? base?.accessMode !== 'vault' || base.credentialSlug !== input.credential
              : false

          if (input.credential) {
            const cred = credentials?.[input.credential]
            if (!cred) {
              throw new Error(`credential not found: ${input.credential}`)
            }
            if (!compatibleCredentials(credentials!, adapter).some(([slug]) => slug === input.credential)) {
              throw new Error(`credential ${input.credential} is not compatible with ${targetAgent}`)
            }
          }

          const nextModel = input.clearModel || isDefaultRuntimeModel(input.model)
            ? undefined
            : input.model
              ? input.model.trim()
              : !credentialChanged && base?.model && !isDefaultRuntimeModel(base.model)
                ? base.model
                : undefined

          const nextEffort = input.clearEffort
            ? undefined
            : input.effort
              ? (input.effort as ModelReasoningEffort)
              : !credentialChanged && base?.reasoningEffort
                ? base.reasoningEffort
                : undefined

          const nextPreference: WorkspaceRuntimePreference = input.credential
            ? {
                accessMode: 'vault',
                credentialSlug: input.credential,
                ...(nextModel ? { model: nextModel } : {}),
                ...(nextEffort ? { reasoningEffort: nextEffort } : {}),
              }
            : input.credentialSource === 'native' || !base || base.accessMode === 'native'
              ? {
                  accessMode: 'native',
                  ...(nextModel ? { model: nextModel } : {}),
                  ...(nextEffort ? { reasoningEffort: nextEffort } : {}),
                }
              : {
                  accessMode: 'vault',
                  credentialSlug: base.credentialSlug,
                  ...(base.wireShape ? { wireShape: base.wireShape } : {}),
                  ...(nextModel ? { model: nextModel } : {}),
                  ...(nextEffort ? { reasoningEffort: nextEffort } : {}),
                }

          nextRuntime[mode].agents[targetAgent] = nextPreference
        }
      }

      const saved = await replaceWorkspaceRuntimeDefaults({
        wsDir: meta.dir,
        runtime: nextRuntime,
      })
      launcherLogger.info('workspace.runtime_defaults_saved', { id: meta.id, source: 'cli' })
      return buildInspectResult(
        svc,
        meta,
        { ok: true, settings: saved },
        input.mode === 'interactive' || input.mode === 'headless' ? input.mode : undefined,
        input.agent,
      )
    },
  }
}
