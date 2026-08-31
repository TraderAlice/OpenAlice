/**
 * Secret-free Machine -> AliceProject inventory shared by the CLI and TUI.
 *
 * A remote inventory is collected with one SSH command. The remote CLI reads
 * its own Supervisor registry; the local process never scans arbitrary remote
 * directories or asks for one SSH connection per AliceProject.
 */
import { access, readFile } from 'node:fs/promises'
import { hostname } from 'node:os'

import { readAliceProjectProduct, type AliceProjectProduct } from './alice-project-product.ts'
import { CLI_VERSION } from './install-source.mjs'
import { resolveSupervisorRootPath, type ResolveSupervisorRootOptions } from './launch-context.ts'
import { inspectRuntime } from './lifecycle.mjs'
import type { RegisteredMachine } from './machine-registry.ts'
import {
  readMachineRegistrySummary,
  type MachineRegistrySummary,
} from './machine-registry.ts'
import { runSshCommand } from './remote.mjs'
import {
  readSupervisorAliceProjectRegistry,
  type SupervisorAliceProjectRegistry,
} from './supervisor-config.ts'

export const MACHINE_INVENTORY_SCHEMA_VERSION = 1

export type MachineConnectionState =
  | 'local'
  | 'checking'
  | 'online'
  | 'offline'
  | 'unauthorized'
  | 'incompatible'

export interface ProjectRuntimeSummary {
  class: string
  state: string
  ownerSurface: string | null
  uptimeSeconds: number | null
  webEndpoint: string | null
  components: Record<string, string>
}

export interface MachineProjectInventory {
  key: string
  id: string
  displayName: string
  home: string
  port: number
  portAutomatic: boolean
  product: AliceProjectProduct
  isDefault: boolean
  available: boolean
  runtime: ProjectRuntimeSummary
}

export interface MachineInventory {
  key: string
  displayName: string
  registered: boolean
  connection: MachineConnectionState
  sshTarget: string | null
  platform: string | null
  arch: string | null
  hostname: string | null
  cliVersion: string | null
  defaultProject: string | null
  projects: MachineProjectInventory[]
  capabilities: {
    inspect: boolean
    lifecycle: boolean
    openTunnel: boolean
    transferReceive: boolean
    credentialReseal: boolean
  }
  issue: { code: string; message: string } | null
}

export interface MachineInspectEnvelope {
  schemaVersion: 1
  generatedAt: string
  machine: MachineInventory
}

export interface MachineFleetEnvelope {
  schemaVersion: 1
  generatedAt: string
  machines: MachineInventory[]
}

export interface MachineInventoryOptions extends ResolveSupervisorRootOptions {
  supervisorRoot?: string
  machineKey?: string
  displayName?: string
  now?: () => Date
  hostname?: () => string
  platform?: NodeJS.Platform
  arch?: string
  cliVersion?: string
  loadRegistry?: (
    context: { supervisorRoot: string },
  ) => Promise<SupervisorAliceProjectRegistry>
  loadMachineRegistry?: () => Promise<MachineRegistrySummary>
  readProduct?: (home: string) => Promise<AliceProjectProduct>
  inspectRuntime?: (
    options: { homeRoot: string; waitMs: number },
  ) => Promise<unknown>
  checkHome?: (home: string) => Promise<void>
  runRemote?: (
    options: {
      destination: string
      sshPort: number | null
      identityFile: string | null
      batchMode?: boolean
    },
    command: string,
    dependencies?: Record<string, unknown>,
  ) => Promise<string>
}

const REMOTE_INVENTORY_COMMAND = `set -eu
cli=$(command -v openalice 2>/dev/null || { [ ! -x "$HOME/.openalice/bin/openalice" ] || printf '%s\\n' "$HOME/.openalice/bin/openalice"; })
[ -n "$cli" ] || { printf '%s\\n' 'OpenAlice CLI is not installed' >&2; exit 127; }
exec "$cli" machine inspect local --json`

const NULL_OUTPUT = Object.freeze({ write: (_chunk: string): void => undefined })

