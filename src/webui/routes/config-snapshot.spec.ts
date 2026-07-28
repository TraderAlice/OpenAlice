import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  writeConfigSection: vi.fn(),
  triggerUTARestart: vi.fn(),
}))

vi.mock('../../core/config.js', async () => {
  const actual = await vi.importActual<typeof import('../../core/config.js')>('../../core/config.js')
  return {
    ...actual,
    writeConfigSection: mocks.writeConfigSection,
  }
})

vi.mock('../../services/uta-supervisor/restart-trigger.js', () => ({
  triggerUTARestart: mocks.triggerUTARestart,
}))

import { createConfigRoutes } from './config.js'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.writeConfigSection.mockImplementation(async (_section, body) => body)
  mocks.triggerUTARestart.mockResolvedValue({ triggered: true, ready: true })
})

describe('snapshot config route', () => {
  it('requests a supervised UTA restart after persisting snapshot settings', async () => {
    const routes = createConfigRoutes()
    const response = await routes.request('/snapshot', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: true, every: '2h' }),
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ enabled: true, every: '2h' })
    expect(mocks.writeConfigSection).toHaveBeenCalledWith('snapshot', {
      enabled: true,
      every: '2h',
    })
    await vi.waitFor(() => expect(mocks.triggerUTARestart).toHaveBeenCalledOnce())
  })
})
