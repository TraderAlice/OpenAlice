import { http, HttpResponse } from 'msw'
import type { ConnectorSettingsSnapshot, PublicConnectorConfig } from '../../api/connectors'

const snapshot: ConnectorSettingsSnapshot = {
  definitions: [{
    id: 'mattermost',
    label: 'Mattermost',
    description: 'Push durable Inbox notifications to a private Mattermost bot.',
    fields: [{
      key: 'serverUrl', label: 'Server URL', kind: 'text', required: true,
      placeholder: 'https://chat.example.com',
    }],
    commands: [{ name: '/alice-link', description: 'Link the current Mattermost owner.' }],
  }],
  config: {
    serviceEnabled: true,
    adapters: {
      mattermost: {
        enabled: true,
        settings: { serverUrl: 'https://chat.demo.invalid' },
        configuredSecrets: ['botToken'],
      },
    },
  },
  health: {
    enabled: true,
    status: 'healthy',
    checkedAt: '2026-07-16T00:00:00.000Z',
    latencyMs: 18,
    service: {
      status: 'healthy',
      startedAt: '2026-07-16T00:00:00.000Z',
      adapters: [{ id: 'mattermost', enabled: true, status: 'healthy', owner: '@demo-owner' }],
    },
  },
}

const auditFixture = (request: Request): string | null => request.headers.get('x-openalice-theme-audit-fixture')

function snapshotFor(request: Request): ConnectorSettingsSnapshot {
  const fixture = auditFixture(request)
  if (!fixture?.startsWith('connector-')) return snapshot
  const result = structuredClone(snapshot)
  const adapter = result.health.service?.adapters[0]
  if (fixture === 'connector-starting' && adapter) { adapter.status = 'starting'; delete adapter.owner }
  if (fixture === 'connector-awaiting' || fixture === 'connector-awaiting-status') {
    result.definitions[0]!.fields.push({ key: 'owner', label: 'Owner', kind: 'text', required: true, learnedBy: '/alice-link' })
    if (fixture === 'connector-awaiting-status') result.config.adapters['mattermost']!.settings.owner = '@pending-link'
    if (adapter) { adapter.status = 'awaiting_link'; delete adapter.owner }
  }
  if (fixture === 'connector-ready') {
    result.definitions[0]!.fields.push({ key: 'owner', label: 'Owner', kind: 'text', required: true, learnedBy: '/alice-link' })
    result.config.serviceEnabled = false
    if (adapter) { adapter.status = 'stopped'; delete adapter.owner }
  }
  if (fixture === 'connector-needs-setup') {
    result.config.adapters['mattermost']!.settings = {}
    result.config.adapters['mattermost']!.configuredSecrets = []
    if (adapter) { adapter.status = 'starting'; delete adapter.owner }
  }
  return result
}

export const connectorHandlers = [
  http.get('/api/connectors', ({ request }) => HttpResponse.json(snapshotFor(request))),
  http.put('/api/connectors', async ({ request }) => {
    const config = await request.json() as PublicConnectorConfig
    snapshot.config = config
    return HttpResponse.json({ config })
  }),
  http.post('/api/connectors/:id/test', ({ params }) => HttpResponse.json({ ok: true, probeId: `demo-${String(params.id)}-probe` })),
]
