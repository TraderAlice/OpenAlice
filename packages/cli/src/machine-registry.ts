/**
 * Machine-wide registry for SSH hosts shown by the Supervisor fleet.
 *
 * This document lives beneath the Supervisor root, outside every selectable
 * AliceProject home. It stores only OpenSSH connection metadata; credentials,
 * private-key bytes, host keys, and remote project state never belong here.
 */
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'

import {
  resolveSupervisorRootPath,
  type ResolveSupervisorRootOptions,
} from './launch-context.ts'

const MACHINE_SCHEMA_VERSION = 1
const MACHINE_FILE_NAME = 'machines.json'
const MACHINE_KEY_PATTERN = /^[a-z][a-z0-9_-]{0,31}$/
const ROOT_KEYS = new Set(['schemaVersion', 'defaultMachine', 'machines'])
const MACHINE_KEYS = new Set([
  'displayName',
  'sshTarget',
  'sshPort',
  'identityFile',
])

export interface StoredMachineConfig {
  displayName: string
  sshTarget: string
  sshPort?: number
  identityFile?: string
  [key: string]: unknown
}

export interface MachineRegistryDocument {
  schemaVersion: 1
  defaultMachine?: string
  machines?: Record<string, StoredMachineConfig>
  [key: string]: unknown
}

export interface RegisteredMachine extends StoredMachineConfig {
  key: string
  isDefault: boolean
}

export interface MachineRegistrySummary {
  defaultMachine: string
  machines: RegisteredMachine[]
}

export interface MachineRegistryOptions extends ResolveSupervisorRootOptions {
  supervisorRoot?: string
}

export interface RegisterMachineInput {
  key: string
  displayName?: string
  sshTarget: string
  sshPort?: number
  identityFile?: string
}

export async function readMachineRegistry(
  options: MachineRegistryOptions = {},
): Promise<MachineRegistryDocument> {
  const path = machineRegistryPath(resolveMachineSupervisorRoot(options))
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch (error: unknown) {
    if (isNodeError(error, 'ENOENT')) {
      return { schemaVersion: MACHINE_SCHEMA_VERSION }
    }
    throw machineRegistryError(
      `Could not read machine registry at ${path}: ${errorMessage(error)}`,
    )
  }
  try {
    return parseMachineRegistry(JSON.parse(text) as unknown)
  } catch (error: unknown) {
    if (isMachineRegistryError(error)) throw error
    throw machineRegistryError(
      `Invalid machine registry at ${path}: ${errorMessage(error)}`,
    )
  }
}

export async function writeMachineRegistry(
  document: MachineRegistryDocument,
  options: MachineRegistryOptions = {},
): Promise<void> {
  const validated = parseMachineRegistry(document)
  const supervisorRoot = resolveMachineSupervisorRoot(options)
  const path = machineRegistryPath(supervisorRoot)
  const temporary = join(
    supervisorRoot,
    `.${MACHINE_FILE_NAME}.${process.pid}.${randomUUID()}.tmp`,
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
    throw machineRegistryError(
      `Could not save machine registry at ${path}: ${errorMessage(error)}`,
    )
  }
}

export async function registerMachine(
  input: RegisterMachineInput,
  options: MachineRegistryOptions = {},
): Promise<RegisteredMachine> {
  const key = requireMachineKey(input.key)
  if (key === 'local') {
    throw machineRegistryError('The implicit local machine cannot be replaced.')
  }
  const current = await readMachineRegistry(options)
  if (current.machines?.[key]) {
    throw machineRegistryError(`Machine "${key}" is already registered.`)
  }
  const machine: StoredMachineConfig = {
    displayName: normalizeDisplayName(
      input.displayName ?? humanizeMachineKey(key),
      `machines.${key}.displayName`,
    ),
    sshTarget: normalizeSshTarget(input.sshTarget),
    ...(input.sshPort === undefined
      ? {}
      : { sshPort: normalizePort(input.sshPort, `machines.${key}.sshPort`) }),
    ...(input.identityFile
      ? {
          identityFile: normalizeIdentityFile(input.identityFile, options),
        }
      : {}),
  }
  await writeMachineRegistry({
    ...current,
    schemaVersion: MACHINE_SCHEMA_VERSION,
    machines: {
      ...current.machines,
      [key]: machine,
    },
  }, options)
  return { key, ...machine, isDefault: current.defaultMachine === key }
}

