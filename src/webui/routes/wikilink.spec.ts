/**
 * GET /api/wikilink/resolve — the cross-namespace [[name]] resolver. Drives the
 * route against an in-memory entity store and a stubbed `resolveIssuesByName`.
 */
import { describe, expect, it } from 'vitest'

import { createWikilinkRoutes } from './wikilink.js'
import { createMemoryEntityStore } from '../../core/entity-store.js'
import type { WikilinkIssueRef } from '../../workspaces/issues/board.js'
import type { WorkspaceService } from '../../workspaces/service.js'

/* eslint-disable @typescript-eslint/no-explicit-any */

function build(issuesByName: Record<string, WikilinkIssueRef[]>) {
  const entityStore = createMemoryEntityStore()
  const service = {
    resolveIssuesByName: async (name: string) => issuesByName[name.trim().toLowerCase()] ?? [],
  } as unknown as Pick<WorkspaceService, 'resolveIssuesByName'>
  return { app: createWikilinkRoutes({ entityStore, service }), entityStore }
}

async function get(app: any, q: string) {
  const res = await app.request(`/resolve${q}`)
  return { status: res.status, body: (await res.json().catch(() => null)) as any }
}

describe('GET /api/wikilink/resolve', () => {
  it('400 when name is missing or blank', async () => {
    const { app } = build({})
    expect((await get(app, '')).status).toBe(400)
    expect((await get(app, '?name=%20%20')).status).toBe(400)
  })

  it('resolves an entity-only token (no matching issue)', async () => {
    const { app, entityStore } = build({})
    await entityStore.upsert({ name: 'vst', description: 'Vistra', type: 'asset' })
    const r = await get(app, '?name=VST')
    expect(r.status).toBe(200)
    expect(r.body.entity?.name).toBe('vst')
    expect(r.body.issues).toEqual([])
  })

  it('resolves an issue-only token, case-insensitively', async () => {
    const refs: WikilinkIssueRef[] = [{ wsId: 'w1', wsTag: 'research', id: 'cleanup', title: 'Cleanup' }]
    const { app } = build({ cleanup: refs })
    const r = await get(app, '?name=Cleanup')
    expect(r.status).toBe(200)
    expect(r.body.entity).toBeNull()
    expect(r.body.issues).toEqual(refs)
  })

  it('returns BOTH an entity and multiple issues on a collision (UI disambiguates)', async () => {
    const refs: WikilinkIssueRef[] = [
      { wsId: 'w1', wsTag: 'a', id: 'brief', title: 'Brief' },
      { wsId: 'w2', wsTag: 'b', id: 'brief', title: 'Brief' },
    ]
    const { app, entityStore } = build({ brief: refs })
    await entityStore.upsert({ name: 'brief', description: 'a topic', type: 'topic' })
    const r = await get(app, '?name=brief')
    expect(r.body.entity?.name).toBe('brief')
    expect(r.body.issues).toHaveLength(2)
  })
})
