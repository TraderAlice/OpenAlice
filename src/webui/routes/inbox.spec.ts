import { describe, expect, it } from 'vitest'
import { createMemoryInboxStore } from '../../core/inbox-store.js'
import { createInboxRoutes } from './inbox.js'

describe('inbox routes', () => {
  it('marks entries read and unread through HTTP', async () => {
    const inboxStore = createMemoryInboxStore()
    const entry = await inboxStore.append({ workspaceId: 'ws-1', comments: 'done' })
    const app = createInboxRoutes({ inboxStore })

    const readRes = await app.request(`/${entry.id}/read`, { method: 'PUT' })
    expect(readRes.status).toBe(200)
    const readBody = await readRes.json() as { ok: true; id: string; readAt: number }
    expect(readBody.id).toBe(entry.id)
    expect(readBody.readAt).toBeGreaterThan(0)

    let history = await (await app.request('/history')).json() as {
      entries: Array<{ id: string; readAt?: number }>
    }
    expect(history.entries[0]).toMatchObject({ id: entry.id, readAt: readBody.readAt })

    const unreadRes = await app.request(`/${entry.id}/read`, { method: 'DELETE' })
    expect(unreadRes.status).toBe(200)

    history = await (await app.request('/history')).json() as {
      entries: Array<{ id: string; readAt?: number }>
    }
    expect(history.entries[0]).toEqual({ id: entry.id, ts: entry.ts, workspaceId: 'ws-1', comments: 'done' })
  })

  it('returns 404 when marking a missing entry', async () => {
    const app = createInboxRoutes({ inboxStore: createMemoryInboxStore() })
    expect((await app.request('/missing/read', { method: 'PUT' })).status).toBe(404)
    expect((await app.request('/missing/read', { method: 'DELETE' })).status).toBe(404)
  })
})
