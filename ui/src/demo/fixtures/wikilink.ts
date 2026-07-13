import type { Entity } from '../../api/entities'
import type { WikilinkIssueRef, WikilinkResolution } from '../../api/issues'
import { demoEntities } from './entities'
import { demoIssuesSnapshot } from './issues'

/**
 * Demo backing for GET /api/wikilink/resolve?name=<token> — the cross-namespace
 * `[[name]]` resolver. In the `[[]]` graph an issue and an entity are the SAME
 * kind of target (a globally-meaningful name), so this returns everything the
 * token could point at across BOTH namespaces; the UI navigates a unique target
 * or shows a picker on a collision.
 *
 * Derived live from the existing demo fixtures (no separate data), so it stays
 * consistent with the Tracked list and the issue board:
 *   • entity — the tracked entity whose `name` key matches (case-insensitive),
 *     or null. The full `Entity` is returned (backlinkCount stripped — that's a
 *     list-only field); its `name` is the Tracked-detail navigation key.
 *   • issues — every issue, across ALL demo workspaces, whose `id` OR `title`
 *     matches the token (case-insensitive). 0 / 1 / many.
 *
 * Matching mirrors the server (src/webui/routes/wikilink.ts + WorkspaceService
 * .resolveIssuesByName): unique token → one target; colliding token (entity +
 * issue(s), or >1 issue, e.g. the two "Liquidity risk review" issues) → several.
 */
export function demoWikilinkResolve(name: string): WikilinkResolution {
  const key = name.trim().toLowerCase()

  const match = demoEntities.find((e) => e.name.toLowerCase() === key)
  const entity: Entity | null = match
    ? {
        name: match.name,
        description: match.description,
        type: match.type,
        createdAt: match.createdAt,
      }
    : null

  const issues: WikilinkIssueRef[] = []
  for (const ws of demoIssuesSnapshot.workspaces) {
    for (const issue of ws.issues) {
      if (issue.id.toLowerCase() === key || issue.title.trim().toLowerCase() === key) {
        issues.push({ wsId: ws.wsId, wsTag: ws.tag, id: issue.id, title: issue.title })
      }
    }
  }

  return { name, entity, issues }
}
