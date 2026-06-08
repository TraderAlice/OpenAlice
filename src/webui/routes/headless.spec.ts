import { describe, expect, it, vi } from 'vitest'

import { createHeadlessRoutes } from './headless.js'
import type { WorkspaceService } from '../../workspaces/service.js'

/* eslint-disable @typescript-eslint/no-explicit-any */

const TASKS = [
  { taskId: 't1', wsId: 'w1', agent: 'codex', status: 'done', startedAt: 1 },
  { taskId: 't2', wsId: 'w2', agent: 'pi', status: 'running', startedAt: 2 },
]

function build() {
  const list = vi.fn((opts: any = {}) =>
    TASKS.filter(
      (t) => (!opts.wsId || t.wsId === opts.wsId) && (!opts.status || t.status === opts.status),
    ),
  )
  const get = vi.fn((id: string) => TASKS.find((t) => t.taskId === id) ?? null)
  const svc = { headlessTasks: { list, get } } as unknown as WorkspaceService
  return { app: createHeadlessRoutes(svc), list, get }
}

describe('GET /api/headless', () => {
  it('lists tasks', async () => {
    const { app } = build()
    const r = await app.request('/')
    expect(r.status).toBe(200)
    expect(((await r.json()) as any).tasks.length).toBe(2)
  })

  it('passes wsId/status/limit filters through to the registry', async () => {
    const { app, list } = build()
    await app.request('/?wsId=w1&status=done&limit=5')
    expect(list).toHaveBeenCalledWith({ wsId: 'w1', status: 'done', limit: 5 })
  })

  it('ignores an invalid status (→ undefined)', async () => {
    const { app, list } = build()
    await app.request('/?status=bogus')
    expect(list).toHaveBeenCalledWith(expect.objectContaining({ status: undefined }))
  })

  it('GET /:taskId returns one record', async () => {
    const { app } = build()
    const r = await app.request('/t1')
    expect(r.status).toBe(200)
    expect(((await r.json()) as any).taskId).toBe('t1')
  })

  it('GET /:taskId 404s on unknown id', async () => {
    const { app } = build()
    expect((await app.request('/nope')).status).toBe(404)
  })
})
