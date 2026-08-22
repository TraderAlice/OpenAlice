import { Hono, type Context } from 'hono'

import {
  HarnessManifestError,
  type HarnessSurfaceManager,
  type HarnessSurfaceSnapshot,
} from '../../workspaces/harness-surface-manager.js'

const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/

export function createHarnessSurfaceRoutes(
  manager: HarnessSurfaceManager,
  opts: { getGatewayPort: () => number | null },
): Hono {
  const app = new Hono()

  app.get('/:workspaceId/:capability', (c) => {
    const ids = params(c.req.param('workspaceId'), c.req.param('capability'))
    if (!ids) return c.json({ error: 'not_found' }, 404)
    return c.json(present(manager.snapshot(ids.workspaceId, ids.capability), opts.getGatewayPort()))
  })

  app.post('/:workspaceId/:capability/start', async (c) => mutate(c, () => {
    const ids = params(c.req.param('workspaceId'), c.req.param('capability'))
    return ids ? manager.start(ids.workspaceId, ids.capability) : null
  }, opts))

  app.post('/:workspaceId/:capability/restart', async (c) => mutate(c, () => {
    const ids = params(c.req.param('workspaceId'), c.req.param('capability'))
    return ids ? manager.restart(ids.workspaceId, ids.capability) : null
  }, opts))

  app.post('/:workspaceId/:capability/stop', async (c) => mutate(c, () => {
    const ids = params(c.req.param('workspaceId'), c.req.param('capability'))
    return ids ? manager.stop(ids.workspaceId, ids.capability) : null
  }, opts))

  return app
}

async function mutate(
  c: Context,
  operation: () => Promise<HarnessSurfaceSnapshot> | null,
  opts: { getGatewayPort: () => number | null },
) {
  try {
    const promise = operation()
    if (!promise) return c.json({ error: 'not_found' }, 404)
    return c.json(present(await promise, opts.getGatewayPort()))
  } catch (err) {
    if (err instanceof HarnessManifestError) {
      return c.json({ error: err.code, message: err.message }, err.code === 'missing' ? 404 : 422)
    }
    if (err instanceof Error && err.name === 'WorkspaceNotFound') {
      return c.json({ error: 'workspace_not_found', message: err.message }, 404)
    }
    if (err instanceof Error && err.name === 'HarnessCapabilityNotFound') {
      return c.json({ error: 'capability_not_found', message: err.message }, 404)
    }
    return c.json({ error: 'surface_failed', message: err instanceof Error ? err.message : String(err) }, 500)
  }
}

function present(snapshot: HarnessSurfaceSnapshot, gatewayPort: number | null) {
  return {
    surface: snapshot,
    ...(snapshot.routeHost && gatewayPort ? { gatewayPort } : {}),
  }
}

function params(workspaceId: string, capability: string) {
  return ID.test(workspaceId) && ID.test(capability) ? { workspaceId, capability } : null
}