export async function removeMachine(
  keyInput: string,
  options: MachineRegistryOptions = {},
): Promise<RegisteredMachine> {
  const key = requireMachineKey(keyInput)
  if (key === 'local') {
    throw machineRegistryError('The implicit local machine cannot be removed.')
  }
  const current = await readMachineRegistry(options)
  const existing = current.machines?.[key]
  if (!existing) {
    throw machineRegistryError(`Machine "${key}" is not registered.`)
  }
  const machines = { ...current.machines }
  delete machines[key]
  await writeMachineRegistry({
    ...current,
    schemaVersion: MACHINE_SCHEMA_VERSION,
    ...(current.defaultMachine === key
      ? { defaultMachine: undefined }
      : {}),
    machines: Object.keys(machines).length > 0 ? machines : undefined,
  }, options)
  return { key, ...existing, isDefault: current.defaultMachine === key }
}

export async function readMachineRegistrySummary(
  options: MachineRegistryOptions = {},
): Promise<MachineRegistrySummary> {
  const document = await readMachineRegistry(options)
  const defaultMachine = document.defaultMachine ?? 'local'
  return {
    defaultMachine,
    machines: Object.entries(document.machines ?? {})
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, machine]) => ({
        key,
        ...machine,
        isDefault: key === defaultMachine,
      })),
  }
}

export function parseMachineRegistry(value: unknown): MachineRegistryDocument {
  const root = requireRecord(value, 'Machine registry')
  if (root['schemaVersion'] !== MACHINE_SCHEMA_VERSION) {
    if (
      typeof root['schemaVersion'] === 'number'
      && root['schemaVersion'] > MACHINE_SCHEMA_VERSION
    ) {
      throw machineRegistryError(
        `Machine registry schema ${String(root['schemaVersion'])} requires a newer OpenAlice.`,
        'ENEWERMACHINECONFIG',
      )
    }
    throw machineRegistryError(
      `Machine registry schemaVersion must be ${MACHINE_SCHEMA_VERSION}.`,
    )
  }
  const defaultMachine = root['defaultMachine'] === undefined
    ? undefined
    : requireMachineKey(root['defaultMachine'])
  let machines: Record<string, StoredMachineConfig> | undefined
  if (root['machines'] !== undefined) {
    const rawMachines = requireRecord(root['machines'], 'machines')
    machines = {}
    for (const [key, value] of Object.entries(rawMachines)) {
      requireMachineKey(key)
      if (key === 'local') {
        throw machineRegistryError('machines.local is reserved for this computer.')
      }
      machines[key] = parseStoredMachine(value, `machines.${key}`)
    }
  }
  if (
    defaultMachine !== undefined
    && defaultMachine !== 'local'
    && !machines?.[defaultMachine]
  ) {
    throw machineRegistryError(
      `defaultMachine "${defaultMachine}" is not present in machines.`,
    )
  }
  return retainUnknownFields({
    schemaVersion: MACHINE_SCHEMA_VERSION,
    ...(defaultMachine === undefined ? {} : { defaultMachine }),
    ...(machines === undefined ? {} : { machines }),
  }, root, ROOT_KEYS)
}

export function machineRegistryPath(supervisorRoot: string): string {
  return join(supervisorRoot, MACHINE_FILE_NAME)
}

export function validateMachineKey(value: string): string | undefined {
  if (!MACHINE_KEY_PATTERN.test(value)) {
    return 'Use 1-32 lowercase letters, numbers, "_" or "-", beginning with a letter.'
  }
  if (value === 'local') return 'The implicit local machine already exists.'
  return undefined
}

