import { describe, expect, it, vi } from 'vitest'
import { createWorkspaceRoutes } from './workspaces.js'
import type { WorkspaceService } from '../../workspaces/service.js'
function setup() {
  const record = { id: 's', wsId: 'w', resumeId: 'r' }
  const interrupt = vi.fn(async () => true)
  const release = vi.fn(async () => {})
  const configure = vi.fn(async () => {})
  const service = {
    config: { launcherRepoRoot: '/unused' },
    sessionRegistry: { get: (ws: string, id: string) => ws === 'w' && id === 's' ? record : undefined },
    executions: {
      current: () => ({ executionId: 'e', phase: 'running' }),
      interrupt, admission: { blocks: () => [], cooldownSeconds: 600, release, configure },
    },
  } as unknown as WorkspaceService
  return { app: createWorkspaceRoutes(service), interrupt, release, configure }
}
const json = (body: unknown, method = 'POST') => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
describe('Session control HTTP boundary', () => {
  it('requires roster ownership and expected execution identity, and owns actor attribution', async () => {
    const { app, interrupt } = setup()
    expect((await app.request('/wrong/sessions/s/interrupt', json({ executionId: 'e' }))).status).toBe(404)
    expect((await app.request('/w/sessions/s/interrupt', json({}))).status).toBe(400)
    expect((await app.request('/w/sessions/s/interrupt', json({ executionId: 'e', actor: { kind: 'system' } }))).status).toBe(400)
    expect((await app.request('/w/sessions/s/interrupt', json({ executionId: 'e' }))).status).toBe(200)
    expect(interrupt).toHaveBeenCalledExactlyOnceWith('r', 'e', { kind: 'user', entry: 'session-interrupt', workspaceId: 'w' })
  })
  it('returns stop failures without claiming success and exposes current policy', async () => {
    const { app, interrupt, release, configure } = setup()
    interrupt.mockRejectedValueOnce(new Error('still alive'))
    expect((await app.request('/w/sessions/s/interrupt', json({ executionId: 'e' }))).status).toBe(409)
    const data = await (await app.request('/w/sessions/s/control')).json()
    expect(data).toMatchObject({ execution: { executionId: 'e' }, cooldownSeconds: 600, blocks: [] })
    await app.request('/w/sessions/s/blocks/b/release', json({}))
    expect(release).toHaveBeenCalledWith('r', 'b', expect.objectContaining({ kind: 'user' }))
    expect((await app.request('/session-controls/settings', json({ cooldownSeconds: 0 }, 'PUT'))).status).toBe(400)
    await app.request('/session-controls/settings', json({ cooldownSeconds: 120 }, 'PUT'))
    expect(configure).toHaveBeenCalledWith(120, expect.objectContaining({ kind: 'user' }))
  })
})
