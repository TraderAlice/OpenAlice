import { fetchJson, headers } from './client'

export type ConnectorFieldKind = 'text' | 'secret' | 'number' | 'boolean'

export interface ConnectorDefinition {
  id: string
  label: string
  description: string
  fields: Array<{
    key: string
    label: string
    description?: string
    kind: ConnectorFieldKind
    required: boolean
    placeholder?: string
    learnedBy?: string
  }>
  commands: Array<{ name: string; description: string }>
}

export interface PublicConnectorConfig {
  serviceEnabled: boolean
  adapters: Record<string, {
    enabled: boolean
    settings: Record<string, string | number | boolean>
    configuredSecrets: string[]
  }>
}

export interface ConnectorHealth {
  enabled: boolean
  status: 'disabled' | 'healthy' | 'degraded'
  checkedAt?: string
  latencyMs?: number
  reason?: 'not_configured' | 'http_error' | 'invalid_response' | 'timeout' | 'unreachable'
  lastAttemptAt?: string
  lastSuccessAt?: string
  lastError?: string
  service?: {
    status: 'healthy' | 'degraded'
    startedAt: string
    adapters: Array<{
      id: string
      enabled: boolean
      status: 'disabled' | 'starting' | 'awaiting_link' | 'healthy' | 'degraded' | 'stopped'
      detail?: string
      owner?: string
      lastAttemptAt?: string
      lastSuccessAt?: string
      lastError?: string
    }>
  }
}

export interface ConnectorSettingsSnapshot {
  definitions: ConnectorDefinition[]
  config: PublicConnectorConfig
  health: ConnectorHealth
}

export const connectorsApi = {
  load(): Promise<ConnectorSettingsSnapshot> {
    return fetchJson('/api/connectors')
  },
  save(config: PublicConnectorConfig): Promise<{ config: PublicConnectorConfig }> {
    return fetchJson('/api/connectors', {
      method: 'PUT',
      headers,
      body: JSON.stringify(config),
    })
  },
  test(id: string): Promise<{ ok: boolean; probeId: string }> {
    return fetchJson(`/api/connectors/${encodeURIComponent(id)}/test`, { method: 'POST' })
  },
}
