import { randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import {
  access,
  mkdir,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
} from 'node:path'

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
const IGNORED_HOME_ENTRIES = new Set([
  '.DS_Store',
  'Thumbs.db',
  'desktop.ini',
])
const OPENALICE_HOME_ENTRIES = new Set([
  'provider-keys.json',
  'sealing.key',
])
const OPENALICE_HOME_MARKERS = [
  ['data', 'config'],
  ['workspaces', 'workspaces.json'],
  ['state', 'guardian.lock'],
  ['state', 'runtime.lock'],
  ['runtime', 'broker-packs'],
] as const
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
  selectedInstance?: string
  checkStoredHome?: (
    path: string,
    instance: string,
  ) => Promise<void>
  readConfig?: (
    supervisorRoot: string,
  ) => Promise<SupervisorConfigDocument>
}

export interface PersistInstanceConfigOptions {
  cwd?: string
  homeDir?: string
  platform?: NodeJS.Platform
  readConfig?: (
    supervisorRoot: string,
  ) => Promise<SupervisorConfigDocument>
  writeConfig?: (
    supervisorRoot: string,
    config: SupervisorConfigDocument,
  ) => Promise<void>
}

export interface SupervisorInstanceSummary {
  name: string
  home: string
  port: number
  portAutomatic: boolean
  isDefault: boolean
}

export interface SupervisorInstanceRegistry {
  defaultInstance: string
  instances: SupervisorInstanceSummary[]
}

export async function readInstanceLaunchConfig(
  context: ResolvedLaunchContext,
  options: Pick<PersistInstanceConfigOptions, 'readConfig'> = {},
): Promise<InstanceLaunchConfig> {
  const config = await (
    options.readConfig ?? readSupervisorConfig
  )(context.supervisorRoot)
  return {
    ...config.instances?.[context.instance],
    name: context.instance,
  }
}

export async function readMachineLaunchConfig(
  context: Pick<ResolvedLaunchContext, 'supervisorRoot'>,
  options: Pick<PersistInstanceConfigOptions, 'readConfig'> = {},
): Promise<LaunchConfigValues> {
  const config = await (
    options.readConfig ?? readSupervisorConfig
  )(context.supervisorRoot)
  return { ...config.defaults }
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
    ?? options.selectedInstance
    ?? config.defaultInstance
    ?? 'default'
  const machineConfig: MachineSupervisorConfig = {
    defaultInstance: options.selectedInstance ?? config.defaultInstance,
    defaults: config.defaults,
  }

  const context = resolveLaunchContext({
    flags,
    machineConfig,
    instanceConfig: config.instances?.[selectedInstance],
    env,
    cwd: options.cwd,
    homeDir: options.homeDir,
    platform: options.platform,
  })
  if (context.provenance.home.source === 'instance-config') {
    await (
      options.checkStoredHome ?? assertStoredHomePresent
    )(context.home, context.instance)
  }
  return context
}

export async function resolveAvailableStoredLaunchContext(
  options: StoredLaunchContextOptions = {},
): Promise<ResolvedLaunchContext> {
  const supervisorRoot = resolveSupervisorRootPath(options)
  const config = await (
    options.readConfig ?? readSupervisorConfig
  )(supervisorRoot)
  const candidates = [
    'default',
    ...Object.keys(config.instances ?? {})
      .filter((name) => name !== 'default')
      .sort(),
  ]
  let unavailable: unknown
  for (const name of candidates) {
    try {
      return await resolveStoredLaunchContext({}, {
        ...options,
        selectedInstance: name,
        readConfig: async () => config,
      })
    } catch (error: unknown) {
      if (!isStoredHomeUnavailableError(error)) throw error
      unavailable = error
    }
  }
  throw unavailable ?? configError(
    'No available OpenAlice instance could be selected.',
  )
}

