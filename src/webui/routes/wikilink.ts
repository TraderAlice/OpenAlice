/**
 * /api/wikilink — the cross-namespace `[[name]]` resolver.
 *
 * In the `[[]]` knowledge graph an issue and an entity are the SAME kind of
 * link target: a globally-meaningful name. This route takes one `[[name]]`
 * token and tells the UI everything that name could point at, across BOTH
 * namespaces, so a clickable wikilink can navigate (unique target) or offer a
 * disambiguation picker (collision):
 *
 *   GET /api/wikilink/resolve?name=<token>
 *     → { name, entity: Entity | null, issues: WikilinkIssueRef[] }
 *
 * - `entity`  — the matching tracked entity (case-insensitive on its `name`
 *               key), or null. Entities are NOT files; they come from the global
 *               entity store. The full record is returned (its `name` field is
 *               the navigation key for the Tracked detail).
 * - `issues`  — every issue, across ALL workspaces, whose `id` OR `title`
 *               matches the token (case-insensitive). 0 / 1 / many. Each ref
 *               carries the wsId so navigation stays wsId-precise even when the
 *               name collides (`/issues/:wsId/:id`).
 *
 * A unique token resolves to exactly one of these; a colliding token (>1 issue,
 * or entity + issue(s)) yields multiple, and the UI disambiguates. No name is
 * ever workspace-prefixed; collisions are surfaced here, not encoded into names.
 */

import { Hono } from 'hono'

import type { IEntityStore } from '../../core/entity-store.js'
import type { WorkspaceService } from '../../workspaces/service.js'

export interface WikilinkRoutesDeps {
  entityStore: IEntityStore
  service: Pick<WorkspaceService, 'resolveIssuesByName'>
}

export function createWikilinkRoutes(deps: WikilinkRoutesDeps): Hono {
  const app = new Hono()

  app.get('/resolve', async (c) => {
    const name = c.req.query('name') ?? ''
    if (!name.trim()) return c.json({ error: 'name_required' }, 400)
    const [entity, issues] = await Promise.all([
      deps.entityStore.get(name),
      deps.service.resolveIssuesByName(name),
    ])
    return c.json({ name, entity, issues })
  })

  return app
}
