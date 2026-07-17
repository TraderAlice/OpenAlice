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

export const connectorHandlers = [
  http.get('/api/connectors', () => HttpResponse.json(snapshot)),
  http.put('/api/connectors', async ({ request }) => {
    const config = await request.json() as PublicConnectorConfig
    snapshot.config = config
    return HttpResponse.json({ config })
  }),
  http.post('/api/connectors/:id/test', ({ params }) => HttpResponse.json({ ok: true, probeId: `demo-${String(params.id)}-probe` })),
]