export function isStoredHomeUnavailableError(
  error: unknown,
): boolean {
  return error instanceof Error
    && 'code' in error
    && (
      error.code === 'ESTOREDHOMEMISSING'
      || error.code === 'ESTOREDHOMEUNAVAILABLE'
    )
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
  if (
    context.instance !== 'default'
    && Object.hasOwn(patch, 'home')
    && patch.home === undefined
  ) {
    throw configError(
      `Instance "${context.instance}" must keep an explicit complete home.`,
    )
  }
  const normalizedPatch = { ...patch }
  if (typeof patch.home === 'string') {
    normalizedPatch.home = resolveConfiguredHome(
      context.instance,
      patch.home,
      options,
    )
  }
  const instance: InstanceLaunchConfig = {
    ...existing,
    ...normalizedPatch,
    name: context.instance,
  }
  for (const key of [
    'home',
    'port',
    'appDir',
    'updateChecks',
  ] as const) {
    if (Object.hasOwn(patch, key) && patch[key] === undefined) {
      delete instance[key]
    }
  }
  const next: SupervisorConfigDocument = {
    ...current,
    schemaVersion: CONFIG_SCHEMA_VERSION,
    instances: {
      ...current.instances,
      [context.instance]: instance,
    },
  }
  await assertRegistryHomesSeparate(next, options)
  if (typeof normalizedPatch.home === 'string') {
    await mkdir(normalizedPatch.home, { recursive: true, mode: 0o700 })
    await assertHomeCandidateUsable(normalizedPatch.home)
    instance.home = await realpath(normalizedPatch.home)
    await assertRegistryHomesSeparate(next, options)
  }
  await writeConfig(context.supervisorRoot, next)
}

export async function persistMachineLaunchConfig(
  context: Pick<ResolvedLaunchContext, 'supervisorRoot'>,
  patch: LaunchConfigValues,
  options: PersistInstanceConfigOptions = {},
): Promise<void> {
  const readConfig = options.readConfig ?? readSupervisorConfig
  const writeConfig = options.writeConfig ?? writeSupervisorConfig
  const current = await readConfig(context.supervisorRoot)
  const defaults: LaunchConfigValues = {
    ...current.defaults,
    ...patch,
  }
  for (const key of [
    'home',
    'port',
    'appDir',
    'updateChecks',
  ] as const) {
    if (Object.hasOwn(patch, key) && patch[key] === undefined) {
      delete defaults[key]
    }
  }
  if (typeof patch.home === 'string') {
    defaults.home = resolveConfiguredHome('default', patch.home, options)
  }
  const next: SupervisorConfigDocument = {
    ...current,
    schemaVersion: CONFIG_SCHEMA_VERSION,
    defaults: Object.keys(defaults).length > 0 ? defaults : undefined,
  }
  await assertRegistryHomesSeparate(next, options)
  if (typeof defaults.home === 'string' && Object.hasOwn(patch, 'home')) {
    await mkdir(defaults.home, { recursive: true, mode: 0o700 })
    await assertHomeCandidateUsable(defaults.home)
    defaults.home = await realpath(defaults.home)
    await assertRegistryHomesSeparate(next, options)
  }
  await writeConfig(context.supervisorRoot, next)
}

export async function readSupervisorInstanceRegistry(
  context: Pick<ResolvedLaunchContext, 'supervisorRoot'>,
  options: StoredLaunchContextOptions = {},
): Promise<SupervisorInstanceRegistry> {
  const config = await (
    options.readConfig ?? readSupervisorConfig
  )(context.supervisorRoot)
  await assertRegistryHomesSeparate(config, options)
  return buildInstanceRegistry(config, options)
}

export async function persistSelectedSupervisorInstance(
  context: Pick<ResolvedLaunchContext, 'supervisorRoot'>,
  name: string,
  options: PersistInstanceConfigOptions = {},
): Promise<void> {
  requireInstanceName(name, 'instance')
  const readConfig = options.readConfig ?? readSupervisorConfig
  const writeConfig = options.writeConfig ?? writeSupervisorConfig
  const current = await readConfig(context.supervisorRoot)
  if (name !== 'default' && !current.instances?.[name]) {
    throw configError(`Instance "${name}" is not registered.`)
  }
  if (name !== 'default' && !current.instances?.[name]?.home) {
    throw configError(
      `Instance "${name}" needs an explicit complete home before it can become the default.`,
    )
  }
  await assertRegistryHomesSeparate(current, options)
  if (name !== 'default' || current.instances?.default?.home) {
    const selected = buildInstanceRegistry(current, options)
      .instances
      .find((entry) => entry.name === name)
    if (!selected) {
      throw configError(`Instance "${name}" is not registered.`)
    }
    await assertStoredHomePresent(selected.home, name)
  }
  await writeConfig(context.supervisorRoot, {
    ...current,
    schemaVersion: CONFIG_SCHEMA_VERSION,
    defaultInstance: name === 'default' ? undefined : name,
  })
}