export async function inspectLocalMachine(
  options: MachineInventoryOptions = {},
): Promise<MachineInspectEnvelope> {
  const supervisorRoot = options.supervisorRoot ?? resolveSupervisorRootPath(options)
  const registry = await (
    options.loadRegistry
    ?? ((context) => readSupervisorAliceProjectRegistry(context, options))
  )({ supervisorRoot })
  const projects = await Promise.all(
    registry.projects.map((project) => inspectProject(project, options)),
  )
  return {
    schemaVersion: MACHINE_INVENTORY_SCHEMA_VERSION,
    generatedAt: (options.now?.() ?? new Date()).toISOString(),
    machine: {
      key: options.machineKey ?? 'local',
      displayName: options.displayName ?? 'This computer',
      registered: true,
      connection: 'local',
      sshTarget: null,
      platform: options.platform ?? process.platform,
      arch: options.arch ?? process.arch,
      hostname: (options.hostname ?? hostname)(),
      cliVersion: options.cliVersion ?? await readCliVersion(),
      defaultProject: registry.defaultProject,
      projects,
      capabilities: currentMachineCapabilities(),
      issue: null,
    },
  }
}

export async function inspectRegisteredMachine(
  machine: RegisteredMachine,
  options: MachineInventoryOptions = {},
): Promise<MachineInventory> {
  const runRemote = options.runRemote ?? runSshCommand
  try {
    const output = await runRemote({
      destination: machine.sshTarget,
      sshPort: machine.sshPort ?? null,
      identityFile: machine.identityFile ?? null,
      batchMode: true,
    }, REMOTE_INVENTORY_COMMAND, {
      stdout: NULL_OUTPUT,
      stderr: NULL_OUTPUT,
    })
    const remote = parseMachineInspectEnvelope(output)
    return {
      ...remote.machine,
      key: machine.key,
      displayName: machine.displayName,
      registered: true,
      connection: 'online',
      sshTarget: machine.sshTarget,
      issue: null,
    }
  } catch (error: unknown) {
    const classified = classifyRemoteInventoryError(error)
    return unavailableMachine(machine, classified.connection, classified.code, classified.message)
  }
}

export async function seedMachineFleet(
  options: MachineInventoryOptions = {},
): Promise<MachineFleetEnvelope> {
  const [local, registry] = await Promise.all([
    inspectLocalMachine(options),
    (options.loadMachineRegistry ?? (() => readMachineRegistrySummary(options)))(),
  ])
  return {
    schemaVersion: MACHINE_INVENTORY_SCHEMA_VERSION,
    generatedAt: local.generatedAt,
    machines: [
      local.machine,
      ...registry.machines.map(registeredMachinePlaceholder),
    ],
  }
}

export async function inspectMachineFleet(
  options: MachineInventoryOptions = {},
): Promise<MachineFleetEnvelope> {
  const registry = await (
    options.loadMachineRegistry ?? (() => readMachineRegistrySummary(options))
  )()
  const [local, remotes] = await Promise.all([
    inspectLocalMachine(options),
    mapWithConcurrency(registry.machines, 4, (machine) => (
      inspectRegisteredMachine(machine, options)
    )),
  ])
  return {
    schemaVersion: MACHINE_INVENTORY_SCHEMA_VERSION,
    generatedAt: local.generatedAt,
    machines: [local.machine, ...remotes],
  }
}

export function registeredMachinePlaceholder(machine: RegisteredMachine): MachineInventory {
  return {
    key: machine.key,
    displayName: machine.displayName,
    registered: true,
    connection: 'checking',
    sshTarget: machine.sshTarget,
    platform: null,
    arch: null,
    hostname: null,
    cliVersion: null,
    defaultProject: null,
    projects: [],
    capabilities: {
      inspect: false,
      lifecycle: false,
      openTunnel: false,
      transferReceive: false,
      credentialReseal: false,
    },
    issue: { code: 'ECHECKING', message: 'Checking SSH reachability…' },
  }
}

