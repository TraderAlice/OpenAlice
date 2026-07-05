/**
 * Entity HTTP route — the Tracked tab's read surface.
 *
 *   GET /          list all tracked entities, each with a backlink count
 *   GET /:name     one entity + its backlinks (the notes that link `[[name]]`)
 *
 * Writes happen via the `entity_upsert` MCP tool, not here — creation is the
 * agent's job from inside a workspace. Backlinks are computed on demand by
 * scanning workspace markdown (see core/entity-backlinks.ts); the route stays
 * thin and delegates.
 */

import { Hono } from 'hono'

import type { IEntityStore } from '../../core/entity-store.js'
import type { WorkspaceRegistry } from '../../workspaces/workspace-registry.js'
import { scanBacklinks, warmBacklinks } from '../../core/entity-backlinks.js'

export interface EntityRoutesDeps {
  entityStore: IEntityStore
  registry: WorkspaceRegistry
}

export function createEntityRoutes(deps: EntityRoutesDeps) {
  const app = new Hono()

  // Warm the backlink cache at startup so the first Tracked open doesn't pay
  // for a cold full-corpus scan (the slow path the user hit).
  warmBacklinks(deps.registry)

  app.get('/', async (c) => {
    const [entities, backlinks] = await Promise.all([
      deps.entityStore.list(),
      scanBacklinks(deps.registry),
    ])
    const items = entities.map((e) => ({
      ...e,
      backlinkCount: backlinks.get(e.name.toLowerCase())?.length ?? 0,
    }))
    return c.json({ entities: items })
  })

  app.get('/:name', async (c) => {
    const entity = await deps.entityStore.get(c.req.param('name'))
    if (!entity) return c.json({ error: 'not_found' }, 404)
    const backlinks = await scanBacklinks(deps.registry)
    return c.json({ entity, backlinks: backlinks.get(entity.name.toLowerCase()) ?? [] })
  })

  return app
}
