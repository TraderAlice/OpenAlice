import { randomUUID } from 'node:crypto'
import {
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises'
import { join } from 'node:path'

import {
  resolveLaunchContext,
  resolveSupervisorRootPath,
  type InstanceLaunchConfig,
  type LaunchConfigValues,
  type MachineSupervisorConfig,
  type ResolvedLaunchContext,
  type ResolveSupervisorRootOptions,
  type TuiLaunchFlags,
} from './launch-context.ts'

const CONFIG_SCHEMA_VERSION = 1
const INSTANCE_NAME_PATTERN = /^[a-z][a-z0-9_-]{0,31}$/
const CONFIG_FILE_NAME = 'config.json'
const CONFIG_KEYS = new Set([
  'schemaVersion',
  'defaultInstance',
  'defaults',
  'instances',
])
const LAUNCH_VALUE_KEYS = new Set([
  'name',
  'home',
  'port',
  'appDir',
  'updateChecks',
])

export interface SupervisorConfigDocument {
  schemaVersion: 1
  defaultInstance?: string
  defaults?: LaunchConfigValues
  instances?: Record<string, InstanceLaunchConfig>
}

export interface StoredLaunchContextOptions
  extends ResolveSupervisorRootOptions {
  readConfig?: (
    supervisorRoot: string,
  ) => Promise<SupervisorConfigDocument>
}

export interface PersistInstanceConfigOptions {
  readConfig?: (
    supervisorRoot: string,
  ) => Promise<SupervisorConfigDocument>
  writeConfig?: (
    supervisorRoot: string,
    config: SupervisorConfigDocument,
  ) => Promise<void>
}

export async function resolveStoredLaunchContext(
  flags: TuiLaunchFlags = {},
  options: StoredLaunchContextOptions = {},
): Promise<ResolvedLaunchContext> {
  const env = options.env ?? process.env
  const supervisorRoot = resolveSupervisorRootPath(options)
  const config = await (
    options.readConfig ?? readSupervisorConfig
  )(supervisorRoot)
  const selectedInstance = flags.instance
    ?? env['OPENALICE_INSTANCE']
    ?? config.defaultInstance
    ?? 'default'
  const machineConfig: MachineSupervisorConfig = {
    defaultInstance: config.defaultInstance,
    defaults: config.defaults,
  }

  return resolveLaunchContext({
    flags,
    machineConfig,
    instanceConfig: config.instances?.[selectedInstance],
    env,
    cwd: options.cwd,
    homeDir: options.homeDir,
    platform: options.platform,
  })
}

export async function persistInstanceLaunchConfig(
  context: ResolvedLaunchContext,
  patch: LaunchConfigValues,
  options: PersistInstanceConfigOptions = {},
): Promise<void> {
  const readConfig = options.readConfig ?? readSupervisorConfig
  const writeConfig = options.writeConfig ?? writeSupervisorConfig
  const current = await readConfig(context.supervisorRoot)
  const existing = current.instances?.[context.instance] ?? {
    name: context.instance,
  }
  const instance: InstanceLaunchConfig = {
    ...existing,
    ...patch,
    name: context.instance,
  }
  const next: SupervisorConfigDocument = {
    ...current,
    schemaVersion: CONFIG_SCHEMA_VERSION,
    instances: {
      ...current.instances,
      [context.instance]: instance,
    },
  }
  await writeConfig(context.supervisorRoot, next)
}

export async function readSupervisorConfig(
  supervisorRoot: string,
): Promise<SupervisorConfigDocument> {
  const path = supervisorConfigPath(supervisorRoot)
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch (error: unknown) {
    if (isNodeError(error, 'ENOENT')) {
      return { schemaVersion: CONFIG_SCHEMA_VERSION }
    }
    throw configError(`Could not read Supervisor configuration at ${path}: ${errorMessage(error)}`)
  }

  try {
    return parseSupervisorConfig(JSON.parse(text) as unknown)
  } catch (error: unknown) {
    if (isConfigError(error)) throw error
    throw configError(`Invalid Supervisor configuration at ${path}: ${errorMessage(error)}`)
  }
}

export async function writeSupervisorConfig(
  supervisorRoot: string,
  config: SupervisorConfigDocument,
): Promise<void> {
  const validated = parseSupervisorConfig(config)
  const path = supervisorConfigPath(supervisorRoot)
  const temporary = join(
    supervisorRoot,
    `.${CONFIG_FILE_NAME}.${process.pid}.${randomUUID()}.tmp`,
  )
  await mkdir(supervisorRoot, { recursive: true, mode: 0o700 })
  try {
    await writeFile(
      temporary,
      `${JSON.stringify(validated, null, 2)}\n`,
      { encoding: 'utf8', mode: 0o600, flag: 'wx' },
    )
    await rename(temporary, path)
  } catch (error: unknown) {
    await rm(temporary, { force: true }).catch(() => undefined)
    throw configError(`Could not save Supervisor configuration at ${path}: ${errorMessage(error)}`)
  }
}

export function parseSupervisorConfig(
  value: unknown,
): SupervisorConfigDocument {
  const root = requireRecord(value, 'Supervisor configuration')
  rejectUnknownKeys(root, CONFIG_KEYS, 'Supervisor configuration')
  if (root['schemaVersion'] !== CONFIG_SCHEMA_VERSION) {
    throw configError(
      `Supervisor configuration schemaVersion must be ${CONFIG_SCHEMA_VERSION}.`,
    )
  }

  const defaultInstance = optionalInstanceName(
    root['defaultInstance'],
    'defaultInstance',
  )
  const defaults = root['defaults'] === undefined
    ? undefined
    : parseLaunchValues(root['defaults'], 'defaults', false)
  let instances: Record<string, InstanceLaunchConfig> | undefined
  if (root['instances'] !== undefined) {
    const rawInstances = requireRecord(root['instances'], 'instances')
    instances = {}
    for (const [name, entry] of Object.entries(rawInstances)) {
      requireInstanceName(name, `instances.${name}`)
      const parsed = parseLaunchValues(
        entry,
        `instances.${name}`,
        true,
      ) as InstanceLaunchConfig
      if (parsed.name !== undefined && parsed.name !== name) {
        throw configError(
          `instances.${name}.name must match its registry key.`,
        )
      }
      instances[name] = { ...parsed, name }
    }
  }

  return {
    schemaVersion: CONFIG_SCHEMA_VERSION,
    ...(defaultInstance === undefined ? {} : { defaultInstance }),
    ...(defaults === undefined ? {} : { defaults }),
    ...(instances === undefined ? {} : { instances }),
  }
}

export function supervisorConfigPath(supervisorRoot: string): string {
  return join(supervisorRoot, CONFIG_FILE_NAME)
}

function parseLaunchValues(
  value: unknown,
  label: string,
  allowName: boolean,
): LaunchConfigValues | InstanceLaunchConfig {
  const record = requireRecord(value, label)
  rejectUnknownKeys(
    record,
    allowName
      ? LAUNCH_VALUE_KEYS
      : new Set([...LAUNCH_VALUE_KEYS].filter((key) => key !== 'name')),
    label,
  )
  const result: InstanceLaunchConfig = {}
  if (allowName && record['name'] !== undefined) {
    result.name = requireInstanceName(record['name'], `${label}.name`)
  }
  if (record['home'] !== undefined) {
    result.home = requireNonEmptyString(record['home'], `${label}.home`)
  }
  if (record['appDir'] !== undefined) {
    result.appDir = record['appDir'] === null
      ? null
      : requireNonEmptyString(record['appDir'], `${label}.appDir`)
  }
  if (record['port'] !== undefined) {
    const port = record['port']
    if (!Number.isInteger(port) || Number(port) < 1 || Number(port) > 65_535) {
      throw configError(`${label}.port must be an integer between 1 and 65535.`)
    }
    result.port = Number(port)
  }
  if (record['updateChecks'] !== undefined) {
    if (typeof record['updateChecks'] !== 'boolean') {
      throw configError(`${label}.updateChecks must be a boolean.`)
    }
    result.updateChecks = record['updateChecks']
  }
  return result
}

function optionalInstanceName(
  value: unknown,
  label: string,
): string | undefined {
  return value === undefined ? undefined : requireInstanceName(value, label)
}

function requireInstanceName(value: unknown, label: string): string {
  const name = requireNonEmptyString(value, label)
  if (!INSTANCE_NAME_PATTERN.test(name)) {
    throw configError(
      `${label} must begin with a lowercase letter and contain only lowercase letters, numbers, "_" or "-".`,
    )
  }
  return name
}

function requireNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw configError(`${label} must be a non-empty string.`)
  }
  return value
}

function requireRecord(
  value: unknown,
  label: string,
): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw configError(`${label} must be a JSON object.`)
  }
  return value as Record<string, unknown>
}

function rejectUnknownKeys(
  value: Record<string, unknown>,
  allowed: Set<string>,
  label: string,
): void {
  const unknown = Object.keys(value).find((key) => !allowed.has(key))
  if (unknown) {
    throw configError(`${label} contains unknown field "${unknown}".`)
  }
}

function configError(message: string): Error & {
  code: string
  exitCode: number
} {
  return Object.assign(new Error(message), {
    code: 'ESUPERVISORCONFIG',
    exitCode: 2,
  })
}

function isConfigError(error: unknown): boolean {
  return error instanceof Error
    && 'code' in error
    && error.code === 'ESUPERVISORCONFIG'
}

function isNodeError(error: unknown, code: string): boolean {
  return error instanceof Error
    && 'code' in error
    && error.code === code
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
