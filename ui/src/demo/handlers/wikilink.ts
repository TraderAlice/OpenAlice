import { http, HttpResponse } from 'msw'
import { demoWikilinkResolve } from '../fixtures/wikilink'

// GET /api/wikilink/resolve?name=<token> — the cross-namespace `[[name]]`
// resolver the issue-detail body's clickable wikilinks call. Returns
// { name, entity: Entity | null, issues: WikilinkIssueRef[] } (canonical
// WikilinkResolution); a unique token yields one target, a collision yields
// several (e.g. `Liquidity risk review` → an issue in two workspaces). Mirrors
// the real route's empty-name guard (400 name_required).
export const wikilinkHandlers = [
  http.get('/api/wikilink/resolve', ({ request }) => {
    const name = new URL(request.url).searchParams.get('name') ?? ''
    if (!name.trim()) {
      return HttpResponse.json({ error: 'name_required' }, { status: 400 })
    }
    return HttpResponse.json(demoWikilinkResolve(name))
  }),
]