export function parseMachineInspectEnvelope(text: string): MachineInspectEnvelope {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    throw inventoryError('EINCOMPATIBLEINVENTORY', 'Remote OpenAlice returned invalid inventory JSON.')
  }
  if (!isRecord(value) || value['schemaVersion'] !== MACHINE_INVENTORY_SCHEMA_VERSION) {
    throw inventoryError(
      'EINCOMPATIBLEINVENTORY',
      'Remote OpenAlice uses an incompatible Machine inventory schema.',
    )
  }
  if (
    typeof value['generatedAt'] !== 'string'
    || Number.isNaN(Date.parse(value['generatedAt']))
    || !isMachineInventory(value['machine'])
  ) {
    throw inventoryError('EINCOMPATIBLEINVENTORY', 'Remote OpenAlice returned an invalid Machine inventory.')
  }
  return value as unknown as MachineInspectEnvelope
}

async function inspectProject(
  project: SupervisorAliceProjectRegistry['projects'][number],
  options: MachineInventoryOptions,
): Promise<MachineProjectInventory> {
  const checkHome = options.checkHome ?? ((home: string) => access(home))
  const readProduct = options.readProduct ?? readAliceProjectProduct
  const inspect = options.inspectRuntime ?? ((runtimeOptions) => inspectRuntime(runtimeOptions))
  let available = true
  try {
    await checkHome(project.home)
  } catch {
    available = false
  }
  const [product, runtime] = await Promise.all([
    available ? readProduct(project.home).catch(() => 'trader' as const) : Promise.resolve('trader' as const),
    inspect({ homeRoot: project.home, waitMs: 750 }).catch((error: unknown) => ({
      class: 'unhealthy',
      state: 'unknown',
      owner: null,
      detail: error instanceof Error ? error.message : String(error),
    })),
  ])
  return {
    key: project.key,
    id: project.id,
    displayName: project.displayName,
    home: project.home,
    port: project.port,
    portAutomatic: project.portAutomatic,
    product,
    isDefault: project.isDefault,
    available,
    runtime: sanitizeRuntime(runtime),
  }
}

function sanitizeRuntime(value: unknown): ProjectRuntimeSummary {
  if (!isRecord(value)) return emptyRuntimeSummary()
  const owner = isRecord(value['owner']) ? value['owner'] : null
  const endpoints = isRecord(value['endpoints']) ? value['endpoints'] : null
  const components = isRecord(value['components']) ? value['components'] : null
  return {
    class: typeof value['class'] === 'string' ? value['class'] : 'unhealthy',
    state: typeof value['state'] === 'string' ? value['state'] : 'unknown',
    ownerSurface: typeof owner?.['surface'] === 'string' ? owner['surface'] : null,
    uptimeSeconds: typeof value['uptimeSeconds'] === 'number' && value['uptimeSeconds'] >= 0
      ? value['uptimeSeconds']
      : null,
    webEndpoint: typeof endpoints?.['web'] === 'string' ? endpoints['web'] : null,
    components: components
      ? Object.fromEntries(Object.entries(components).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
      : {},
  }
}

function isMachineInventory(value: unknown): value is MachineInventory {
  if (!isRecord(value) || !Array.isArray(value['projects'])) return false
  const capabilities = value['capabilities']
  return isSelector(value['key'])
    && isSafeText(value['displayName'], 80)
    && typeof value['registered'] === 'boolean'
    && ['local', 'checking', 'online', 'offline', 'unauthorized', 'incompatible'].includes(String(value['connection']))
    && (value['sshTarget'] === null || isSafeText(value['sshTarget'], 255))
    && (value['platform'] === null || isSafeText(value['platform'], 32))
    && (value['arch'] === null || isSafeText(value['arch'], 32))
    && (value['hostname'] === null || isSafeText(value['hostname'], 255))
    && (value['cliVersion'] === null || isSafeText(value['cliVersion'], 128))
    && (value['defaultProject'] === null || isSelector(value['defaultProject']))
    && value['projects'].every(isProjectInventory)
    && isRecord(capabilities)
    && ['inspect', 'lifecycle', 'openTunnel', 'transferReceive', 'credentialReseal']
      .every((key) => typeof capabilities[key] === 'boolean')
    && (value['issue'] === null || (
      isRecord(value['issue'])
      && isSafeText(value['issue']['code'], 64)
      && isSafeText(value['issue']['message'], 512)
    ))
}

function isProjectInventory(value: unknown): boolean {
  return isRecord(value)
    && isSelector(value['key'])
    && isSafeText(value['id'], 128)
    && isSafeText(value['displayName'], 80)
    && isSafeText(value['home'], 4096)
    && typeof value['port'] === 'number'
    && typeof value['portAutomatic'] === 'boolean'
    && (value['product'] === 'trader' || value['product'] === 'nano')
    && typeof value['isDefault'] === 'boolean'
    && typeof value['available'] === 'boolean'
    && isRuntimeSummary(value['runtime'])
}

function isRuntimeSummary(value: unknown): boolean {
  return isRecord(value)
    && isSafeText(value['class'], 64)
    && isSafeText(value['state'], 64)
    && (value['ownerSurface'] === null || isSafeText(value['ownerSurface'], 64))
    && (value['uptimeSeconds'] === null || typeof value['uptimeSeconds'] === 'number')
    && (value['webEndpoint'] === null || isLoopbackWebEndpoint(value['webEndpoint']))
    && isRecord(value['components'])
    && Object.entries(value['components']).every(([key, entry]) => isSafeText(key, 64) && isSafeText(entry, 64))
}

function isSelector(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z][a-z0-9_-]{0,31}$/.test(value)
}

