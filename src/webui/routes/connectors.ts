import { Hono } from 'hono'
import {
  BUILTIN_CONNECTOR_DEFINITIONS,
  publicConnectorConfigSchema,
} from '@traderalice/connector-protocol'
import {
  readPublicConnectorConfig,
  writePublicConnectorConfig,
} from '../../core/connector-config.js'
import { ConnectorClient } from '@traderalice/connector-protocol'
import { connectorBridgeHealth, resolveConnectorUrl } from '../../services/connector-client/index.js'

export function createConnectorRoutes() {
  const app = new Hono()

  app.get('/', async (c) => c.json({
    definitions: BUILTIN_CONNECTOR_DEFINITIONS,
    config: await readPublicConnectorConfig(),
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
