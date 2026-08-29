import { Hono } from 'hono'
import {
  BUILTIN_CONNECTOR_DEFINITIONS,
  connectorDefinitionHasCapability,
  publicConnectorConfigSchema,
  type PublicConnectorConfig,
} from '@traderalice/connector-protocol'
import {
  readPublicConnectorConfig,
  triggerConnectorRestart,
  writePublicConnectorConfig,
} from '../../core/connector-config.js'
import { connectorBridgeHealth, resolveConnectorUrl } from '../../services/connector-client/index.js'
import { detailIssue } from '../../workspaces/issues/board.js'
import {
  isConnectorDeskCadence,
  type ConnectorDeskCadence,
} from '../../workspaces/issues/connector-desk.js'
import type { WorkspaceService } from '../../workspaces/service.js'

export function createConnectorRoutes(deps: {
  getWorkspaceService?: () => WorkspaceService | null
  readConnectorConfig?: () => Promise<PublicConnectorConfig>
  fetchImpl?: typeof fetch
  restartConnectorService?: () => Promise<void>
} = {}) {
  const app = new Hono()
  const readConnectorConfig = deps.readConnectorConfig ?? readPublicConnectorConfig
  const fetchImpl = deps.fetchImpl ?? fetch
  const restartConnectorService = deps.restartConnectorService ?? triggerConnectorRestart

  app.get('/', async (c) => c.json({
    definitions: BUILTIN_CONNECTOR_DEFINITIONS,
    config: await readConnectorConfig(),
    health: await connectorBridgeHealth(),
  }))

  app.put('/', async (c) => {
    try {
      const config = publicConnectorConfigSchema.parse(await c.req.json())
      return c.json({ config: await writePublicConnectorConfig(config) })
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 400)
    }
  })

  const deskPayload = (desk: { wsId: string; issue: Parameters<typeof detailIssue>[0] }) => ({
    wsId: desk.wsId,
    issue: detailIssue(desk.issue, null),
  })

  app.get('/:id/desk', async (c) => {
    const service = deps.getWorkspaceService?.()
    if (!service) return c.json({ error: 'unavailable' }, 503)
    const desk = await service.connectorDesk(c.req.param('id'))
    if (!desk) return c.json({ desk: null })
    return c.json({ desk: deskPayload(desk) })
  })

  app.post('/:id/desk', async (c) => {
    const service = deps.getWorkspaceService?.()
    if (!service) return c.json({ error: 'unavailable' }, 503)
    const connectorId = c.req.param('id')
    const body = await c.req.json().catch(() => null) as { wsId?: unknown } | null
    const wsId = typeof body?.wsId === 'string' ? body.wsId.trim() : ''
    if (!wsId) return c.json({ error: 'invalid', message: 'wsId is required' }, 400)
    try {
      if (!isConnectorOwnerLinked(await readConnectorConfig(), connectorId)) {
        return c.json({
          error: 'not_linked',
          message: 'Link this connector to its private owner chat before enabling the phone desk',
        }, 409)
      }
      const desk = await service.createConnectorDesk(connectorId, wsId)
      return c.json({ desk: deskPayload(desk) }, 201)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (error instanceof Error && (error.name === 'ConnectorDeskConflict' || error.name === 'TelegramConnectorDeskConflict')) {
        return c.json({ error: 'conflict', message }, 409)
      }
      if (error instanceof Error && error.name === 'ConnectorDeskUnsupported') {
        return c.json({ error: 'unsupported', message }, 400)
      }
      if (message.startsWith('workspace not found')) return c.json({ error: 'not_found', message }, 404)
      return c.json({ error: 'failed', message }, 400)
    }
  })

  app.patch('/:id/desk', async (c) => {
    const service = deps.getWorkspaceService?.()
    if (!service) return c.json({ error: 'unavailable' }, 503)
    const body = await c.req.json().catch(() => null) as { what?: unknown; when?: unknown } | null
    const patch: { what?: string; when?: { kind: 'every'; every: ConnectorDeskCadence } } = {}
    if (typeof body?.what === 'string') {
      if (!body.what.trim()) {
        return c.json({ error: 'invalid', message: 'what must be non-empty markdown' }, 400)
      }
      patch.what = body.what
    }
    if (body?.when !== undefined) {
      const candidate = body.when as { kind?: unknown; every?: unknown } | null
      if (candidate?.kind !== 'every'
        || typeof candidate.every !== 'string'
        || !isConnectorDeskCadence(candidate.every)) {
        return c.json({ error: 'invalid', message: 'when must use a supported phone-desk cadence' }, 400)
      }
      patch.when = { kind: 'every', every: candidate.every }
    }
    if (patch.what === undefined && patch.when === undefined) {
      return c.json({ error: 'invalid', message: 'what or when is required' }, 400)
    }
    try {
      const desk = await service.updateConnectorDesk(c.req.param('id'), patch)
      return c.json({ desk: deskPayload(desk) })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (error instanceof Error && (
        error.name === 'ConnectorDeskNotFound' || error.name === 'TelegramConnectorDeskNotFound'
      )) {
        return c.json({ error: 'not_found', message }, 404)
      }
      return c.json({ error: 'invalid', message }, 400)
    }
  })

  app.delete('/:id/desk', async (c) => {
    const service = deps.getWorkspaceService?.()
    if (!service) return c.json({ error: 'unavailable' }, 503)
    const desk = await service.disableConnectorDesk(c.req.param('id'))
    return c.json({ desk: desk ? deskPayload(desk) : null })
  })

  app.post('/:id/test', async (c) => {
    try {
      const response = await fetch(new URL(`/v1/connectors/${encodeURIComponent(c.req.param('id'))}/test`, resolveConnectorUrl()), {
        method: 'POST',
        signal: AbortSignal.timeout(10_000),
      })
      if (!response.ok) throw new Error(`Connector Service test failed: ${response.status}`)
      return c.json(await response.json())
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 503)
    }
  })

  app.post('/:id/reconnect', async (c) => {
    const id = c.req.param('id')
    if (!BUILTIN_CONNECTOR_DEFINITIONS.some((definition) => definition.id === id)) {
      return c.json({ error: 'unknown_connector', message: `Unknown connector: ${id}` }, 404)
    }
    try {
      const response = await fetchImpl(new URL(`/v1/connectors/${encodeURIComponent(id)}/reconnect`, resolveConnectorUrl()), {
        method: 'POST',
        signal: AbortSignal.timeout(10_000),
      })
      if (!response.ok) {
        const detail = await response.json().catch(() => null) as { error?: unknown } | null
        return c.json({
          error: 'adapter_reconnect_failed',
          message: typeof detail?.error === 'string'
            ? detail.error
            : `Connector Service reconnect failed: ${response.status}`,
        }, 503)
      }
      return c.json({ ok: true, scope: 'adapter', adapterId: id })
    } catch {
      await restartConnectorService()
      return c.json({ ok: true, scope: 'service', adapterId: id }, 202)
    }
  })

  return app
}

export function isConnectorOwnerLinked(config: PublicConnectorConfig, connectorId: string): boolean {
  const definition = BUILTIN_CONNECTOR_DEFINITIONS.find((item) => item.id === connectorId)
  if (!definition || !connectorDefinitionHasCapability(definition, 'desk')) return false
  const adapter = config.adapters[connectorId]
  if (!adapter) return false
  const requiredSecrets = definition.fields.filter((field) => field.kind === 'secret' && field.required)
  if (requiredSecrets.some((field) => !adapter.configuredSecrets.includes(field.key))) return false
  return definition.fields
    .filter((field) => field.learnedBy === 'link')
    .every((field) => {
      const value = adapter.settings[field.key]
      return typeof value === 'string' && value.trim().length > 0
    })
}

export function isTelegramPrivateChatLinked(config: PublicConnectorConfig): boolean {
  return isConnectorOwnerLinked(config, 'telegram')
}