export async function createSupervisorInstance(
  context: Pick<ResolvedLaunchContext, 'supervisorRoot'>,
  name: string,
  home: string,
  options: PersistInstanceConfigOptions = {},
): Promise<void> {
  requireInstanceName(name, 'instance')
  if (name === 'default') {
    throw configError('The implicit "default" instance already exists.')
  }
  const readConfig = options.readConfig ?? readSupervisorConfig
  const writeConfig = options.writeConfig ?? writeSupervisorConfig
  const current = await readConfig(context.supervisorRoot)
  if (current.instances?.[name]) {
    throw configError(`Instance "${name}" is already registered.`)
  }
  let normalizedHome = resolveConfiguredHome(name, home, options)
  const candidate: SupervisorConfigDocument = {
    ...current,
    schemaVersion: CONFIG_SCHEMA_VERSION,
    defaultInstance: name,
    instances: {
      ...current.instances,
      [name]: {
        name,
        home: normalizedHome,
      },
    },
  }
  await assertRegistryHomesSeparate(candidate, options)
  await mkdir(normalizedHome, { recursive: true, mode: 0o700 })
  await assertHomeCandidateUsable(normalizedHome)
  normalizedHome = await realpath(normalizedHome)
  const next: SupervisorConfigDocument = {
    ...candidate,
    instances: {
      ...candidate.instances,
      [name]: {
        name,
        home: normalizedHome,
      },
    },
  }
  await assertRegistryHomesSeparate(next, options)
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
  if (
    defaultInstance !== undefined
    && defaultInstance !== 'default'
    && !instances?.[defaultInstance]
  ) {
    throw configError(
      `defaultInstance "${defaultInstance}" is not present in instances.`,
    )
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

export function validateSupervisorInstanceName(
  value: string,
): string | undefined {
  if (!INSTANCE_NAME_PATTERN.test(value)) {
    return 'Use 1-32 lowercase letters, numbers, "_" or "-", beginning with a letter.'
  }
  if (value === 'default') {
    return 'The implicit "default" instance already exists.'
  }
  return undefined
}

function buildInstanceRegistry(
  config: SupervisorConfigDocument,
  options: ResolveSupervisorRootOptions,
): SupervisorInstanceRegistry {
  const defaultInstance = config.defaultInstance ?? 'default'
  const names = [
    'default',
    ...Object.keys(config.instances ?? {})
      .filter((name) => name !== 'default')
      .sort(),
  ]
  const machineConfig: MachineSupervisorConfig = {
    defaultInstance: config.defaultInstance,
    defaults: config.defaults,
  }
  return {
    defaultInstance,
    instances: names.map((name) => {
      const resolved = resolveLaunchContext({
        flags: { instance: name },
        machineConfig,
        instanceConfig: config.instances?.[name],
        env: {},
        cwd: options.cwd,
        homeDir: options.homeDir,
        platform: options.platform,
      })
      return {
        name,
        home: resolved.home,
        port: resolved.port,
        portAutomatic: resolved.provenance.port.source === 'default',
        isDefault: name === defaultInstance,
      }
    }),
  }
}

function resolveConfiguredHome(
  instance: string,
  home: string,
  options: Pick<PersistInstanceConfigOptions, 'cwd' | 'homeDir' | 'platform'>,
): string {
  return resolveLaunchContext({
    flags: { instance, home },
    env: {},
    cwd: options.cwd,
    homeDir: options.homeDir,
    platform: options.platform,
  }).home
}

async function assertRegistryHomesSeparate(
  config: SupervisorConfigDocument,
  options: Pick<PersistInstanceConfigOptions, 'cwd' | 'homeDir' | 'platform'>,
): Promise<void> {
  const registry = buildInstanceRegistry(config, options)
  const homes = await Promise.all(registry.instances.map(async (entry) => ({
    ...entry,
    physicalHome: await physicalPath(entry.home),
  })))
  for (let leftIndex = 0; leftIndex < homes.length; leftIndex += 1) {
    const left = homes[leftIndex]
    if (!left) continue
    for (let rightIndex = leftIndex + 1; rightIndex < homes.length; rightIndex += 1) {
      const right = homes[rightIndex]
      if (!right) continue
      if (
        normalizedPathKey(left.physicalHome, options.platform)
          === normalizedPathKey(right.physicalHome, options.platform)
        || pathContains(left.physicalHome, right.physicalHome)
        || pathContains(right.physicalHome, left.physicalHome)
      ) {
        throw configError(
          `Complete home ${right.home} for instance "${right.name}" overlaps instance "${left.name}" at ${left.home}. Choose a separate directory.`,
        )
      }
    }
  }
}

async function physicalPath(path: string): Promise<string> {
  const absolute = resolve(path)
  let current = absolute
  const suffix: string[] = []
  while (true) {
    try {
      return resolve(await realpath(current), ...suffix)
    } catch (error: unknown) {
      if (!isNodeError(error, 'ENOENT')) return absolute
      const parent = dirname(current)
      if (parent === current) return absolute
      suffix.unshift(basename(current))
      current = parent
    }
  }
}

async function assertHomeCandidateUsable(path: string): Promise<void> {
  let info
  try {
    info = await stat(path)
  } catch (error: unknown) {
    if (isNodeError(error, 'ENOENT')) return
    throw configError(
      `Complete home ${path} is unavailable: ${errorMessage(error)}`,
    )
  }
  if (!info.isDirectory()) {
    throw configError(`Complete home ${path} is not a directory.`)
  }
  try {
    await access(path, constants.R_OK | constants.W_OK)
    const entries = (await readdir(path))
      .filter((entry) => !IGNORED_HOME_ENTRIES.has(entry))
    if (entries.length === 0) return
    if (
      entries.some((entry) => OPENALICE_HOME_ENTRIES.has(entry))
      || await hasOpenAliceHomeMarker(path)
    ) return
  } catch (error: unknown) {
    if (isConfigError(error)) throw error
    throw configError(
      `Complete home ${path} is unavailable or not writable: ${errorMessage(error)}`,
    )
  }
  throw configError(
    `Complete home ${path} is non-empty and is not an existing OpenAlice home. Choose an empty directory or an OpenAlice home.`,
  )
}

async function assertStoredHomePresent(
  path: string,
  instance: string,
): Promise<void> {
  try {
    const info = await stat(path)
    if (!info.isDirectory()) {
      throw configError(
        `Registered complete home ${path} for instance "${instance}" is not a directory.`,
        'ESTOREDHOMEUNAVAILABLE',
      )
    }
    await access(path, constants.R_OK | constants.W_OK)
  } catch (error: unknown) {
    if (isConfigError(error)) throw error
    const missing = isNodeError(error, 'ENOENT')
      ? 'is missing'
      : 'is unavailable or not writable'
    throw configError(
      `Registered complete home ${path} for instance "${instance}" ${missing}. Reconnect it or choose another instance.`,
      isNodeError(error, 'ENOENT')
        ? 'ESTOREDHOMEMISSING'
        : 'ESTOREDHOMEUNAVAILABLE',
    )
  }
}

async function hasOpenAliceHomeMarker(path: string): Promise<boolean> {
  for (const parts of OPENALICE_HOME_MARKERS) {
    try {
      await access(join(path, ...parts))
      return true
    } catch {
      // Keep checking known complete-home markers.
    }
  }
  return false
}

function normalizedPathKey(
  path: string,
  platform: NodeJS.Platform = process.platform,
): string {
  const normalized = resolve(path)
  return platform === 'win32'
    ? normalized.toLocaleLowerCase('en-US')
    : normalized
}

function pathContains(parent: string, child: string): boolean {
  const rel = relative(parent, child)
  return rel.length > 0 && !rel.startsWith('..') && !isAbsolute(rel)
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

function configError(
  message: string,
  code = 'ESUPERVISORCONFIG',
): Error & {
  code: string
  exitCode: number
} {
  return Object.assign(new Error(message), {
    code,
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
