import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { z } from 'zod'
import {
  BUILTIN_CONNECTOR_DEFINITIONS,
  connectorConfigSchema,
  type ConnectorAdapterConfig,
  type ConnectorConfig,
  type PublicConnectorConfig,
} from '@traderalice/connector-protocol'
import { dataPath } from './paths.js'
import { isSealedEnvelope, seal, unseal } from './sealing.js'

const CONNECTORS_FILE = dataPath('config', 'connectors.json')
const SERVICE_FILE = dataPath('config', 'connector-service.json')
const RESTART_FILE = dataPath('control', 'restart-connector.flag')
const serviceConfigSchema = z.object({ enabled: z.boolean().default(false) })

export async function readConnectorConfig(): Promise<ConnectorConfig> {
  try {
    const raw = JSON.parse(await readFile(CONNECTORS_FILE, 'utf8')) as unknown
    const value = isSealedEnvelope(raw) ? await unseal(raw) : raw
    return connectorConfigSchema.parse(value)
  } catch (error) {
    if (isENOENT(error)) return { version: 1, adapters: {} }
    throw error
  }
}

export async function writeConnectorConfig(config: ConnectorConfig): Promise<void> {
  const parsed = connectorConfigSchema.parse(config)
  await writePrivateJson(CONNECTORS_FILE, await seal(parsed))
}

export async function readConnectorServiceEnabled(): Promise<boolean> {
  try {
    return serviceConfigSchema.parse(JSON.parse(await readFile(SERVICE_FILE, 'utf8'))).enabled
  } catch (error) {
    if (isENOENT(error)) return false
    throw error
  }
}

export async function writeConnectorServiceEnabled(enabled: boolean): Promise<void> {
  await writePrivateJson(SERVICE_FILE, serviceConfigSchema.parse({ enabled }))
}

export async function triggerConnectorRestart(): Promise<void> {
  await mkdir(dirname(RESTART_FILE), { recursive: true })
  await writeFile(RESTART_FILE, `${new Date().toISOString()}\n`)
}

export async function updateConnectorAdapterSettings(
  id: string,
  patch: Record<string, string | number | boolean>,
): Promise<void> {
  const config = await readConnectorConfig()
  const current = config.adapters[id] ?? { enabled: false, settings: {} }
  config.adapters[id] = { ...current, settings: { ...current.settings, ...patch } }
  await writeConnectorConfig(config)
}

export async function readPublicConnectorConfig(): Promise<PublicConnectorConfig> {
  const [serviceEnabled, config] = await Promise.all([
    readConnectorServiceEnabled(),
    readConnectorConfig(),
  ])
  const definitions = new Map(BUILTIN_CONNECTOR_DEFINITIONS.map((definition) => [definition.id, definition]))
  const ids = new Set([...definitions.keys(), ...Object.keys(config.adapters)])
  const adapters: PublicConnectorConfig['adapters'] = {}
  for (const id of ids) {
    const stored = config.adapters[id] ?? { enabled: false, settings: {} }
    const secretKeys = new Set(
      definitions.get(id)?.fields.filter((field) => field.kind === 'secret').map((field) => field.key) ?? [],
    )
    adapters[id] = {
      enabled: stored.enabled,
      settings: Object.fromEntries(Object.entries(stored.settings).filter(([key]) => !secretKeys.has(key))),
      configuredSecrets: [...secretKeys].filter((key) => {
        const value = stored.settings[key]
        return typeof value === 'string' && value.length > 0
      }),
    }
  }
  return { serviceEnabled, adapters }
}

export async function writePublicConnectorConfig(input: PublicConnectorConfig): Promise<PublicConnectorConfig> {
  const existing = await readConnectorConfig()
  const definitions = new Map(BUILTIN_CONNECTOR_DEFINITIONS.map((definition) => [definition.id, definition]))
  const next: ConnectorConfig = { version: 1, adapters: { ...existing.adapters } }

  for (const [id, incoming] of Object.entries(input.adapters)) {
    const definition = definitions.get(id)
    if (!definition) throw new Error(`Unknown connector: ${id}`)
    const current = existing.adapters[id] ?? { enabled: false, settings: {} }
    const allowedFields = new Map(definition.fields.map((field) => [field.key, field]))
    const settings = { ...current.settings }
    for (const [key, value] of Object.entries(incoming.settings)) {
      const field = allowedFields.get(key)
      if (!field) continue
      if (field.kind === 'secret' && value === '') {
        if (!incoming.configuredSecrets.includes(key)) delete settings[key]
        continue
      }
      settings[key] = value
    }
    next.adapters[id] = { enabled: incoming.enabled, settings } satisfies ConnectorAdapterConfig
  }

  await Promise.all([
    writeConnectorConfig(next),
    writeConnectorServiceEnabled(input.serviceEnabled),
  ])
  await triggerConnectorRestart()
  return readPublicConnectorConfig()
}

async function writePrivateJson(path: string, value: unknown): Promise<void> {
  const temp = `${path}.tmp-${process.pid}`
  await mkdir(dirname(path), { recursive: true })
  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
  await chmod(temp, 0o600).catch(() => undefined)
  await rename(temp, path)
  await chmod(path, 0o600).catch(() => undefined)
}

function isENOENT(error: unknown): boolean {
  return error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT'
}
