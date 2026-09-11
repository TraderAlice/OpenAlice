import { homedir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'

import {
  aliceProjectEnvironment,
  resolveAliceProjectIdentity,
  type AliceProjectIdentity,
} from './alice-project.ts'
import {
  buildExternalAgentRuntimeEnvironment,
  isBunStandalone,
  resolveBunContentIdentity,
  resolveBunResourceRoot,
} from './bun-standalone.mjs'

const PROJECT_KEY_PATTERN = /^[a-z][a-z0-9_-]{0,31}$/
const DEFAULT_PORT = 47_331

export type LaunchValueSource =
  | 'default'
  | 'installed-runtime'
  | 'machine-config'
  | 'project-config'
  | 'environment'
  | 'cli-flag'
  | 'derived'

export interface LaunchValueProvenance {
  source: LaunchValueSource
  detail: string
}

export interface LaunchConfigValues {
  home?: string
  port?: number
  appDir?: string | null
  updateChecks?: boolean
}

export interface MachineSupervisorConfig {
  defaultProject?: string
  /** @deprecated Released config boundary only. */
  defaultInstance?: string
  defaults?: LaunchConfigValues
}

export interface AliceProjectLaunchConfig extends LaunchConfigValues {
  name?: string
  displayName?: string
  /** Immutable product birth. Omitted means trader. */
  product?: 'trader' | 'nano'
}

export interface TuiLaunchFlags extends LaunchConfigValues {
  project?: string
  /** @deprecated Accepted for released CLI compatibility. */
  instance?: string
}

export interface ResolvedLaunchContext {
  project: string
  aliceProject: AliceProjectIdentity
  home: string
  port: number
  appDir: string | null
  runtimeProvider: {
    kind: 'source' | 'bundle' | 'bun'
    contentIdentity: string | null
  }
  updateChecks: boolean
  supervisorRoot: string
  managedPi: {
    codingAgentDir: string
    sessionDir: string
  }
  provenance: {
    project: LaunchValueProvenance
    home: LaunchValueProvenance
    port: LaunchValueProvenance
    appDir: LaunchValueProvenance
    updateChecks: LaunchValueProvenance
    supervisorRoot: LaunchValueProvenance
    managedPi: LaunchValueProvenance
  }
}

export interface ResolveLaunchContextOptions {
  flags?: TuiLaunchFlags
  machineConfig?: MachineSupervisorConfig | null
  projectConfig?: AliceProjectLaunchConfig | null
  env?: NodeJS.ProcessEnv
  cwd?: string
  homeDir?: string
  platform?: NodeJS.Platform
}

export interface ResolveSupervisorRootOptions {
  env?: NodeJS.ProcessEnv
  cwd?: string
  homeDir?: string
  platform?: NodeJS.Platform
}

interface Candidate<T> {
  value: T
  provenance: LaunchValueProvenance
}

export function resolveLaunchContext(
  options: ResolveLaunchContextOptions = {},
): ResolvedLaunchContext {
  const env = options.env ?? process.env
  const cwd = options.cwd ?? process.cwd()
  const homeDir = options.homeDir ?? homedir()
  const platform = options.platform ?? process.platform
  const flags = options.flags ?? {}
  const machine = options.machineConfig ?? {}
  const projectConfig = options.projectConfig ?? {}

  const project = resolveProject(flags, env, machine)
  if (projectConfig.name !== undefined && projectConfig.name !== project.value) {
    throw launchContextError(
      'EPROJECTCONFIG',
      `AliceProject config "${projectConfig.name}" does not match selected project "${project.value}".`,
    )
  }

  const supervisorRoot = resolveSupervisorRootCandidate(env, homeDir, platform, cwd)
  const home = resolveField<string>(
    candidate(join(homeDir, '.openalice'), 'default', '~/.openalice'),
    pathCandidate(machine.defaults?.home, 'machine-config', 'machine.defaults.home', cwd, homeDir),
    pathCandidate(projectConfig.home, 'project-config', `project.${project.value}.home`, cwd, homeDir),
    pathCandidate(env['OPENALICE_HOME'], 'environment', 'OPENALICE_HOME', cwd, homeDir),
    pathCandidate(flags.home, 'cli-flag', '--home', cwd, homeDir),
  )
  if (
    project.value !== 'default'
    && home.provenance.source !== 'project-config'
    && home.provenance.source !== 'environment'
    && home.provenance.source !== 'cli-flag'
  ) {
    throw launchContextError(
      'EPROJECTHOME',
      `AliceProject "${project.value}" needs an explicit complete home in project config, OPENALICE_HOME, or --home.`,
    )
  }

  const port = resolveField<number>(
    candidate(DEFAULT_PORT, 'default', String(DEFAULT_PORT)),
    numberCandidate(machine.defaults?.port, 'machine-config', 'machine.defaults.port'),
    numberCandidate(projectConfig.port, 'project-config', `project.${project.value}.port`),
    env['OPENALICE_WEB_PORT'] === undefined
      ? undefined
      : candidate(parsePort(env['OPENALICE_WEB_PORT'], 'OPENALICE_WEB_PORT'), 'environment', 'OPENALICE_WEB_PORT'),
    numberCandidate(flags.port, 'cli-flag', '--port'),
  )
  const appDir = resolveField<string | null>(
    candidate(null, 'default', 'current working directory discovery'),
    nullablePathCandidate(
      env['OPENALICE_MANAGED_RUNTIME_PATH'],
      'installed-runtime',
      'installed OpenAlice Runtime',
      cwd,
      homeDir,
    ),
    nullablePathCandidate(machine.defaults?.appDir, 'machine-config', 'machine.defaults.appDir', cwd, homeDir),
    nullablePathCandidate(projectConfig.appDir, 'project-config', `project.${project.value}.appDir`, cwd, homeDir),
    nullablePathCandidate(env['OPENALICE_APP_HOME'], 'environment', 'OPENALICE_APP_HOME', cwd, homeDir),
    nullablePathCandidate(flags.appDir, 'cli-flag', '--app-dir', cwd, homeDir),
  )
  const updateChecks = resolveField<boolean>(
    candidate(true, 'default', 'enabled'),
    booleanCandidate(machine.defaults?.updateChecks, 'machine-config', 'machine.defaults.updateChecks'),
    booleanCandidate(projectConfig.updateChecks, 'project-config', `project.${project.value}.updateChecks`),
    env['OPENALICE_NO_UPDATE_CHECK'] === undefined
      ? undefined
      : candidate(
          !parseBoolean(env['OPENALICE_NO_UPDATE_CHECK'], 'OPENALICE_NO_UPDATE_CHECK'),
          'environment',
          'OPENALICE_NO_UPDATE_CHECK',
        ),
    booleanCandidate(flags.updateChecks, 'cli-flag', flags.updateChecks ? '--update-check' : '--no-update-check'),
  )

  const managedPiRoot = join(home.value, 'runtime', 'pi')
  const bunStandalone = isBunStandalone()
  const selectedAppDir = bunStandalone
    ? resolveBunResourceRoot(env)
    : appDir.value
  const runtimeProvider = bunStandalone
    ? {
        kind: 'bun' as const,
        contentIdentity: resolveBunContentIdentity(selectedAppDir!, env),
      }
    : appDir.provenance.source === 'installed-runtime'
    ? {
        kind: 'bundle' as const,
        contentIdentity: parseRuntimeContentIdentity(
          env['OPENALICE_MANAGED_RUNTIME_CONTENT_IDENTITY'],
        ),
      }
    : {
        kind: 'source' as const,
        contentIdentity: null,
      }
  return deepFreeze({
    project: project.value,
    aliceProject: resolveAliceProjectIdentity({
      home: home.value,
      appRoot: selectedAppDir,
      env,
      key: project.value,
      displayName: projectConfig.displayName,
    }),
    home: home.value,
    port: port.value,
    appDir: selectedAppDir,
    runtimeProvider,
    updateChecks: updateChecks.value,
    supervisorRoot: supervisorRoot.value,
    managedPi: {
      codingAgentDir: managedPiRoot,
      sessionDir: join(managedPiRoot, 'sessions'),
    },
    provenance: {
      project: project.provenance,
      home: home.provenance,
      port: port.provenance,
      appDir: appDir.provenance,
      updateChecks: updateChecks.provenance,
      supervisorRoot: supervisorRoot.provenance,
      managedPi: {
        source: 'derived',
        detail: 'selected complete home/runtime/pi',
      },
    },
  })
}

export function resolveSupervisorRootPath(
  options: ResolveSupervisorRootOptions = {},
): string {
  return resolveSupervisorRootCandidate(
    options.env ?? process.env,
    options.homeDir ?? homedir(),
    options.platform ?? process.platform,
    options.cwd ?? process.cwd(),
  ).value
}

export function buildManagedPiEnv(
  context: ResolvedLaunchContext,
  baseEnv: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  if (context.runtimeProvider.kind === 'bun') {
    return buildExternalAgentRuntimeEnvironment(baseEnv)
  }
  return buildManagedPiEnvForHome(context.home, baseEnv)
}

export function buildAliceProjectEnv(
  context: ResolvedLaunchContext,
  baseEnv: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  return {
    ...baseEnv,
    ...aliceProjectEnvironment(context.aliceProject),
  }
}

export function buildManagedPiEnvForHome(
  home: string,
  baseEnv: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  if (!baseEnv['OPENALICE_MANAGED_PI_PATH']?.trim()) {
    return { ...baseEnv }
  }
  const managedPiRoot = join(home, 'runtime', 'pi')
  return {
    ...baseEnv,
    PI_CODING_AGENT_DIR: managedPiRoot,
    PI_CODING_AGENT_SESSION_DIR: join(managedPiRoot, 'sessions'),
  }
}

export function parseTuiLaunchArgs(argv: string[]): TuiLaunchFlags {
  const flags: TuiLaunchFlags = {}
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--project') {
      flags.project = requireValue(argv, ++index, arg)
    } else if (arg === '--instance') {
      flags.instance = requireValue(argv, ++index, arg)
    } else if (arg === '--home') {
      flags.home = requireValue(argv, ++index, arg)
    } else if (arg === '--port') {
      flags.port = parsePort(requireValue(argv, ++index, arg), arg)
    } else if (arg === '--app-dir') {
      flags.appDir = requireValue(argv, ++index, arg)
    } else if (arg === '--no-update-check') {
      flags.updateChecks = false
    } else if (arg === '--update-check') {
      flags.updateChecks = true
    } else {
      throw launchContextError(
        'EUSAGE',
        arg?.startsWith('-') ? `Unknown TUI option: ${arg}` : `Unexpected TUI argument: ${arg}`,
        2,
      )
    }
  }
  return flags
}

