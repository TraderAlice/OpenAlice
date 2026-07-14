/**
 * Retire the old catch-all connector config shape.
 *
 * - Web listener ownership moves to ports.json.
 * - Removed MCP-Ask config is intentionally discarded.
 * - Telegram notification credentials move into the generic Connector
 *   Service adapter map and are sealed immediately.
 * - Connector process enablement is kept in a non-secret Guardian-owned file.
 */
import { chmod, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { ConnectorConfig } from '@traderalice/connector-protocol'
import type { Migration } from '../types.js'
import { isSealedEnvelope, seal } from '@/core/sealing.js'

interface LegacyConnectors {
  web?: { port?: unknown }
  telegram?: {
    enabled?: unknown
    botToken?: unknown
    chatIds?: unknown
  }
}

export interface ConnectorMigrationResult {
  ports: { web: number }
  config: ConnectorConfig
  serviceEnabled: boolean
}

export function transformLegacyConnectors(raw: LegacyConnectors, existingPorts?: unknown): ConnectorMigrationResult {
  const oldPort = raw.web?.port
  const existingWebPort = (
    existingPorts && typeof existingPorts === 'object' &&
    'web' in existingPorts &&
    typeof (existingPorts as { web?: unknown }).web === 'number'
  ) ? (existingPorts as { web: number }).web : undefined
  const webPort = existingWebPort ?? (
    typeof oldPort === 'number' && Number.isInteger(oldPort) && oldPort > 0 && oldPort <= 65535
      ? oldPort
      : 3002
  )

  const telegram = raw.telegram
  const botToken = typeof telegram?.botToken === 'string' && telegram.botToken.trim()
    ? telegram.botToken.trim()
    : undefined
  const firstChatId = Array.isArray(telegram?.chatIds)
    ? telegram.chatIds.find((value): value is number => typeof value === 'number' && Number.isFinite(value))
    : undefined
  const enabled = telegram?.enabled === true && Boolean(botToken)
  const settings: Record<string, string> = {}
  if (botToken) settings.botToken = botToken
  if (firstChatId !== undefined) {
    settings.ownerUserId = String(firstChatId)
    settings.chatId = String(firstChatId)
  }

  return {
    ports: { web: webPort },
    config: {
      version: 1,
      adapters: Object.keys(settings).length > 0 || telegram?.enabled === true
        ? { telegram: { enabled, settings } }
        : {},
    },
    serviceEnabled: enabled,
  }
}

export const migration: Migration = {
  id: '0022_connector_service_config',
  appVersion: '0.81.0-beta',
  introducedAt: '2026-07-13',
  affects: ['connectors.json', 'connector-service.json', 'ports.json'],
  summary: 'Move external notifications into sealed Connector Service config and retire legacy Web/MCP-Ask connector meanings.',
  up: async (ctx) => {
    const raw = await ctx.readJson<unknown>('connectors.json')
    if (raw === undefined || isSealedEnvelope(raw)) return
    if (!raw || typeof raw !== 'object') return

    const result = transformLegacyConnectors(
      raw as LegacyConnectors,
      await ctx.readJson('ports.json'),
    )
    await ctx.writeJson('ports.json', result.ports)
    await ctx.writeJson('connector-service.json', { enabled: result.serviceEnabled })

    const path = resolve(ctx.configDir(), 'connectors.json')
    await writeFile(path, `${JSON.stringify(await seal(result.config), null, 2)}\n`, { mode: 0o600 })
    await chmod(path, 0o600).catch(() => undefined)
  },
}
