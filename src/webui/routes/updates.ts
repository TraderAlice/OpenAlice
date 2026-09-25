import { Hono } from 'hono'
import { readUpdatePreferences } from '../../core/update-preferences.js'
import type { WorkspaceAutoUpdates } from '../../workspaces/workspace-auto-updates.js'

export function createUpdateRoutes(coordinator: WorkspaceAutoUpdates, activate: () => void) {
  const app = new Hono()
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