function resolveProject(
  flags: TuiLaunchFlags,
  env: NodeJS.ProcessEnv,
  machine: MachineSupervisorConfig,
): Candidate<string> {
  const selected = resolveField<string>(
    candidate('default', 'default', 'implicit default AliceProject'),
    stringCandidate(machine.defaultProject ?? machine.defaultInstance, 'machine-config', 'machine.defaultProject'),
    stringCandidate(env['OPENALICE_INSTANCE'], 'environment', 'OPENALICE_INSTANCE'),
    stringCandidate(env['OPENALICE_PROJECT'], 'environment', 'OPENALICE_PROJECT'),
    stringCandidate(flags.instance, 'cli-flag', '--instance'),
    stringCandidate(flags.project, 'cli-flag', '--project'),
  )
  if (!PROJECT_KEY_PATTERN.test(selected.value)) {
    throw launchContextError(
      'EPROJECTNAME',
      `Invalid AliceProject "${selected.value}". Use a lowercase key beginning with a letter and containing only letters, numbers, "_" or "-".`,
    )
  }
  return selected
}

function resolveSupervisorRootCandidate(
  env: NodeJS.ProcessEnv,
  homeDir: string,
  platform: NodeJS.Platform,
  cwd: string,
): Candidate<string> {
  if (env['OPENALICE_SUPERVISOR_HOME']) {
    return candidate(
      resolveUserPath(env['OPENALICE_SUPERVISOR_HOME'], cwd, homeDir),
      'environment',
      'OPENALICE_SUPERVISOR_HOME',
    )
  }
  if (platform === 'win32') {
    const localAppData = env['LOCALAPPDATA']
    const root = localAppData
      ? resolveUserPath(localAppData, cwd, homeDir)
      : join(homeDir, 'AppData', 'Local')
    return candidate(join(root, 'OpenAlice', 'Supervisor'), 'default', 'platform user config directory')
  }
  if (platform === 'darwin') {
    return candidate(
      join(homeDir, 'Library', 'Application Support', 'OpenAlice', 'Supervisor'),
      'default',
      'platform user config directory',
    )
  }
  const xdg = env['XDG_CONFIG_HOME']
    ? resolveUserPath(env['XDG_CONFIG_HOME'], cwd, homeDir)
    : join(homeDir, '.config')
  return candidate(join(xdg, 'openalice'), 'default', 'platform user config directory')
}

