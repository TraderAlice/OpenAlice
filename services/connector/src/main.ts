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
  connectorDeliveryReceiptSchema,
  inboxNotificationSchema,
} from '@traderalice/connector-protocol'
import { ConnectorRegistry } from './core/adapter.js'
import { DeliveryManager } from './core/delivery-manager.js'
import { ConnectorConfigStore } from './config-store.js'
import { discordConnectorRegistration } from './adapters/discord.js'
import { telegramConnectorRegistration } from './adapters/telegram.js'
import { ConnectorIOJournal } from './core/io-journal.js'
import { dataPath } from '@/core/paths.js'

const CONNECTOR_PORT = Number(process.env['OPENALICE_CONNECTOR_PORT'] ?? 47334)

async function main(): Promise<void> {
  const startedAt = new Date().toISOString()
  console.log(`[connector] bootstrap @ ${startedAt}`)

  const configStore = new ConnectorConfigStore()
  const config = await configStore.read()
  const registry = new ConnectorRegistry()
  registry.register(discordConnectorRegistration())
  registry.register(telegramConnectorRegistration())
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
  await manager.start()

  const app = new Hono()
  app.get('/__connector/health', (c) => c.json(manager.health()))
  app.get('/v1/definitions', (c) => c.json({ connectors: registry.definitions() }))
  app.post('/v1/notifications/inbox', async (c) => {
    const notification = inboxNotificationSchema.parse(await c.req.json())
    return c.json(connectorDeliveryReceiptSchema.parse(manager.enqueue(notification)), 202)
  })
  app.post('/v1/connectors/:id/test', async (c) => {
    const probeId = await manager.sendTest(c.req.param('id'))
    return c.json({ ok: true, probeId })
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
    process.exit(0)
  }
  process.on('SIGINT', () => { void shutdown('SIGINT') })
  process.on('SIGTERM', () => { void shutdown('SIGTERM') })
}

main().catch((error) => {
  console.error('[connector] fatal:', error)
  process.exit(1)
})
