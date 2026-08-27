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
  type AliceProjectLaunchConfig,
  type LaunchConfigValues,
  type MachineSupervisorConfig,
  type ResolvedLaunchContext,
  type ResolveSupervisorRootOptions,
  type TuiLaunchFlags,
} from './launch-context.ts'
import {
  parseAliceProjectProduct,
  writeAliceProjectProductStamp,
  type AliceProjectProduct,
} from './alice-project-product.ts'

const CONFIG_SCHEMA_VERSION = 2
const PROJECT_KEY_PATTERN = /^[a-z][a-z0-9_-]{0,31}$/
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
const LEGACY_CONFIG_KEYS = new Set([
  'schemaVersion',
  'defaultInstance',
  'defaults',
  'instances',
])
const CONFIG_KEYS = new Set([
  'schemaVersion',
  'defaultProject',
  'defaults',
  'projects',
])
const LAUNCH_VALUE_KEYS = new Set([
  'name',
  'displayName',
  'home',
  'port',
  'appDir',
  'updateChecks',
  'product',
])

export interface SupervisorConfigDocument {
  schemaVersion: 2
  defaultProject?: string
  defaults?: LaunchConfigValues
  projects?: Record<string, AliceProjectLaunchConfig>
}

interface LegacySupervisorConfigDocument {
  schemaVersion: 1
  defaultInstance?: string
  defaults?: LaunchConfigValues
  instances?: Record<string, AliceProjectLaunchConfig>
}

type SupervisorConfigInput = SupervisorConfigDocument | LegacySupervisorConfigDocument

export interface StoredLaunchContextOptions
  extends ResolveSupervisorRootOptions {
  selectedProject?: string
  checkStoredHome?: (
    path: string,
    project: string,
  ) => Promise<void>
  readConfig?: (
    supervisorRoot: string,
  ) => Promise<SupervisorConfigInput>
}

export interface PersistAliceProjectConfigOptions {
  cwd?: string
  homeDir?: string
  platform?: NodeJS.Platform
  readConfig?: (
    supervisorRoot: string,
  ) => Promise<SupervisorConfigInput>
  writeConfig?: (
    supervisorRoot: string,
    config: SupervisorConfigDocument,
  ) => Promise<void>
}

export interface SupervisorAliceProjectSummary {
  id: string
  key: string
  displayName: string
  home: string
  port: number
  portAutomatic: boolean
  isDefault: boolean
}

export interface SupervisorAliceProjectRegistry {
  defaultProject: string
  projects: SupervisorAliceProjectSummary[]
}

export async function readAliceProjectLaunchConfig(
  context: ResolvedLaunchContext,
  options: Pick<PersistAliceProjectConfigOptions, 'readConfig'> = {},
): Promise<AliceProjectLaunchConfig> {
  const config = parseSupervisorConfig(await (
    options.readConfig ?? readSupervisorConfig
  )(context.supervisorRoot))
  return {
    ...config.projects?.[context.project],
    name: context.project,
  }
}

export async function readMachineLaunchConfig(
  context: Pick<ResolvedLaunchContext, 'supervisorRoot'>,
  options: Pick<PersistAliceProjectConfigOptions, 'readConfig'> = {},
): Promise<LaunchConfigValues> {
  const config = parseSupervisorConfig(await (
    options.readConfig ?? readSupervisorConfig
  )(context.supervisorRoot))
  return { ...config.defaults }
}

export async function resolveStoredLaunchContext(
  flags: TuiLaunchFlags = {},
  options: StoredLaunchContextOptions = {},
): Promise<ResolvedLaunchContext> {
  const env = options.env ?? process.env
  const supervisorRoot = resolveSupervisorRootPath(options)
  const config = parseSupervisorConfig(await (
    options.readConfig ?? readSupervisorConfig
  )(supervisorRoot))
  const selectedProject = flags.project
    ?? flags.instance
    ?? env['OPENALICE_PROJECT']
    ?? env['OPENALICE_INSTANCE']
    ?? options.selectedProject
    ?? config.defaultProject
    ?? 'default'
  const machineConfig: MachineSupervisorConfig = {
    defaultProject: options.selectedProject
      ?? config.defaultProject,
    defaults: config.defaults,
  }

  const context = resolveLaunchContext({
    flags,
    machineConfig,
    projectConfig: config.projects?.[selectedProject],
    env,
    cwd: options.cwd,
    homeDir: options.homeDir,
    platform: options.platform,
  })
  if (context.provenance.home.source === 'project-config') {
    await (
      options.checkStoredHome ?? assertStoredHomePresent
    )(context.home, context.project)
  }
  return context
}