function resolveField<T>(
  fallback: Candidate<T>,
  ...overrides: Array<Candidate<T> | undefined>
): Candidate<T> {
  return overrides.reduce<Candidate<T>>(
    (resolved, next) => next ?? resolved,
    fallback,
  )
}

function candidate<T>(
  value: T,
  source: LaunchValueSource,
  detail: string,
): Candidate<T> {
  return { value, provenance: { source, detail } }
}

function stringCandidate(
  value: string | undefined,
  source: LaunchValueSource,
  detail: string,
): Candidate<string> | undefined {
  return value === undefined ? undefined : candidate(value, source, detail)
}

function numberCandidate(
  value: number | undefined,
  source: LaunchValueSource,
  detail: string,
): Candidate<number> | undefined {
  return value === undefined ? undefined : candidate(parsePort(value, detail), source, detail)
}

function booleanCandidate(
  value: boolean | undefined,
  source: LaunchValueSource,
  detail: string,
): Candidate<boolean> | undefined {
  return value === undefined ? undefined : candidate(value, source, detail)
}

function pathCandidate(
  value: string | undefined,
  source: LaunchValueSource,
  detail: string,
  cwd: string,
  homeDir: string,
): Candidate<string> | undefined {
  return value === undefined
    ? undefined
    : candidate(resolveUserPath(value, cwd, homeDir), source, detail)
}

