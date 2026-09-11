import { http, HttpResponse } from 'msw'
import type { TelegramConnectorDesk } from '../../api/connectors'
import { createDemoConnectorSnapshot } from '../fixtures/connectors'

let snapshot = createDemoConnectorSnapshot()
let desk: TelegramConnectorDesk | null = null

export function resetDemoConnectorState(): void {
  snapshot = createDemoConnectorSnapshot()
  desk = null
}

export const connectorsHandlers = [
  http.get('/api/connectors', () => HttpResponse.json(snapshot)),

  http.patch('/api/connectors/service', async ({ request }) => {
    const body = await request.json().catch(() => null)
    if (!isRecord(body) || typeof body.enabled !== 'boolean') {
      return HttpResponse.json({ error: 'invalid_connector_service_mutation' }, { status: 400 })
    }
    const changed = snapshot.config.serviceEnabled !== body.enabled
    snapshot.config = { ...snapshot.config, serviceEnabled: body.enabled }
    syncDemoHealth()
    return HttpResponse.json({ serviceEnabled: body.enabled, serviceChanged: changed })
  }),

  http.patch('/api/connectors/:id', async ({ params, request }) => {
    const id = String(params.id)
    const definition = snapshot.definitions.find((item) => item.id === id)
    const body = await request.json().catch(() => null)
    if (!definition || !isRecord(body)) {
      return HttpResponse.json({ error: 'invalid_connector_adapter_mutation' }, { status: 400 })
    }
    const current = snapshot.config.adapters[id] ?? { enabled: false, settings: {}, configuredSecrets: [] }
    const settings = { ...current.settings }
    const configuredSecrets = new Set(current.configuredSecrets)
    if (isRecord(body.set)) {
      for (const [key, value] of Object.entries(body.set)) if (isSettingValue(value)) settings[key] = value
    }
    if (Array.isArray(body.unset)) for (const key of body.unset) if (typeof key === 'string') delete settings[key]
    if (isRecord(body.setSecrets)) {
      for (const [key, value] of Object.entries(body.setSecrets)) {
        if (typeof value === 'string' && value.length > 0) configuredSecrets.add(key)
      }
    }
    if (Array.isArray(body.removeSecrets)) {
      for (const key of body.removeSecrets) if (typeof key === 'string') configuredSecrets.delete(key)
    }
    const adapter = {
      enabled: typeof body.enabled === 'boolean' ? body.enabled : current.enabled,
      settings,
      configuredSecrets: [...configuredSecrets],
    }
    const serviceChanged = adapter.enabled && !snapshot.config.serviceEnabled
    snapshot.config = {
      serviceEnabled: serviceChanged ? true : snapshot.config.serviceEnabled,
      adapters: { ...snapshot.config.adapters, [id]: adapter },
    }
    syncDemoHealth()
    return HttpResponse.json({
      serviceEnabled: snapshot.config.serviceEnabled,
      serviceChanged,
      adapterChanged: true,
      adapter,
      runtime: { scope: serviceChanged ? 'service' : 'adapter', status: serviceChanged ? 'starting' : 'reconciled' },
    }, { status: serviceChanged ? 202 : 200 })
  }),

  http.get('/api/connectors/:id/desk', () => HttpResponse.json({ desk })),

  http.post('/api/connectors/:id/desk', async ({ request }) => {
    const body = await request.json().catch(() => null)
    const wsId = isRecord(body) && typeof body.wsId === 'string' ? body.wsId.trim() : ''
    if (!wsId) return HttpResponse.json({ error: 'invalid', message: 'wsId is required' }, { status: 400 })
    if (desk) return HttpResponse.json({ error: 'conflict', message: 'Chat on Telegram already exists' }, { status: 409 })
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

function isSettingValue(value: unknown): value is string | number | boolean {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
}

function syncDemoHealth(): void {
  snapshot.health = snapshot.config.serviceEnabled
    ? {
        enabled: true,
        status: 'degraded',
        reason: 'not_configured',
        lastError: 'Demo connectors are not linked to external accounts.',
      }
    : { enabled: false, status: 'disabled' }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function demoDesk(wsId: string): TelegramConnectorDesk {
  return {
    wsId,
    issue: {
      id: 'telegram-phone-desk',
      title: 'Chat on Telegram',
      what: [
        'You are the chat connected to the owner through Telegram.',
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
