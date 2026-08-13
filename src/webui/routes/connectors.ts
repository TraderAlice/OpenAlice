import { Hono } from 'hono'
import {
  BUILTIN_CONNECTOR_DEFINITIONS,
  publicConnectorConfigSchema,
  type PublicConnectorConfig,
} from '@traderalice/connector-protocol'
import {
  readPublicConnectorConfig,
  writePublicConnectorConfig,
} from '../../core/connector-config.js'
import { connectorBridgeHealth, resolveConnectorUrl } from '../../services/connector-client/index.js'
import { detailIssue } from '../../workspaces/issues/board.js'
import {
  isTelegramConnectorCadence,
} from '../../workspaces/issues/telegram-connector.js'
import type { WorkspaceService } from '../../workspaces/service.js'

export function createConnectorRoutes(deps: {
  getWorkspaceService?: () => WorkspaceService | null
  readConnectorConfig?: () => Promise<PublicConnectorConfig>
} = {}) {
  const app = new Hono()
  const readConnectorConfig = deps.readConnectorConfig ?? readPublicConnectorConfig

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

  app.get('/telegram/desk', async (c) => {
    const service = deps.getWorkspaceService?.()
    if (!service) return c.json({ error: 'unavailable' }, 503)
    const desk = await service.telegramConnectorDesk()
    if (!desk) return c.json({ desk: null })
    return c.json({
      desk: {
        wsId: desk.wsId,
        issue: detailIssue(desk.issue, null),
      },
    })
  })

  app.post('/telegram/desk', async (c) => {
    const service = deps.getWorkspaceService?.()
    if (!service) return c.json({ error: 'unavailable' }, 503)
    const body = await c.req.json().catch(() => null) as { wsId?: unknown } | null
    const wsId = typeof body?.wsId === 'string' ? body.wsId.trim() : ''
    if (!wsId) return c.json({ error: 'invalid', message: 'wsId is required' }, 400)
    try {
      if (!isTelegramPrivateChatLinked(await readConnectorConfig())) {
        return c.json({
          error: 'not_linked',
          message: 'Link the Telegram bot to its private owner chat before enabling the phone desk',
        }, 409)
      }
      const desk = await service.createTelegramConnectorDesk(wsId)
      return c.json({ desk: { wsId: desk.wsId, issue: detailIssue(desk.issue, null) } }, 201)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (error instanceof Error && error.name === 'TelegramConnectorDeskConflict') {
        return c.json({ error: 'conflict', message }, 409)
      }
      if (message.startsWith('workspace not found')) return c.json({ error: 'not_found', message }, 404)
      return c.json({ error: 'failed', message }, 400)
    }
  })

  app.patch('/telegram/desk', async (c) => {
    const service = deps.getWorkspaceService?.()
    if (!service) return c.json({ error: 'unavailable' }, 503)
    const body = await c.req.json().catch(() => null) as { what?: unknown; when?: unknown } | null
    const patch: Parameters<WorkspaceService['updateTelegramConnectorDesk']>[0] = {}
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
        || !isTelegramConnectorCadence(candidate.every)) {
        return c.json({ error: 'invalid', message: 'when must use a supported Telegram phone-desk cadence' }, 400)
      }
      patch.when = { kind: 'every', every: candidate.every }
    }
    if (patch.what === undefined && patch.when === undefined) {
      return c.json({ error: 'invalid', message: 'what or when is required' }, 400)
    }
    try {
      const desk = await service.updateTelegramConnectorDesk(patch)
      return c.json({ desk: { wsId: desk.wsId, issue: detailIssue(desk.issue, null) } })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (error instanceof Error && error.name === 'TelegramConnectorDeskNotFound') {
        return c.json({ error: 'not_found', message }, 404)
      }
      return c.json({ error: 'invalid', message }, 400)
    }
  })

  app.delete('/telegram/desk', async (c) => {
    const service = deps.getWorkspaceService?.()
    if (!service) return c.json({ error: 'unavailable' }, 503)
    const desk = await service.disableTelegramConnectorDesk()
    return c.json({ desk: desk ? { wsId: desk.wsId, issue: detailIssue(desk.issue, null) } : null })
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

  return app
}

export function isTelegramPrivateChatLinked(config: PublicConnectorConfig): boolean {
  const telegram = config.adapters.telegram
  if (!telegram?.configuredSecrets.includes('botToken')) return false
  const ownerUserId = telegram.settings.ownerUserId
  const chatId = telegram.settings.chatId
  return typeof ownerUserId === 'string' && ownerUserId.trim().length > 0
    && typeof chatId === 'string' && chatId.trim().length > 0
}