function nullablePathCandidate(
  value: string | null | undefined,
  source: LaunchValueSource,
  detail: string,
  cwd: string,
  homeDir: string,
): Candidate<string | null> | undefined {
  if (value === undefined) return undefined
  return candidate(value === null ? null : resolveUserPath(value, cwd, homeDir), source, detail)
}

function resolveUserPath(value: string, cwd: string, homeDir: string): string {
  if (value === '~') return homeDir
  if (value.startsWith('~/') || value.startsWith('~\\')) {
    return resolve(homeDir, value.slice(2))
  }
  return isAbsolute(value) ? resolve(value) : resolve(cwd, value)
}

function parsePort(value: string | number, label: string): number {
  const port = typeof value === 'number' ? value : Number(value)
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw launchContextError('EPORT', `${label} must be an integer between 1 and 65535.`)
  }
  return port
}

function parseBoolean(value: string, label: string): boolean {
  if (value === '1' || value === 'true') return true
  if (value === '0' || value === 'false') return false
  throw launchContextError('EBOOLEAN', `${label} must be one of 1, 0, true, or false.`)
}

function parseRuntimeContentIdentity(value: string | undefined): string {
  const identity = value?.trim()
  if (!identity || !/^[a-f0-9]{16}$/.test(identity)) {
    throw launchContextError(
      'ERUNTIMEIDENTITY',
      'OPENALICE_MANAGED_RUNTIME_CONTENT_IDENTITY must be the 16-character lowercase identity paired with OPENALICE_MANAGED_RUNTIME_PATH.',
    )
  }
  return identity
}

function requireValue(argv: string[], index: number, flag: string): string {
  const value = argv[index]
  if (!value || value.startsWith('--')) {
    throw launchContextError('EUSAGE', `${flag} requires a value`, 2)
  }
  return value
}

function launchContextError(
  code: string,
  message: string,
  exitCode = 1,
): Error & { code: string; exitCode: number } {
  return Object.assign(new Error(message), { code, exitCode })
}

function deepFreeze<T extends object>(value: T): T {
  for (const child of Object.values(value)) {
    if (child && typeof child === 'object' && !Object.isFrozen(child)) {
      deepFreeze(child)
    }
  }
  return Object.freeze(value)
}
