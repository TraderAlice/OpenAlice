import { chmod, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { z } from 'zod'
import {
  BUILTIN_CONNECTOR_DEFINITIONS,
  connectorAdapterMutationSchema,
  connectorConfigSchema,
  type ConnectorAdapterMutation,
  type ConnectorAdapterConfig,
  type ConnectorConfig,
  type PublicConnectorAdapterConfig,
  type PublicConnectorAdapterMutationResult,
  type PublicConnectorConfig,
} from '@traderalice/connector-protocol'
import { dataPath } from './paths.js'
import { isSealedEnvelope, seal, unseal } from './sealing.js'

const CONNECTORS_FILE = dataPath('config', 'connectors.json')
const SERVICE_FILE = dataPath('config', 'connector-service.json')
const RESTART_FILE = dataPath('control', 'restart-connector.flag')
const MUTATION_LOCK = dataPath('state', 'connector-config-mutation.lock')
const serviceConfigSchema = z.object({ enabled: z.boolean().default(false) })
/** Bot tokens are long opaque strings. A 5-character draft must not replace a sealed secret. */
const MIN_CONNECTOR_SECRET_LENGTH = 20
const MUTATION_LOCK_TIMEOUT_MS = 5_000
const MUTATION_LOCK_STALE_MS = 30_000

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
  await mutatePublicConnectorAdapter(id, { set: patch, unset: [], setSecrets: {}, removeSecrets: [] })
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
    adapters[id] = publicAdapterConfig(stored, definitions.get(id))
  }
  return { serviceEnabled, adapters }
}

/** Mutate exactly one adapter against the latest sealed file. Alice UI writes
 * and adapter-owned `/link` or `/settings` writes share this cross-process
 * lease, so atomic rename cannot hide a lost read-modify-write race. */
export async function mutatePublicConnectorAdapter(
  id: string,
  input: ConnectorAdapterMutation,
): Promise<PublicConnectorAdapterMutationResult> {
  return withConnectorConfigMutation(async () => {
    const mutation = connectorAdapterMutationSchema.parse(input)
    const definition = BUILTIN_CONNECTOR_DEFINITIONS.find((candidate) => candidate.id === id)
    if (!definition) throw new Error(`Unknown connector: ${id}`)
    const fields = new Map(definition.fields.map((field) => [field.key, field]))
    const config = await readConnectorConfig()
    const current = config.adapters[id] ?? { enabled: false, settings: {} }
    const next: ConnectorAdapterConfig = {
      enabled: mutation.enabled ?? current.enabled,
      settings: { ...current.settings },
    }

    for (const [key, value] of Object.entries(mutation.set)) {
      const field = fields.get(key)
      if (!field) throw new Error(`Unknown connector setting: ${id}.${key}`)
      if (field.kind === 'secret') throw new Error(`Connector secret ${key} requires an explicit secret action.`)
      next.settings[key] = value
    }
    for (const key of mutation.unset) {
      const field = fields.get(key)
      if (!field) throw new Error(`Unknown connector setting: ${id}.${key}`)
      if (field.kind === 'secret') throw new Error(`Connector secret ${key} requires an explicit secret action.`)
      delete next.settings[key]
    }
    for (const [key, value] of Object.entries(mutation.setSecrets)) {
      const field = fields.get(key)
      if (!field || field.kind !== 'secret') throw new Error(`Unknown connector secret: ${id}.${key}`)
      applyConnectorSecret(next.settings, key, value, false)
    }
    for (const key of mutation.removeSecrets) {
      const field = fields.get(key)
      if (!field || field.kind !== 'secret') throw new Error(`Unknown connector secret: ${id}.${key}`)
      delete next.settings[key]
    }

    const adapterChanged = JSON.stringify(current) !== JSON.stringify(next)
    if (adapterChanged) {
      config.adapters[id] = next
      await writeConnectorConfig(config)
    }

    const serviceEnabled = await readConnectorServiceEnabled()
    const shouldEnableService = mutation.enabled === true && !serviceEnabled
    if (shouldEnableService) await writeConnectorServiceEnabled(true)
    return {
      serviceEnabled: shouldEnableService ? true : serviceEnabled,
      serviceChanged: shouldEnableService,
      adapterChanged,
      adapter: publicAdapterConfig(next, definition),
    }
  })
}

export async function mutateConnectorServiceEnabled(enabled: boolean): Promise<{
  serviceEnabled: boolean
  serviceChanged: boolean
}> {
  return withConnectorConfigMutation(async () => {
    const current = await readConnectorServiceEnabled()
    if (current !== enabled) await writeConnectorServiceEnabled(enabled)
    return { serviceEnabled: enabled, serviceChanged: current !== enabled }
  })
}

function applyConnectorSecret(
  settings: Record<string, string | number | boolean>,
  key: string,
  value: string | number | boolean,
  configured: boolean,
): void {
  if (value === '') {
    if (!configured) delete settings[key]
    return
  }
  if (typeof value !== 'string') {
    throw new Error(`Connector secret ${key} must be a string.`)
  }
  const next = value.trim()
  if (!isPlausibleConnectorSecret(next)) {
    throw new Error(`Connector secret ${key} is too short or malformed to store.`)
  }
  settings[key] = next
}

function publicAdapterConfig(
  stored: ConnectorAdapterConfig,
  definition: (typeof BUILTIN_CONNECTOR_DEFINITIONS)[number] | undefined,
): PublicConnectorAdapterConfig {
  const secretKeys = new Set(
    definition?.fields.filter((field) => field.kind === 'secret').map((field) => field.key) ?? [],
  )
  return {
    enabled: stored.enabled,
    settings: Object.fromEntries(Object.entries(stored.settings).filter(([key]) => !secretKeys.has(key))),
    configuredSecrets: [...secretKeys].filter((key) => {
      const value = stored.settings[key]
      return typeof value === 'string' && value.length > 0
    }),
  }
}

async function withConnectorConfigMutation<T>(mutate: () => Promise<T>): Promise<T> {
  const startedAt = Date.now()
  await mkdir(dirname(MUTATION_LOCK), { recursive: true })
  while (true) {
    try {
      await mkdir(MUTATION_LOCK)
      break
    } catch (error) {
      if (!isEEXIST(error)) throw error
      const ageMs = await stat(MUTATION_LOCK)
        .then((value) => Date.now() - value.mtimeMs)
        .catch(() => 0)
      if (ageMs >= MUTATION_LOCK_STALE_MS) {
        const stalePath = `${MUTATION_LOCK}.stale-${process.pid}-${Date.now()}`
        const claimed = await rename(MUTATION_LOCK, stalePath).then(() => true).catch(() => false)
        if (claimed) await rm(stalePath, { recursive: true, force: true })
        continue
      }
      if (Date.now() - startedAt >= MUTATION_LOCK_TIMEOUT_MS) {
        throw new Error('Connector configuration is busy. Try again.')
      }
      await sleep(25)
    }
  }
  try {
    return await mutate()
  } finally {
    await rm(MUTATION_LOCK, { recursive: true, force: true })
  }
}

export function isPlausibleConnectorSecret(value: string): boolean {
  return value.length >= MIN_CONNECTOR_SECRET_LENGTH && !/\s/.test(value)
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

function isEEXIST(error: unknown): boolean {
  return error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'EEXIST'
}
