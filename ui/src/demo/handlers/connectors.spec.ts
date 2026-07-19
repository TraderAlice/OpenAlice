import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { setupServer } from 'msw/node'
import { connectorsHandlers, resetDemoConnectorState } from './connectors'

const server = setupServer(...connectorsHandlers)
const baseUrl = window.location.origin

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => {
  server.resetHandlers()
  resetDemoConnectorState()
})
afterAll(() => server.close())

describe('demo Connector handlers', () => {
  it('returns the disabled Discord and Telegram settings snapshot', async () => {
    const response = await fetch(`${baseUrl}/api/connectors`)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.definitions.map((definition: { id: string }) => definition.id)).toEqual(['discord', 'telegram'])
    expect(body.config).toEqual({
      serviceEnabled: false,
      adapters: {
        discord: { enabled: false, settings: {}, configuredSecrets: [] },
        telegram: { enabled: false, settings: {}, configuredSecrets: [] },
      },
    })
    expect(body.health).toEqual({ enabled: false, status: 'disabled' })
  })

  it('echoes public PUT state without returning entered secrets', async () => {
    const response = await fetch(`${baseUrl}/api/connectors`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        serviceEnabled: true,
        adapters: {
          discord: {
            enabled: true,
            settings: { applicationId: 'demo-app', botToken: 'demo-secret' },
            configuredSecrets: [],
          },
        },
      }),
    })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.config.adapters.discord).toEqual({
      enabled: true,
      settings: { applicationId: 'demo-app' },
      configuredSecrets: ['botToken'],
    })
    expect(JSON.stringify(body)).not.toContain('demo-secret')

    const refreshed = await fetch(`${baseUrl}/api/connectors`).then((result) => result.json())
    expect(refreshed.config).toEqual(body.config)
    expect(refreshed.health.status).toBe('degraded')
  })

  it('provides a deterministic test response and rejects unknown connectors', async () => {
    const accepted = await fetch(`${baseUrl}/api/connectors/discord/test`, { method: 'POST' })
    const missing = await fetch(`${baseUrl}/api/connectors/matrix/test`, { method: 'POST' })

    expect(await accepted.json()).toEqual({ ok: true, probeId: 'connector-probe-demo-discord' })
    expect(missing.status).toBe(404)
    expect(await missing.json()).toEqual({ error: 'unknown_connector' })
  })
})
