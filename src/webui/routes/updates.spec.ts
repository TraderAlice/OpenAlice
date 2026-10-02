import { expect, it, vi } from 'vitest'
import { createUpdateRoutes } from './updates.js'
vi.mock('../../core/update-preferences.js', () => ({
  readUpdatePreferences: async () => ({ autoCheckApp: true, autoUpdateAutoQuant: true, autoUpdateAutoPrediction: true }),
}))
it('manual check observes without activating background policy', async () => {
  const activate = vi.fn()
  const check = vi.fn(async () => undefined)
  const app = createUpdateRoutes({ check, list: () => [] }, activate)
  const response = await app.request('/check', { method: 'POST' })
  expect(response.status).toBe(200)
  expect(check).toHaveBeenCalledOnce()
  expect(activate).not.toHaveBeenCalled()
  expect(await response.json()).toMatchObject({ workspaces: [], preferences: { autoUpdateAutoQuant: true } })
})