function isSafeText(value: unknown, maxLength: number): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= maxLength
    && !/[\u0000-\u001f\u007f]/u.test(value)
}

function isLoopbackWebEndpoint(value: unknown): value is string {
  if (!isSafeText(value, 256)) return false
  try {
    const url = new URL(value)
    return url.protocol === 'http:'
      && url.hostname === '127.0.0.1'
      && url.username === ''
      && url.password === ''
  } catch {
    return false
  }
}

function classifyRemoteInventoryError(error: unknown): {
  connection: Exclude<MachineConnectionState, 'local' | 'online'>
  code: string
  message: string
} {
  if (isRecord(error) && error['code'] === 'EINCOMPATIBLEINVENTORY') {
    return { connection: 'incompatible', code: 'EINCOMPATIBLE', message: errorMessage(error) }
  }
  const detail = `${errorMessage(error)} ${isRecord(error) && typeof error['stderr'] === 'string' ? error['stderr'] : ''}`
  if (/permission denied|authentication failed|publickey/i.test(detail)) {
    return { connection: 'unauthorized', code: 'ESSHAUTH', message: 'SSH authentication was rejected.' }
  }
  if (/not installed|not found|exit 127/i.test(detail)) {
    return { connection: 'incompatible', code: 'ECLIMISSING', message: 'A compatible OpenAlice CLI is not installed on the remote machine.' }
  }
  return { connection: 'offline', code: 'ESSHUNAVAILABLE', message: 'The machine could not be reached over SSH.' }
}

function unavailableMachine(
  machine: RegisteredMachine,
  connection: Exclude<MachineConnectionState, 'local' | 'online'>,
  code: string,
  message: string,
): MachineInventory {
  return {
    key: machine.key,
    displayName: machine.displayName,
    registered: true,
    connection,
    sshTarget: machine.sshTarget,
    platform: null,
    arch: null,
    hostname: null,
    cliVersion: null,
    defaultProject: null,
    projects: [],
    capabilities: {
      inspect: false,
      lifecycle: false,
      openTunnel: false,
      transferReceive: false,
      credentialReseal: false,
    },
    issue: { code, message },
  }
}

function currentMachineCapabilities(): MachineInventory['capabilities'] {
  return {
    inspect: true,
    lifecycle: true,
    openTunnel: true,
    transferReceive: true,
    credentialReseal: true,
  }
}

function emptyRuntimeSummary(): ProjectRuntimeSummary {
  return {
    class: 'unhealthy',
    state: 'unknown',
    ownerSurface: null,
    uptimeSeconds: null,
    webEndpoint: null,
    components: {},
  }
}

async function readCliVersion(): Promise<string> {
  return CLI_VERSION
}

async function mapWithConcurrency<T, R>(
  values: T[],
  limit: number,
  operation: (value: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length)
  let next = 0
  async function worker(): Promise<void> {
    while (next < values.length) {
      const index = next++
      results[index] = await operation(values[index] as T)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, () => worker()))
  return results
}

function inventoryError(code: string, message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
