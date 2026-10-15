import { Hono } from 'hono'
import { readUpdatePreferences } from '../../core/update-preferences.js'
import type { WorkspaceUpdateService } from '../../workspaces/workspace-update-service.js'

export function createUpdateRoutes(coordinator: Pick<WorkspaceUpdateService, 'check' | 'list'> & Partial<Pick<WorkspaceUpdateService, 'coordinator'>>, activate: () => void) {
  const app = new Hono()
  app.get('/inventory', async (c) => c.json({ ...await coordinator.coordinator?.inventorySnapshot(c.req.query('force') === '1'), capabilities: { 'project-updates': 1 } }))
  app.post('/plan', async (c) => {
    try { const input = await c.req.json(); return c.json(await coordinator.coordinator!.plan(input.units)) }
    catch (error) { return c.json({ error: String(error) }, 409) }
  })
  app.post('/operations', async (c) => {
    try { const input = await c.req.json(); const operation = await coordinator.coordinator!.approve(input.plan, input.fingerprint, input.id); return c.json(operation) }
    catch (error) { return c.json({ error: String(error) }, 409) }
  })
  app.get('/operations/:id', async c => c.json(await coordinator.coordinator!.status(c.req.param('id'))))
  app.post('/operations/:id/resume', async c => {
    try { return c.json(await coordinator.coordinator!.resume(c.req.param('id'))) }
    catch (error) { return c.json({ error: String(error) }, 409) }
  })
  app.post('/activate', (c) => {
    activate()
    return c.json({ accepted: true }, 202)
  })
  app.get('/', async (c) => c.json({
    preferences: await readUpdatePreferences(),
    workspaces: coordinator.list(),
  }))
  app.post('/check', async (c) => {
    await coordinator.check()
    return c.json({ preferences: await readUpdatePreferences(), workspaces: coordinator.list() })
  })
  return app
}