export function isMachineRegistryError(
  error: unknown,
): error is Error & { code: string; exitCode: number } {
  return error instanceof Error
    && 'code' in error
    && (
      error.code === 'EMACHINECONFIG'
      || error.code === 'ENEWERMACHINECONFIG'
    )
}

function parseStoredMachine(value: unknown, label: string): StoredMachineConfig {
  const record = requireRecord(value, label)
  const parsed: StoredMachineConfig = {
    displayName: normalizeDisplayName(record['displayName'], `${label}.displayName`),
    sshTarget: normalizeSshTarget(record['sshTarget']),
    ...(record['sshPort'] === undefined
      ? {}
      : { sshPort: normalizePort(record['sshPort'], `${label}.sshPort`) }),
    ...(record['identityFile'] === undefined
      ? {}
      : { identityFile: requireAbsolutePath(record['identityFile'], `${label}.identityFile`) }),
  }
  return retainUnknownFields(parsed, record, MACHINE_KEYS)
}

function resolveMachineSupervisorRoot(options: MachineRegistryOptions): string {
  return options.supervisorRoot ?? resolveSupervisorRootPath(options)
}

function normalizeIdentityFile(
  value: string,
  options: MachineRegistryOptions,
): string {
  const input = requireString(value, 'identityFile')
  const home = options.homeDir ?? homedir()
  const expanded = input === '~'
    ? home
    : input.startsWith('~/') || input.startsWith('~\\')
      ? join(home, input.slice(2))
      : input
  return resolve(options.cwd ?? process.cwd(), expanded)
}

function requireAbsolutePath(value: unknown, label: string): string {
  const path = requireString(value, label)
  if (!isAbsolute(path)) {
    throw machineRegistryError(`${label} must be an absolute local path.`)
  }
  return resolve(path)
}

function normalizeSshTarget(value: unknown): string {
  const target = requireString(value, 'sshTarget')
  if (target.startsWith('-') || /\s|[\u0000-\u001f\u007f]/u.test(target)) {
    throw machineRegistryError('sshTarget contains unsupported characters.')
  }
  return target
}

function normalizeDisplayName(value: unknown, label: string): string {
  const displayName = requireString(value, label)
  if (displayName.length > 80 || /[\u0000-\u001f\u007f]/u.test(displayName)) {
    throw machineRegistryError(`${label} must contain 1-80 printable characters.`)
  }
  return displayName
}

function normalizePort(value: unknown, label: string): number {
  if (!Number.isInteger(value) || Number(value) < 1 || Number(value) > 65_535) {
    throw machineRegistryError(`${label} must be an integer between 1 and 65535.`)
  }
  return Number(value)
}

function requireMachineKey(value: unknown): string {
  const key = requireString(value, 'machine key')
  if (!MACHINE_KEY_PATTERN.test(key)) {
    throw machineRegistryError(
      'Machine key must begin with a lowercase letter and use only letters, numbers, "_", or "-".',
    )
  }
  return key
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw machineRegistryError(`${label} must be a JSON object.`)
  }
  return value as Record<string, unknown>
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw machineRegistryError(`${label} must be a non-empty string.`)
  }
  return value.trim()
}

function retainUnknownFields<T extends Record<string, unknown>>(
  parsed: T,
  raw: Record<string, unknown>,
  known: ReadonlySet<string>,
): T {
  const unknown = Object.fromEntries(
    Object.entries(raw).filter(([key]) => !known.has(key)),
  )
  return { ...unknown, ...parsed }
}

function humanizeMachineKey(value: string): string {
  return value
    .split(/[-_]+/u)
    .filter(Boolean)
    .map((part) => `${part[0]?.toUpperCase() ?? ''}${part.slice(1)}`)
    .join(' ')
}

function machineRegistryError(
  message: string,
  code = 'EMACHINECONFIG',
): Error & { code: string; exitCode: number } {
  return Object.assign(new Error(message), { code, exitCode: 1 })
}

function isNodeError(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
