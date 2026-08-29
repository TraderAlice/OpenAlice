import { describe, expect, it } from 'vitest'
import type { ConnectorSettingsSnapshot } from '../api'
import { connectorWarningCount } from './connector-health'

function snapshot(input: {
  serviceEnabled?: boolean
  adapterEnabled?: boolean
  configured?: boolean
  healthStatus?: 'healthy' | 'degraded'
  runtimeStatus?: 'starting' | 'awaiting_link' | 'healthy' | 'degraded' | 'stopped'
  servicePresent?: boolean
} = {}): ConnectorSettingsSnapshot {
  const servicePresent = input.servicePresent ?? true
  return {
    definitions: [{
      id: 'telegram',
      label: 'Telegram',
      description: 'Telegram',
      fields: [{ key: 'botToken', label: 'Token', kind: 'secret', required: true }],
      commands: [],
    }],
    config: {
      serviceEnabled: input.serviceEnabled ?? true,
      adapters: {
        telegram: {
          enabled: input.adapterEnabled ?? true,
          settings: {},
          configuredSecrets: input.configured === false ? [] : ['botToken'],
        },
      },
    },
    health: {
      enabled: input.serviceEnabled ?? true,
      status: input.healthStatus ?? 'degraded',
      ...(servicePresent ? {
        service: {
          status: input.healthStatus ?? 'degraded',
          startedAt: new Date().toISOString(),
          adapters: [{
            id: 'telegram',
            enabled: true,
            status: input.runtimeStatus ?? 'degraded',
          }],
        },
      } : {}),
    },
  }
}

describe('connectorWarningCount', () => {
  it('warns for configured enabled adapters that are degraded or stopped', () => {
    expect(connectorWarningCount(snapshot({ runtimeStatus: 'degraded' }))).toBe(1)
    expect(connectorWarningCount(snapshot({ runtimeStatus: 'stopped' }))).toBe(1)
  })

  it('does not warn for disabled, unconfigured, starting, linked, or healthy adapters', () => {
    expect(connectorWarningCount(snapshot({ serviceEnabled: false }))).toBe(0)
    expect(connectorWarningCount(snapshot({ adapterEnabled: false }))).toBe(0)
    expect(connectorWarningCount(snapshot({ configured: false }))).toBe(0)
    expect(connectorWarningCount(snapshot({ runtimeStatus: 'starting' }))).toBe(0)
    expect(connectorWarningCount(snapshot({ runtimeStatus: 'awaiting_link' }))).toBe(0)
    expect(connectorWarningCount(snapshot({ healthStatus: 'healthy', runtimeStatus: 'healthy' }))).toBe(0)
  })

  it('warns when an adapter remains stuck in starting beyond the grace window', () => {
    const value = snapshot({ runtimeStatus: 'starting' })
    value.health.service!.adapters[0]!.lastAttemptAt = '2026-08-23T00:00:00.000Z'

    expect(connectorWarningCount(value, Date.parse('2026-08-23T00:00:46.000Z'))).toBe(1)
    expect(connectorWarningCount(value, Date.parse('2026-08-23T00:00:30.000Z'))).toBe(0)
  })

  it('warns when the configured service is unreachable and has no adapter body', () => {
    expect(connectorWarningCount(snapshot({ servicePresent: false }))).toBe(1)
  })
})
