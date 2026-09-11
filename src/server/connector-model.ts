import type { Hono } from 'hono'
import { createHash } from 'node:crypto'
import { connectorModelRequestSchema, type ConnectorModelPanel } from '@traderalice/connector-protocol'
import type { WorkspaceService } from '../workspaces/service.js'
import { issueAssigneeResumeId } from '../workspaces/issues/declaration.js'
import { readCredentials } from '../core/config.js'
import { compatibleCredentials } from '../workspaces/credential-injection.js'
import { createSessionRuntimeBinding } from '../workspaces/session-runtime-binding.js'
import { BUILTIN_PRESETS } from '../ai-providers/presets.js'
import { isModelReasoningEffort } from '../ai-providers/model-semantics.js'
import { runtimeModelOptions, runtimeModelSemantics, runtimeEffortOptions } from '../ai-providers/runtime-model-options.js'

const revisionOf = (value: unknown) => createHash('sha256').update(JSON.stringify(value) ?? 'null').digest('hex')

/** Local control plane. Connector identity selects its own desk; no caller-supplied Workspace target. */
export function registerConnectorModelRoutes(app: Hono, service: () => WorkspaceService | null) {
  const saving = new Set<string>()
  app.post('/cli/connector-model/:connectorId', async c => {
    let savingResume: string | undefined
    try {
      const request = connectorModelRequestSchema.parse(await c.req.json())
      const svc = service()
      if (!svc) throw new Error('Alice is not ready')
      const connectorId = c.req.param('connectorId')
      const desk = await svc.connectorDesk(connectorId)
      const resumeId = desk && issueAssigneeResumeId(desk.issue.assignee)
      if (!desk || !resumeId) throw new Error('Send a message first so this chat has an assigned Session.')
      const identity = svc.resumeRegistry.get(resumeId)
      const workspace = svc.registry.get(desk.wsId)
      if (!identity || identity.wsId !== desk.wsId || !workspace || (identity.lifecycle === 'retired' || identity.presence === 'deleted')) throw new Error('The assigned Session is unavailable.')
      const adapter = svc.adapters.get(identity.agent)
      if (!adapter?.capabilities.aiProvider) throw new Error('This runtime does not support managed model selection.')
      const binding = identity.runtimeBinding
      if (!binding) throw new Error('This Session has no AI binding. Open its settings in OpenAlice first.')
      const revision = revisionOf(binding)
      if ((request.resumeId && request.resumeId !== resumeId) || (request.revision && request.revision !== revision)) {
        throw new Error('Session or configuration changed. Reopen /model before saving.')
      }
      const vault = await readCredentials()
      const credentials = compatibleCredentials(vault, adapter).map(([slug, cred]) => ({ id: `vault:${slug}`, label: cred.label || slug }))
      if (adapter.capabilities.aiProvider.credentialSource === 'runtime-or-workspace') credentials.unshift({ id: 'native', label: 'Runtime login' })
      const selected = request.selection ?? {
        credential: binding.credential.source === 'vault' ? `vault:${binding.credential.credentialSlug}` : binding.credential.source,
        model: binding.model ?? null, effort: binding.reasoningEffort ?? null,
      }
      if (request.selection && !credentials.some(row => row.id === selected.credential)) throw new Error('Select a compatible credential in OpenAlice first.')
      const catalog = runtimeModelOptions({ agent: identity.agent,
        credential: selected.credential === 'native' ? null : vault[selected.credential.slice(6)] ?? null,
        defaultModel: selected.credential === (binding.credential.source === 'vault' ? `vault:${binding.credential.credentialSlug}` : binding.credential.source) ? binding.model ?? null : null,
        presets: BUILTIN_PRESETS,
      })
      const models = catalog.map(m => ({ id: m.id, label: m.label }))
      // Like Chat, custom/provider-private model IDs remain supported. Runtime owns availability.
      if (selected.model && !models.some(m => m.id === selected.model)) models.unshift({ id: selected.model, label: selected.model })
      const semantics = runtimeModelSemantics(selected.model, catalog)
      const efforts = [...runtimeEffortOptions({ agent: identity.agent, semantics, modelKnown: semantics !== null, model: selected.model })]
      if (request.selection && selected.effort && !efforts.includes(selected.effort as typeof efforts[number])) throw new Error('That effort is not supported by the selected model.')
      const task = svc.headlessTasks?.latestForResumeId(resumeId)
      const panel: ConnectorModelPanel = { resumeId, revision, runtime: identity.agent, selection: selected, credentials, models, efforts, running: task?.status === 'running', saved: false }
      if (!request.apply) return c.json(panel)
      if (!request.resumeId || !request.revision || !request.selection) throw new Error('Reopen /model before saving.')
      if (saving.has(resumeId)) throw new Error('A settings update is already in progress. Try again.')
      saving.add(resumeId); savingResume = resumeId
      await svc.sessionRegistry.ensureLoaded(desk.wsId)
      const interactive = svc.sessionRegistry.findByResumeId(desk.wsId, resumeId)
      if (interactive?.state === 'running' && interactive.surface !== 'headless') throw new Error('Disconnect the interactive TUI/GUI before changing this Session.')
      const resolved = await createSessionRuntimeBinding({ adapter, cwd: workspace.dir, selection: {
        ...(selected.credential === 'native' ? { credentialSource: 'native' as const } : { credentialSlug: selected.credential.slice(6) }),
        ...(selected.model ? { model: selected.model } : {}),
        ...(selected.effort && isModelReasoningEffort(selected.effort) ? { reasoningEffort: selected.effort } : {}),
      } })
      // Resolution may await credential I/O; recheck both target and occupancy.
      const currentDesk = await svc.connectorDesk(connectorId)
      if (issueAssigneeResumeId(currentDesk?.issue.assignee ?? '') !== resumeId || revisionOf(svc.resumeRegistry.get(resumeId)?.runtimeBinding) !== revision) throw new Error('Session or configuration changed. Reopen /model.')
      const currentInteractive = svc.sessionRegistry.findByResumeId(desk.wsId, resumeId)
      if (currentInteractive?.state === 'running' && currentInteractive.surface !== 'headless') throw new Error('Disconnect the interactive TUI/GUI before changing this Session.')
      await svc.resumeRegistry.replaceRuntimeBinding({ resumeId, wsId: desk.wsId, agent: identity.agent, runtimeBinding: resolved.binding })
      const savedSelection = { ...selected, model: resolved.binding.model ?? null, effort: resolved.binding.reasoningEffort ?? null }
      if (savedSelection.model && !models.some(m => m.id === savedSelection.model)) models.unshift({ id: savedSelection.model, label: savedSelection.model })
      const savedSemantics = runtimeModelSemantics(savedSelection.model, catalog)
      return c.json({ ...panel, saved: true, revision: revisionOf(resolved.binding), selection: savedSelection,
        efforts: [...runtimeEffortOptions({ agent: identity.agent, semantics: savedSemantics, modelKnown: savedSemantics !== null, model: savedSelection.model })],
      })
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : 'Unable to update model settings' }, 400)
    } finally {
      if (savingResume) saving.delete(savingResume)
    }
  })
}
