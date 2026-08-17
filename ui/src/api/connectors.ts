import { fetchJson, headers } from './client'
import type { IssueDetailIssue } from './issues'
import type { ScheduleWhen } from './schedule'

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
    group?: 'credentials' | 'preferences'
    defaultValue?: string | number | boolean
  }>
  commands: Array<{ name: string; description: string }>
  capabilities?: Array<'inbox' | 'settings'>
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

export interface TelegramConnectorDesk {
  wsId: string
  issue: IssueDetailIssue
}

export interface TelegramConnectorDeskSnapshot {
  desk: TelegramConnectorDesk | null
}

export const TELEGRAM_DESK_CADENCES = ['1h', '2h', '4h', '8h', '12h', '24h'] as const
export type TelegramDeskCadence = (typeof TELEGRAM_DESK_CADENCES)[number]

export const connectorsApi = {
  async load(): Promise<ConnectorSettingsSnapshot> {
    return decodeConnectorSettingsSnapshot(await fetchJson<unknown>('/api/connectors'))
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
  desk: {
    async load(): Promise<TelegramConnectorDeskSnapshot> {
      return decodeTelegramConnectorDeskSnapshot(await fetchJson<unknown>('/api/connectors/telegram/desk'))
    },
    async create(wsId: string): Promise<TelegramConnectorDesk> {
      const body = await fetchJson<unknown>('/api/connectors/telegram/desk', {
        method: 'POST',
        headers,
        body: JSON.stringify({ wsId }),
      })
      return decodeTelegramConnectorDeskResponse(body)
    },
    async update(patch: { what?: string; when?: Extract<ScheduleWhen, { kind: 'every' }> }): Promise<TelegramConnectorDesk> {
      const body = await fetchJson<unknown>('/api/connectors/telegram/desk', {
        method: 'PATCH',
        headers,
        body: JSON.stringify(patch),
      })
      return decodeTelegramConnectorDeskResponse(body)
    },
    async disable(): Promise<TelegramConnectorDesk | null> {
      const body = await fetchJson<unknown>('/api/connectors/telegram/desk', { method: 'DELETE' })
      return decodeTelegramConnectorDeskSnapshot(body).desk
    },
  },
}

export function decodeConnectorSettingsSnapshot(value: unknown): ConnectorSettingsSnapshot {
  if (!isRecord(value)
    || !Array.isArray(value.definitions)
    || !value.definitions.every(isConnectorDefinition)
    || !isPublicConnectorConfig(value.config)
    || !isConnectorHealth(value.health)) {
    throw new Error('Invalid Connector settings response.')
  }
  return value as unknown as ConnectorSettingsSnapshot
}

function isConnectorDefinition(value: unknown): boolean {
  return isRecord(value)
    && typeof value.id === 'string'
    && typeof value.label === 'string'
    && typeof value.description === 'string'
    && Array.isArray(value.fields)
    && value.fields.every((field) => isRecord(field)
      && typeof field.key === 'string'
      && typeof field.label === 'string'
      && isOneOf(field.kind, ['text', 'secret', 'number', 'boolean'])
      && typeof field.required === 'boolean'
      && isOptionalString(field.description)
      && isOptionalString(field.placeholder)
      && isOptionalString(field.learnedBy)
      && (field.group === undefined || field.group === 'credentials' || field.group === 'preferences')
      && (field.defaultValue === undefined
        || typeof field.defaultValue === 'string'
        || typeof field.defaultValue === 'number'
        || typeof field.defaultValue === 'boolean'))
    && Array.isArray(value.commands)
    && value.commands.every((command) => isRecord(command)
      && typeof command.name === 'string'
      && typeof command.description === 'string')
    && (value.capabilities === undefined
      || (Array.isArray(value.capabilities)
        && value.capabilities.every((capability) => capability === 'inbox' || capability === 'settings')))
}

function isPublicConnectorConfig(value: unknown): boolean {
  return isRecord(value)
    && typeof value.serviceEnabled === 'boolean'
    && isRecord(value.adapters)
    && Object.values(value.adapters).every((adapter) => isRecord(adapter)
      && typeof adapter.enabled === 'boolean'
      && isRecord(adapter.settings)
      && Object.values(adapter.settings).every(isSettingValue)
      && Array.isArray(adapter.configuredSecrets)
      && adapter.configuredSecrets.every((key) => typeof key === 'string'))
}

function isConnectorHealth(value: unknown): boolean {
  if (!isRecord(value)
    || typeof value.enabled !== 'boolean'
    || !isOneOf(value.status, ['disabled', 'healthy', 'degraded'])
    || !isOptionalString(value.checkedAt)
    || !isOptionalNumber(value.latencyMs)
    || !isOptionalString(value.reason)
    || !isOptionalString(value.lastAttemptAt)
    || !isOptionalString(value.lastSuccessAt)
    || !isOptionalString(value.lastError)) return false
  if (value.service === undefined) return true
  return isRecord(value.service)
    && isOneOf(value.service.status, ['healthy', 'degraded'])
    && typeof value.service.startedAt === 'string'
    && Array.isArray(value.service.adapters)
    && value.service.adapters.every((adapter) => isRecord(adapter)
      && typeof adapter.id === 'string'
      && typeof adapter.enabled === 'boolean'
      && isOneOf(adapter.status, ['disabled', 'starting', 'awaiting_link', 'healthy', 'degraded', 'stopped'])
      && isOptionalString(adapter.detail)
      && isOptionalString(adapter.owner)
      && isOptionalString(adapter.lastAttemptAt)
      && isOptionalString(adapter.lastSuccessAt)
      && isOptionalString(adapter.lastError))
}

function isSettingValue(value: unknown): value is string | number | boolean {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isOptionalString(value: unknown): boolean {
  return value === undefined || typeof value === 'string'
}

function isOptionalNumber(value: unknown): boolean {
  return value === undefined || typeof value === 'number'
}

function isOneOf(value: unknown, options: readonly string[]): value is string {
  return typeof value === 'string' && options.includes(value)
}

function decodeTelegramConnectorDeskSnapshot(value: unknown): TelegramConnectorDeskSnapshot {
  if (!isRecord(value) || !('desk' in value)) {
    throw new Error('Invalid Telegram phone-desk response.')
  }
  if (value.desk === null) return { desk: null }
  return { desk: decodeTelegramConnectorDesk(value.desk) }
}

function decodeTelegramConnectorDeskResponse(value: unknown): TelegramConnectorDesk {
  if (!isRecord(value)) throw new Error('Invalid Telegram phone-desk response.')
  return decodeTelegramConnectorDesk(value.desk)
}

function decodeTelegramConnectorDesk(value: unknown): TelegramConnectorDesk {
  if (!isRecord(value) || typeof value.wsId !== 'string' || !isRecord(value.issue)) {
    throw new Error('Invalid Telegram phone-desk response.')
  }
  const issue = value.issue
  if (typeof issue.id !== 'string' || typeof issue.title !== 'string' || typeof issue.what !== 'string') {
    throw new Error('Invalid Telegram phone-desk response.')
  }
  return {
    wsId: value.wsId,
    issue: issue as unknown as IssueDetailIssue,
  }
}
