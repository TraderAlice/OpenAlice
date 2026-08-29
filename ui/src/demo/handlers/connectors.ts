import { http, HttpResponse } from 'msw'
import type { PublicConnectorConfig, TelegramConnectorDesk } from '../../api/connectors'
import { createDemoConnectorSnapshot } from '../fixtures/connectors'

let snapshot = createDemoConnectorSnapshot()
let desk: TelegramConnectorDesk | null = null

export function resetDemoConnectorState(): void {
  snapshot = createDemoConnectorSnapshot()
  desk = null
}

export const connectorsHandlers = [
  http.get('/api/connectors', () => HttpResponse.json(snapshot)),

  http.put('/api/connectors', async ({ request }) => {
    const body = await request.json().catch(() => null)
    if (!isPublicConnectorConfig(body)) {
      return HttpResponse.json({ error: 'invalid_connector_config' }, { status: 400 })
    }
    const knownIds = new Set(snapshot.definitions.map((definition) => definition.id))
    if (Object.keys(body.adapters).some((id) => !knownIds.has(id))) {
      return HttpResponse.json({ error: 'unknown_connector' }, { status: 400 })
    }

    snapshot.config = sanitizePublicConfig(body)
    snapshot.health = snapshot.config.serviceEnabled
      ? {
          enabled: true,
          status: 'degraded',
          reason: 'not_configured',
          lastError: 'Demo connectors are not linked to external accounts.',
        }
      : { enabled: false, status: 'disabled' }
    return HttpResponse.json({ config: snapshot.config })
  }),

  http.get('/api/connectors/:id/desk', () => HttpResponse.json({ desk })),

  http.post('/api/connectors/:id/desk', async ({ request }) => {
    const body = await request.json().catch(() => null)
    const wsId = isRecord(body) && typeof body.wsId === 'string' ? body.wsId.trim() : ''
    if (!wsId) return HttpResponse.json({ error: 'invalid', message: 'wsId is required' }, { status: 400 })
    if (desk) return HttpResponse.json({ error: 'conflict', message: 'Telegram phone desk already exists' }, { status: 409 })
    desk = demoDesk(wsId)
    return HttpResponse.json({ desk }, { status: 201 })
  }),

  http.patch('/api/connectors/:id/desk', async ({ request }) => {
    if (!desk) return HttpResponse.json({ error: 'not_found' }, { status: 404 })
    const body = await request.json().catch(() => null)
    if (!isRecord(body)) return HttpResponse.json({ error: 'invalid' }, { status: 400 })
    if (typeof body.what === 'string') {
      if (!body.what.trim()) {
        return HttpResponse.json({ error: 'invalid', message: 'what must be non-empty markdown' }, { status: 400 })
      }
      desk = { ...desk, issue: { ...desk.issue, what: body.what } }
    }
    if (isRecord(body.when) && body.when.kind === 'every' && typeof body.when.every === 'string') {
      desk = { ...desk, issue: { ...desk.issue, when: { kind: 'every', every: body.when.every } } }
    }
    return HttpResponse.json({ desk })
  }),

  http.delete('/api/connectors/:id/desk', () => {
    const previous = desk
    desk = null
    return HttpResponse.json({
      desk: previous
        ? {
            ...previous,
            issue: { ...previous.issue, status: 'canceled', connectorDesk: undefined, telegramConnector: undefined },
          }
        : null,
    })
  }),

  http.post('/api/connectors/:id/test', ({ params }) => {
    const id = String(params.id)
    if (!snapshot.definitions.some((definition) => definition.id === id)) {
      return HttpResponse.json({ error: 'unknown_connector' }, { status: 404 })
    }
    return HttpResponse.json({ ok: true, probeId: `connector-probe-demo-${id}` })
  }),

  http.post('/api/connectors/:id/reconnect', ({ params }) => {
    const id = String(params.id)
    if (!snapshot.definitions.some((definition) => definition.id === id)) {
      return HttpResponse.json({ error: 'unknown_connector' }, { status: 404 })
    }
    return HttpResponse.json({ ok: true, scope: 'adapter', adapterId: id })
  }),
]

function sanitizePublicConfig(input: PublicConnectorConfig): PublicConnectorConfig {
  const definitions = new Map(snapshot.definitions.map((definition) => [definition.id, definition]))
  const adapters: PublicConnectorConfig['adapters'] = {}

  for (const [id, adapter] of Object.entries(input.adapters)) {
    const definition = definitions.get(id)
    if (!definition) continue
    const secretKeys = new Set(
      definition.fields.filter((field) => field.kind === 'secret').map((field) => field.key),
    )
    const settings = Object.fromEntries(
      Object.entries(adapter.settings).filter(([key]) => !secretKeys.has(key)),
    )
    const configuredSecrets = new Set(adapter.configuredSecrets.filter((key) => secretKeys.has(key)))
    for (const key of secretKeys) {
      const value = adapter.settings[key]
      if (typeof value === 'string' && value.length > 0) configuredSecrets.add(key)
    }
    adapters[id] = {
      enabled: adapter.enabled,
      settings,
      configuredSecrets: [...configuredSecrets],
    }
  }

  for (const definition of snapshot.definitions) {
    adapters[definition.id] ??= { enabled: false, settings: {}, configuredSecrets: [] }
  }
  return { serviceEnabled: input.serviceEnabled, adapters }
}

function isPublicConnectorConfig(value: unknown): value is PublicConnectorConfig {
  if (!isRecord(value) || typeof value.serviceEnabled !== 'boolean' || !isRecord(value.adapters)) return false
  return Object.values(value.adapters).every((adapter) =>
    isRecord(adapter)
    && typeof adapter.enabled === 'boolean'
    && isRecord(adapter.settings)
    && Object.values(adapter.settings).every(isSettingValue)
    && Array.isArray(adapter.configuredSecrets)
    && adapter.configuredSecrets.every((key) => typeof key === 'string'),
  )
}

function isSettingValue(value: unknown): value is string | number | boolean {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function demoDesk(wsId: string): TelegramConnectorDesk {
  return {
    wsId,
    issue: {
      id: 'telegram-phone-desk',
      title: 'Telegram phone desk',
      what: [
        'You are the Telegram phone desk for this Workspace.',
        '',
        "On each scheduled wake, read this Issue's recent comments (the chat with the human).",
        'If the human needs a message, write that message as your reply.',
        'If there is nothing to say, reply with [[no-reply]] and a brief reason.',
      ].join('\n'),
      status: 'todo',
      priority: 'none',
      assignee: '@new-then-resume',
      when: { kind: 'every', every: '4h' },
      connectorDesk: 'telegram',
      telegramConnector: true,
    },
  }
}
