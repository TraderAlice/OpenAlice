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
    expect(body.definitions.map((definition: { id: string }) => definition.id)).toEqual(['discord', 'telegram', 'slack', 'feishu'])
    expect(body.config).toEqual({
      serviceEnabled: false,
      adapters: {
        discord: { enabled: false, settings: {}, configuredSecrets: [] },
        telegram: { enabled: false, settings: {}, configuredSecrets: [] },
        slack: { enabled: false, settings: {}, configuredSecrets: [] },
        feishu: { enabled: false, settings: {}, configuredSecrets: [] },
      },
    })
    expect(body.health).toEqual({ enabled: false, status: 'disabled' })
  })

  it('applies one adapter mutation without returning entered secrets', async () => {
    const response = await fetch(`${baseUrl}/api/connectors/discord`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        enabled: true,
        set: { applicationId: 'demo-app' },
        setSecrets: { botToken: 'demo-secret' },
      }),
    })
    const body = await response.json()

    expect(response.status).toBe(202)
    expect(body.adapter).toEqual({
      enabled: true,
      settings: { applicationId: 'demo-app' },
      configuredSecrets: ['botToken'],
    })
    expect(JSON.stringify(body)).not.toContain('demo-secret')

    const refreshed = await fetch(`${baseUrl}/api/connectors`).then((result) => result.json())
    expect(refreshed.config.serviceEnabled).toBe(true)
    expect(refreshed.config.adapters.discord).toEqual(body.adapter)
    expect(refreshed.health.status).toBe('degraded')
  })

  it('binds, updates, and disables demo Chat on Telegram', async () => {
    const missing = await fetch(`${baseUrl}/api/connectors/telegram/desk`)
    expect(await missing.json()).toEqual({ desk: null })

    const created = await fetch(`${baseUrl}/api/connectors/telegram/desk`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wsId: 'ws-demo' }),
    })
    const createdBody = await created.json()
    expect(created.status).toBe(201)
    expect(createdBody.desk.wsId).toBe('ws-demo')
    expect(createdBody.desk.issue.telegramConnector).toBe(true)
    expect(createdBody.desk.issue.title).toBe('Chat on Telegram')
    expect(createdBody.desk.issue.what).not.toMatch(/phone desk/i)

    const conflict = await fetch(`${baseUrl}/api/connectors/telegram/desk`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wsId: 'ws-other' }),
    })
    expect(conflict.status).toBe(409)

    const patched = await fetch(`${baseUrl}/api/connectors/telegram/desk`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ when: { kind: 'every', every: '1h' } }),
    })
    expect((await patched.json()).desk.issue.when).toEqual({ kind: 'every', every: '1h' })

    const disabled = await fetch(`${baseUrl}/api/connectors/telegram/desk`, { method: 'DELETE' })
    expect((await disabled.json()).desk.issue.status).toBe('canceled')
    expect((await fetch(`${baseUrl}/api/connectors/telegram/desk`).then((result) => result.json())).desk).toBeNull()
  })

  it('provides a deterministic test response and rejects unknown connectors', async () => {
    const accepted = await fetch(`${baseUrl}/api/connectors/discord/test`, { method: 'POST' })
    const missing = await fetch(`${baseUrl}/api/connectors/matrix/test`, { method: 'POST' })

    expect(await accepted.json()).toEqual({ ok: true, probeId: 'connector-probe-demo-discord' })
    expect(missing.status).toBe(404)
    expect(await missing.json()).toEqual({ error: 'unknown_connector' })
  })
})
