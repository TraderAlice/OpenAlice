import { http, HttpResponse } from 'msw'
import type { PublicConnectorConfig } from '../../api/connectors'
import { createDemoConnectorSnapshot } from '../fixtures/connectors'

let snapshot = createDemoConnectorSnapshot()

export function resetDemoConnectorState(): void {
  snapshot = createDemoConnectorSnapshot()
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

  http.post('/api/connectors/:id/test', ({ params }) => {
    const id = String(params.id)
    if (!snapshot.definitions.some((definition) => definition.id === id)) {
      return HttpResponse.json({ error: 'unknown_connector' }, { status: 404 })
    }
    return HttpResponse.json({ ok: true, probeId: `connector-probe-demo-${id}` })
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