export async function resolveAvailableStoredLaunchContext(
  options: StoredLaunchContextOptions = {},
): Promise<ResolvedLaunchContext> {
  const supervisorRoot = resolveSupervisorRootPath(options)
  const config = parseSupervisorConfig(await (
    options.readConfig ?? readSupervisorConfig
  )(supervisorRoot))
  const candidates = [
    'default',
    ...Object.keys(config.projects ?? {})
      .filter((name) => name !== 'default')
      .sort(),
  ]
  let unavailable: unknown
  for (const name of candidates) {
    try {
      return await resolveStoredLaunchContext({}, {
        ...options,
        selectedProject: name,
        readConfig: async () => config,
      })
    } catch (error: unknown) {
      if (!isStoredHomeUnavailableError(error)) throw error
      unavailable = error
    }
  }
  throw unavailable ?? configError(
    'No available AliceProject could be selected.',
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

export async function persistAliceProjectLaunchConfig(
  context: ResolvedLaunchContext,
  patch: LaunchConfigValues,
  options: PersistAliceProjectConfigOptions = {},
): Promise<void> {
  const readConfig = options.readConfig ?? readSupervisorConfig
  const writeConfig = options.writeConfig ?? writeSupervisorConfig
  const current = parseSupervisorConfig(await readConfig(context.supervisorRoot))
  const existing = current.projects?.[context.project] ?? {
    name: context.project,
  }
  if (
    context.project !== 'default'
    && Object.hasOwn(patch, 'home')
    && patch.home === undefined
  ) {
    throw configError(
      `AliceProject "${context.project}" must keep an explicit complete home.`,
    )
  }
  const normalizedPatch = { ...patch }
  if (typeof patch.home === 'string') {
    normalizedPatch.home = resolveConfiguredHome(
      context.project,
      patch.home,
      options,
    )
  }
  const project: AliceProjectLaunchConfig = {
    ...existing,
    ...normalizedPatch,
    name: context.project,
    ...(existing.product === 'nano' ? { product: 'nano' } : {}),
  }
  if (existing.product !== 'nano') delete project.product
  for (const key of [
    'home',
    'port',
    'appDir',
    'updateChecks',
  ] as const) {
    if (Object.hasOwn(patch, key) && patch[key] === undefined) {
      delete project[key]
    }
  }
  const next: SupervisorConfigDocument = {
    ...current,
    schemaVersion: CONFIG_SCHEMA_VERSION,
    projects: {
      ...current.projects,
      [context.project]: project,
    },
  }
  await assertRegistryHomesSeparate(next, options)
  if (typeof normalizedPatch.home === 'string') {
    await mkdir(normalizedPatch.home, { recursive: true, mode: 0o700 })
    await assertHomeCandidateUsable(normalizedPatch.home)
    project.home = await realpath(normalizedPatch.home)
    await assertRegistryHomesSeparate(next, options)
  }
  await writeConfig(context.supervisorRoot, next)
}

export async function persistMachineLaunchConfig(
  context: Pick<ResolvedLaunchContext, 'supervisorRoot'>,
  patch: LaunchConfigValues,
  options: PersistAliceProjectConfigOptions = {},
): Promise<void> {
  const readConfig = options.readConfig ?? readSupervisorConfig
  const writeConfig = options.writeConfig ?? writeSupervisorConfig
  const current = parseSupervisorConfig(await readConfig(context.supervisorRoot))
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

export async function readSupervisorAliceProjectRegistry(
  context: Pick<ResolvedLaunchContext, 'supervisorRoot'>,
  options: StoredLaunchContextOptions = {},
): Promise<SupervisorAliceProjectRegistry> {
  const config = parseSupervisorConfig(await (
    options.readConfig ?? readSupervisorConfig
  )(context.supervisorRoot))
  await assertRegistryHomesSeparate(config, options)
  return buildAliceProjectRegistry(config, options)
}

export async function persistSelectedSupervisorAliceProject(
  context: Pick<ResolvedLaunchContext, 'supervisorRoot'>,
  name: string,
  options: PersistAliceProjectConfigOptions = {},
): Promise<void> {
  requireProjectKey(name, 'project')
  const readConfig = options.readConfig ?? readSupervisorConfig
  const writeConfig = options.writeConfig ?? writeSupervisorConfig
  const current = parseSupervisorConfig(await readConfig(context.supervisorRoot))
  if (name !== 'default' && !current.projects?.[name]) {
    throw configError(`AliceProject "${name}" is not registered.`)
  }
  if (name !== 'default' && !current.projects?.[name]?.home) {
    throw configError(
      `AliceProject "${name}" needs an explicit complete home before it can become the default.`,
    )
  }
  await assertRegistryHomesSeparate(current, options)
  if (name !== 'default' || current.projects?.default?.home) {
    const selected = buildAliceProjectRegistry(current, options)
      .projects
      .find((entry) => entry.key === name)
    if (!selected) {
      throw configError(`AliceProject "${name}" is not registered.`)
    }
    await assertStoredHomePresent(selected.home, name)
  }
  await writeConfig(context.supervisorRoot, {
    ...current,
    schemaVersion: CONFIG_SCHEMA_VERSION,
    defaultProject: name === 'default' ? undefined : name,
  })
}

export async function createSupervisorAliceProject(
  context: Pick<ResolvedLaunchContext, 'supervisorRoot'>,
  name: string,
  home: string,
  options: PersistAliceProjectConfigOptions & {
    product?: AliceProjectProduct
    displayName?: string
    select?: boolean
  } = {},
): Promise<void> {
  requireProjectKey(name, 'project')
  if (name === 'default') {
    throw configError('The implicit "default" AliceProject already exists.')
  }
  const product = options.product ?? 'trader'
  const readConfig = options.readConfig ?? readSupervisorConfig
  const writeConfig = options.writeConfig ?? writeSupervisorConfig
  const current = parseSupervisorConfig(await readConfig(context.supervisorRoot))
  if (current.projects?.[name]) {
    throw configError(`AliceProject "${name}" is already registered.`)
  }
  let normalizedHome = resolveConfiguredHome(name, home, options)
  const projectEntry: AliceProjectLaunchConfig = {
    name,
    ...(options.displayName ? { displayName: options.displayName } : {}),
    home: normalizedHome,
    ...(product === 'nano' ? { product } : {}),
  }
  const candidate: SupervisorConfigDocument = {
    ...current,
    schemaVersion: CONFIG_SCHEMA_VERSION,
    defaultProject: options.select === false ? current.defaultProject : name,
    projects: {
      ...current.projects,
      [name]: projectEntry,
    },
  }
  await assertRegistryHomesSeparate(candidate, options)
  await mkdir(normalizedHome, { recursive: true, mode: 0o700 })
  await assertHomeCandidateUsable(normalizedHome)
  normalizedHome = await realpath(normalizedHome)
  const stampedProduct = await writeAliceProjectProductStamp(normalizedHome, product)
  if (stampedProduct !== product) {
    throw configError(
      `AliceProject home ${normalizedHome} was born as ${stampedProduct}; it cannot be registered as ${product}`,
    )
  }
  const next: SupervisorConfigDocument = {
    ...candidate,
    projects: {
      ...candidate.projects,
      [name]: {
        ...projectEntry,
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
  if (root['schemaVersion'] === 1) {
    return parseLegacySupervisorConfig(root)
  }
  assertCurrentSupervisorSchemaVersion(root['schemaVersion'])

  const defaultProject = optionalProjectKey(
    root['defaultProject'],
    'defaultProject',
  )
  const defaults = root['defaults'] === undefined
    ? undefined
    : parseLaunchValues(root['defaults'], 'defaults', false, true)
  let projects: Record<string, AliceProjectLaunchConfig> | undefined
  if (root['projects'] !== undefined) {
    const rawProjects = requireRecord(root['projects'], 'projects')
    projects = {}
    for (const [name, entry] of Object.entries(rawProjects)) {
      requireProjectKey(name, `projects.${name}`)
      const parsed = parseLaunchValues(
        entry,
        `projects.${name}`,
        true,
        true,
      ) as AliceProjectLaunchConfig
      if (parsed.name !== undefined && parsed.name !== name) {
        throw configError(
          `projects.${name}.name must match its registry key.`,
        )
      }
      projects[name] = { ...parsed, name }
    }
  }
  if (
    defaultProject !== undefined
    && defaultProject !== 'default'
    && !projects?.[defaultProject]
  ) {
    throw configError(
      `defaultProject "${defaultProject}" is not present in projects.`,
    )
  }

  return retainUnknownFields({
    schemaVersion: CONFIG_SCHEMA_VERSION,
    ...(defaultProject === undefined ? {} : { defaultProject }),
    ...(defaults === undefined ? {} : { defaults }),
    ...(projects === undefined ? {} : { projects }),
  }, root, CONFIG_KEYS)
}

function parseLegacySupervisorConfig(
  root: Record<string, unknown>,
): SupervisorConfigDocument {
  rejectUnknownKeys(root, LEGACY_CONFIG_KEYS, 'Supervisor configuration')
  const defaultProject = optionalProjectKey(
    root['defaultInstance'],
    'defaultInstance',
  )
  const defaults = root['defaults'] === undefined
    ? undefined
    : parseLaunchValues(root['defaults'], 'defaults', false)
  let projects: Record<string, AliceProjectLaunchConfig> | undefined
  if (root['instances'] !== undefined) {
    const legacyInstances = requireRecord(root['instances'], 'instances')
    projects = {}
    for (const [key, value] of Object.entries(legacyInstances)) {
      requireProjectKey(key, `instances.${key}`)
      const parsed = parseLaunchValues(
        value,
        `instances.${key}`,
        true,
      ) as AliceProjectLaunchConfig
      if (parsed.name !== undefined && parsed.name !== key) {
        throw configError(`instances.${key}.name must match its registry key.`)
      }
      projects[key] = {
        ...parsed,
        name: key,
        displayName: parsed.displayName ?? humanizeProjectKey(key),
      }
    }
  }
  if (
    defaultProject !== undefined
    && defaultProject !== 'default'
    && !projects?.[defaultProject]
  ) {
    throw configError(
      `defaultInstance "${defaultProject}" is not present in instances.`,
    )
  }
  return {
    schemaVersion: CONFIG_SCHEMA_VERSION,
    ...(defaultProject === undefined ? {} : { defaultProject }),
    ...(defaults === undefined ? {} : { defaults }),
    ...(projects === undefined ? {} : { projects }),
  }
}

export function supervisorConfigPath(supervisorRoot: string): string {
  return join(supervisorRoot, CONFIG_FILE_NAME)
}

export function validateSupervisorAliceProjectKey(
  value: string,
): string | undefined {
  if (!PROJECT_KEY_PATTERN.test(value)) {
    return 'Use 1-32 lowercase letters, numbers, "_" or "-", beginning with a letter.'
  }
  if (value === 'default') {
    return 'The implicit "default" AliceProject already exists.'
  }
  return undefined
}

function buildAliceProjectRegistry(
  config: SupervisorConfigDocument,
  options: ResolveSupervisorRootOptions,
): SupervisorAliceProjectRegistry {
  const defaultProject = config.defaultProject ?? 'default'
  const names = [
    'default',
    ...Object.keys(config.projects ?? {})
      .filter((name) => name !== 'default')
      .sort(),
  ]
  const machineConfig: MachineSupervisorConfig = {
    defaultProject: config.defaultProject,
    defaults: config.defaults,
  }
  const projects = names.map((name) => {
      const resolved = resolveLaunchContext({
        flags: { project: name },
        machineConfig,
        projectConfig: config.projects?.[name],
        env: {},
        cwd: options.cwd,
        homeDir: options.homeDir,
        platform: options.platform,
      })
      return {
        id: resolved.aliceProject.id,
        key: name,
        displayName: resolved.aliceProject.displayName,
        home: resolved.home,
        port: resolved.port,
        portAutomatic: resolved.provenance.port.source === 'default',
        isDefault: name === defaultProject,
      }
    })
  return { defaultProject, projects }
}

function resolveConfiguredHome(
  project: string,
  home: string,
  options: Pick<PersistAliceProjectConfigOptions, 'cwd' | 'homeDir' | 'platform'>,
): string {
  return resolveLaunchContext({
    flags: { project, home },
    env: {},
    cwd: options.cwd,
    homeDir: options.homeDir,
    platform: options.platform,
  }).home
}

async function assertRegistryHomesSeparate(
  config: SupervisorConfigDocument,
  options: Pick<PersistAliceProjectConfigOptions, 'cwd' | 'homeDir' | 'platform'>,
): Promise<void> {
  const registry = buildAliceProjectRegistry(config, options)
  const homes = await Promise.all(registry.projects.map(async (entry) => ({
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
          `Complete home ${right.home} for AliceProject "${right.displayName}" overlaps AliceProject "${left.displayName}" at ${left.home}. Choose a separate directory.`,
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
  project: string,
): Promise<void> {
  try {
    const info = await stat(path)
    if (!info.isDirectory()) {
      throw configError(
        `Registered complete home ${path} for AliceProject "${project}" is not a directory.`,
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
      `Registered complete home ${path} for AliceProject "${project}" ${missing}. Reconnect it or choose another AliceProject.`,
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
  preserveUnknown = false,
): LaunchConfigValues | AliceProjectLaunchConfig {
  const record = requireRecord(value, label)
  const allowed = allowName
    ? LAUNCH_VALUE_KEYS
    : new Set([...LAUNCH_VALUE_KEYS].filter((key) => key !== 'name' && key !== 'product'))
  if (!preserveUnknown) {
    rejectUnknownKeys(record, allowed, label)
  }
  const result: AliceProjectLaunchConfig = {}
  if (allowName && record['name'] !== undefined) {
    result.name = requireProjectKey(record['name'], `${label}.name`)
  }
  if (allowName && record['displayName'] !== undefined) {
    result.displayName = requireDisplayName(record['displayName'], `${label}.displayName`)
  }
  if (allowName && record['product'] !== undefined) {
    const product = parseAliceProjectProduct(record['product'])
    if (!product) {
      throw configError(`${label}.product must be "trader" or "nano".`)
    }
    if (product === 'nano') result.product = product
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
  return preserveUnknown
    ? retainUnknownFields(result, record, allowed)
    : result
}

function assertCurrentSupervisorSchemaVersion(value: unknown): asserts value is 2 {
  if (isNewerSupervisorSchemaVersion(value)) {
    throw configError(
      `Supervisor configuration schemaVersion ${value} is newer than this OpenAlice (supports ${CONFIG_SCHEMA_VERSION}). Update OpenAlice to read this AliceProject configuration.`,
      'ESUPERVISORSCHEMA',
    )
  }
  if (value !== CONFIG_SCHEMA_VERSION) {
    throw configError(
      `Supervisor configuration schemaVersion must be ${CONFIG_SCHEMA_VERSION}.`,
    )
  }
}

export function isNewerSupervisorSchemaVersion(value: unknown): value is number {
  return typeof value === 'number'
    && Number.isInteger(value)
    && value > CONFIG_SCHEMA_VERSION
}

export function isNewerSupervisorSchemaError(error: unknown): boolean {
  return isTaggedError(error, 'ESUPERVISORSCHEMA')
}

export function isSupervisorConfigError(error: unknown): boolean {
  return isTaggedError(error, 'ESUPERVISORCONFIG')
    || isNewerSupervisorSchemaError(error)
}

function retainUnknownFields<T extends object>(
  parsed: T,
  source: Record<string, unknown>,
  known: Set<string>,
): T {
  const extras: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(source)) {
    if (!known.has(key)) extras[key] = value
  }
  return Object.keys(extras).length === 0
    ? parsed
    : { ...parsed, ...extras }
}

function optionalProjectKey(
  value: unknown,
  label: string,
): string | undefined {
  return value === undefined ? undefined : requireProjectKey(value, label)
}

function requireProjectKey(value: unknown, label: string): string {
  const name = requireNonEmptyString(value, label)
  if (!PROJECT_KEY_PATTERN.test(name)) {
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

function requireDisplayName(value: unknown, label: string): string {
  const displayName = requireNonEmptyString(value, label).trim()
  if (displayName.length > 80) {
    throw configError(`${label} must contain at most 80 characters.`)
  }
  return displayName
}

function humanizeProjectKey(value: string): string {
  if (value === 'default') return 'Default AliceProject'
  return value
    .split(/[-_]+/u)
    .filter(Boolean)
    .map((part) => `${part[0]?.toUpperCase() ?? ''}${part.slice(1)}`)
    .join(' ')
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
  return isSupervisorConfigError(error)
}

function isTaggedError(error: unknown, code: string): boolean {
  return error instanceof Error
    && 'code' in error
    && error.code === code
}

function isNodeError(error: unknown, code: string): boolean {
  return error instanceof Error
    && 'code' in error
    && error.code === code
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
