/**
 * OpenAlice Connector Service.
 *
 * This optional, non-critical process owns external IM SDKs and long-lived
 * polling/gateway connections. Alice only hands it already-durable Inbox
 * notifications; a connector outage must never affect the original write.
 */
import { Hono } from 'hono'
import { serve } from '@hono/node-server'
import {
  connectorArtifactDeliverySchema,
  connectorArtifactFailureSchema,
  connectorDeliveryReceiptSchema,
  connectorUtaFailureSchema,
  connectorUtaPresentationSchema,
  inboxNotificationSchema,
  ownerChatMessageSchema,
} from '@traderalice/connector-protocol'
import { ConnectorRegistry } from './core/adapter.js'
import { DeliveryManager } from './core/delivery-manager.js'
import { ConnectorConfigStore } from './config-store.js'
import { discordConnectorRegistration } from './adapters/discord.js'
import { slackConnectorRegistration } from './adapters/slack.js'
import { telegramConnectorRegistration } from './adapters/telegram.js'
import { feishuConnectorRegistration } from './adapters/feishu.js'
import { ConnectorIOJournal } from './core/io-journal.js'
import { dataPath } from '@/core/paths.js'
import { installConnectorProxyTransport } from './core/proxy.js'

const CONNECTOR_PORT = Number(process.env['OPENALICE_CONNECTOR_PORT'] ?? 47334)

async function main(): Promise<void> {
  const startedAt = new Date().toISOString()
  console.log(`[connector] bootstrap @ ${startedAt}`)

  const configStore = new ConnectorConfigStore()
  const config = await configStore.read()
  const proxy = installConnectorProxyTransport()
  if (proxy.active) console.log('[connector] shared HTTP proxy transport enabled')
  const registry = new ConnectorRegistry()
  registry.register(discordConnectorRegistration(proxy))
  registry.register(telegramConnectorRegistration(proxy))
  registry.register(slackConnectorRegistration(proxy))
  registry.register(feishuConnectorRegistration(proxy))
  const journal = new ConnectorIOJournal({
    path: dataPath('logs', 'connector-io.jsonl'),
    warn: (message) => console.warn(`[connector] ${message}`),
  })

  const manager = new DeliveryManager({
    registry,
    config,
    startedAt,
    recorder: journal,
    updateAdapterSettings: (id, patch) => configStore.patchAdapter(id, patch),
  })
  // Install before opening the loopback port so health can say `starting`
  // instead of "configured but not running". Adapter SDKs reach the network
  // only after Guardian can already probe the process.
  manager.installEnabledAdapters()

  const app = new Hono()
  app.get('/__connector/health', (c) => c.json(manager.health()))
  app.get('/v1/definitions', (c) => c.json({ connectors: registry.definitions() }))
  app.post('/v1/notifications/inbox', async (c) => {
    const notification = inboxNotificationSchema.parse(await c.req.json())
    return c.json(connectorDeliveryReceiptSchema.parse(manager.enqueue(notification)), 202)
  })
  app.post('/v1/notifications/owner-chat', async (c) => {
    const message = ownerChatMessageSchema.parse(await c.req.json())
    return c.json(connectorDeliveryReceiptSchema.parse(manager.enqueueOwnerChat(message)), 202)
  })
  app.post('/v1/inbound/drain', async (c) => {
    return c.json({ messages: manager.drainInbound() })
  })
  app.post('/v1/inbound/return', async (c) => {
    const body = await c.req.json().catch(() => null) as { messages?: unknown } | null
    manager.returnInbound(Array.isArray(body?.messages) ? body.messages : [])
    return c.json({ ok: true })
  })
  app.post('/v1/actions/drain', (c) => {
    return c.json({ requests: manager.drainActions() })
  })
  app.post('/v1/artifacts/deliver', async (c) => {
    const delivery = connectorArtifactDeliverySchema.parse(await c.req.json())
    await manager.deliverArtifact(delivery)
    return c.json(connectorDeliveryReceiptSchema.parse({ accepted: true, deliveryId: delivery.requestId }))
  })
  app.post('/v1/artifacts/fail', async (c) => {
    const failure = connectorArtifactFailureSchema.parse(await c.req.json())
    await manager.failArtifact(failure)
    return c.json(connectorDeliveryReceiptSchema.parse({ accepted: true, deliveryId: failure.requestId }))
  })
  app.post('/v1/actions/uta/drain', (c) => {
    return c.json({ requests: manager.drainUtaActions() })
  })
  app.post('/v1/uta/present', async (c) => {
    const presentation = connectorUtaPresentationSchema.parse(await c.req.json())
    await manager.presentUta(presentation)
    return c.json(connectorDeliveryReceiptSchema.parse({ accepted: true, deliveryId: presentation.requestId }))
  })
  app.post('/v1/uta/fail', async (c) => {
    const failure = connectorUtaFailureSchema.parse(await c.req.json())
    await manager.failUta(failure)
    return c.json(connectorDeliveryReceiptSchema.parse({ accepted: true, deliveryId: failure.requestId }))
  })
  app.post('/v1/connectors/:id/test', async (c) => {
    const probeId = await manager.sendTest(c.req.param('id'))
    return c.json({ ok: true, probeId })
  })
  app.post('/v1/connectors/:id/reconnect', async (c) => {
    const adapter = await manager.reconnect(c.req.param('id'))
    return c.json({ ok: true, adapter })
  })
  app.onError((error, c) => {
    console.warn('[connector] request failed:', error instanceof Error ? error.message : error)
    return c.json({ error: error instanceof Error ? error.message : String(error) }, 400)
  })

  const server = serve({ fetch: app.fetch, port: CONNECTOR_PORT, hostname: '127.0.0.1' })
  console.log(`[connector] listening on http://127.0.0.1:${CONNECTOR_PORT}`)

  let stopping = false
  const shutdown = async (signal: string): Promise<void> => {
    if (stopping) return
    stopping = true
    console.log(`[connector] ${signal} → shutdown`)
    server.close()
    await manager.stop()
    await journal.flush()
    await proxy.close()
    process.exit(0)
  }
  process.on('SIGINT', () => { void shutdown('SIGINT') })
  process.on('SIGTERM', () => { void shutdown('SIGTERM') })

  await manager.start()
}

main().catch((error) => {
  console.error('[connector] fatal:', error)
  process.exit(1)
})
