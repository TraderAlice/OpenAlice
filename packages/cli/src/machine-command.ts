/** `openalice machine` — persistent SSH hosts and fleet inventory. */
import { createInterface } from 'node:readline/promises'
import { stdin as input, stdout as output } from 'node:process'

import {
  inspectLocalMachine,
  inspectRegisteredMachine,
  MACHINE_INVENTORY_SCHEMA_VERSION,
  type MachineInspectEnvelope,
  type MachineInventory,
  type MachineInventoryOptions,
} from './machine-inventory.ts'
import {
  readMachineRegistrySummary,
  registerMachine,
  removeMachine,
  type MachineRegistryOptions,
  type MachineRegistrySummary,
  type RegisteredMachine,
} from './machine-registry.ts'

export function formatMachineHelp(): string {
  return `Manage local and SSH Machines

Usage:
  openalice machine list [--json]
  openalice machine add <key> --target <user@host> [options]
  openalice machine remove <key> [--yes]
  openalice machine inspect [key] [--json]

The local Machine is implicit. Registered SSH Machines are stored outside every
AliceProject. inspect performs one aggregate SSH request per remote Machine and
never scans arbitrary remote directories.

Options:
  --target <user@host>  OpenSSH destination
  --name <label>        Display name (defaults to the Machine key)
  --ssh-port <port>     Override the OpenSSH-configured port
  --identity <path>     Absolute or ~/ local private-key path
  --json                Print a versioned machine-readable result
  --yes                 Confirm a registry mutation non-interactively
`
}

export interface MachineCommandIo extends MachineRegistryOptions, MachineInventoryOptions {
  stdout?: { write(chunk: string): void }
  prompt?: (question: string) => Promise<string>
  interactive?: boolean
  loadMachines?: () => Promise<MachineRegistrySummary>
  addMachine?: typeof registerMachine
  deleteMachine?: typeof removeMachine
  inspectLocal?: (options?: MachineInventoryOptions) => Promise<MachineInspectEnvelope>
  inspectRemote?: (
    machine: RegisteredMachine,
    options?: MachineInventoryOptions,
  ) => Promise<MachineInventory>
}

export async function runMachineCommand(
  argv: string[],
  io: MachineCommandIo = {},
): Promise<number> {
  const [action, ...rest] = argv
  if (!action || action === 'list') return runList(action ? rest : [], io)
  if (action === 'add') return runAdd(rest, io)
  if (action === 'remove') return runRemove(rest, io)
  if (action === 'inspect') return runInspect(rest, io)
  throw usageError(`Unknown machine command: ${action}\n\n${formatMachineHelp()}`)
}

async function runList(argv: string[], io: MachineCommandIo): Promise<number> {
  const json = parseJsonOnly(argv, 'machine list')
  const summary = await loadMachines(io)
  const stdout = io.stdout ?? process.stdout
  if (json) {
    stdout.write(`${JSON.stringify({
      schemaVersion: 1,
      defaultMachine: summary.defaultMachine,
      machines: [localMachineRow(summary.defaultMachine), ...summary.machines.map(publicMachineRow)],
    })}\n`)
  } else {
    stdout.write(formatMachineList(summary))
  }
  return 0
}

async function runAdd(argv: string[], io: MachineCommandIo): Promise<number> {
  const parsed = parseAddArgs(argv)
  if (!await confirmMutation(
    io,
    parsed.yes,
    `Register SSH Machine ${parsed.key} (${parsed.sshTarget}${parsed.sshPort ? `:${parsed.sshPort}` : ''})? [y/N]: `,
  )) {
    ;(io.stdout ?? process.stdout).write('Cancelled.\n')
    return 0
  }
  const added = await (io.addMachine ?? registerMachine)({
    key: parsed.key,
    displayName: parsed.displayName,
    sshTarget: parsed.sshTarget,
    sshPort: parsed.sshPort,
    identityFile: parsed.identityFile,
  }, io)
  ;(io.stdout ?? process.stdout).write(
    `Registered Machine ${added.key} (${added.sshTarget}${added.sshPort ? `:${added.sshPort}` : ''}).\n`,
  )
  return 0
}

async function runRemove(argv: string[], io: MachineCommandIo): Promise<number> {
  const { key, yes } = parseRemoveArgs(argv)
  if (!await confirmMutation(io, yes, `Remove registered Machine ${key}? [y/N]: `)) {
    ;(io.stdout ?? process.stdout).write('Cancelled.\n')
    return 0
  }
  const removed = await (io.deleteMachine ?? removeMachine)(key, io)
  ;(io.stdout ?? process.stdout).write(`Removed Machine ${removed.key}. Remote data was not changed.\n`)
  return 0
}

async function runInspect(argv: string[], io: MachineCommandIo): Promise<number> {
  const { key, json } = parseInspectArgs(argv)
  const summary = await loadMachines(io)
  const local = io.inspectLocal ?? inspectLocalMachine
  const remote = io.inspectRemote ?? inspectRegisteredMachine
  if (key) {
    let envelope: MachineInspectEnvelope
    if (key === 'local') {
      envelope = await local(io)
    } else {
      const machine = requireMachine(summary, key)
      envelope = {
        schemaVersion: MACHINE_INVENTORY_SCHEMA_VERSION,
        generatedAt: new Date().toISOString(),
        machine: await remote(machine, io),
      }
    }
    writeInspection(io, json, envelope)
    return 0
  }
  const localEnvelope = await local(io)
  const remotes = await mapWithConcurrency(summary.machines, 4, (machine) => remote(machine, io))
  const fleet = {
    schemaVersion: MACHINE_INVENTORY_SCHEMA_VERSION,
    generatedAt: localEnvelope.generatedAt,
    machines: [localEnvelope.machine, ...remotes],
  }
  const stdout = io.stdout ?? process.stdout
  stdout.write(json ? `${JSON.stringify(fleet)}\n` : formatMachineInventory(fleet.machines))
  return 0
}

function parseAddArgs(argv: string[]): {
  key: string
  displayName?: string
  sshTarget: string
  sshPort?: number
  identityFile?: string
  yes: boolean
} {
  const key = argv[0]
  if (!key || key.startsWith('-')) throw usageError('Usage: openalice machine add <key> --target <user@host> [options]')
  let displayName: string | undefined
  let sshTarget: string | undefined
  let identityFile: string | undefined
  let sshPort: number | undefined
  let yes = false
  for (let index = 1; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--target') sshTarget = requireValue(argv, ++index, arg)
    else if (arg === '--name') displayName = requireValue(argv, ++index, arg)
    else if (arg === '--identity') identityFile = requireValue(argv, ++index, arg)
    else if (arg === '--ssh-port') sshPort = requirePort(requireValue(argv, ++index, arg), arg)
    else if (arg === '--yes' || arg === '-y') yes = true
    else throw usageError(`Unknown option: ${String(arg)}`)
  }
  if (!sshTarget) throw usageError('--target is required')
  return { key, displayName, sshTarget, sshPort, identityFile, yes }
}

function parseRemoveArgs(argv: string[]): { key: string; yes: boolean } {
  const key = argv[0]
  if (!key || key.startsWith('-')) throw usageError('Usage: openalice machine remove <key> [--yes]')
  let yes = false
  for (const arg of argv.slice(1)) {
    if (arg === '--yes' || arg === '-y') yes = true
    else throw usageError(`Unknown option: ${arg}`)
  }
  return { key, yes }
}

function parseInspectArgs(argv: string[]): { key?: string; json: boolean } {
  let key: string | undefined
  let json = false
  for (const arg of argv) {
    if (arg === '--json') json = true
    else if (arg.startsWith('-')) throw usageError(`Unknown option: ${arg}`)
    else if (key) throw usageError('machine inspect accepts at most one Machine key')
    else key = arg
  }
  return { key, json }
}

function parseJsonOnly(argv: string[], label: string): boolean {
  if (argv.length === 0) return false
  if (argv.length === 1 && argv[0] === '--json') return true
  throw usageError(`${label} only accepts --json`)
}

async function confirmMutation(io: MachineCommandIo, yes: boolean, question: string): Promise<boolean> {
  if (yes) return true
  const interactive = io.interactive ?? Boolean(process.stdin.isTTY && process.stdout.isTTY)
  if (!interactive) throw usageError('Registry mutations require --yes when stdin is not a TTY.')
  const answer = (await prompt(io, question)).trim().toLowerCase()
  return answer === 'y' || answer === 'yes'
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

async function loadMachines(io: MachineCommandIo): Promise<MachineRegistrySummary> {
  return (io.loadMachines ?? (() => readMachineRegistrySummary(io)))()
}

function requireMachine(summary: MachineRegistrySummary, key: string): RegisteredMachine {
  const machine = summary.machines.find((entry) => entry.key === key)
  if (!machine) throw usageError(`Machine "${key}" is not registered.`)
  return machine
}

function writeInspection(io: MachineCommandIo, json: boolean, envelope: MachineInspectEnvelope): void {
  const stdout = io.stdout ?? process.stdout
  stdout.write(json
    ? `${JSON.stringify(envelope)}\n`
    : formatMachineInventory([envelope.machine]))
}

export function formatMachineList(summary: MachineRegistrySummary): string {
  const rows = [localMachineRow(summary.defaultMachine), ...summary.machines.map(publicMachineRow)]
  const width = Math.max(7, ...rows.map((row) => row.key.length))
  return `${['Machines', '', ...rows.map((row) => {
    const defaultMark = row.isDefault ? '  (default)' : ''
    return `  ${row.key.padEnd(width)}  ${row.displayName}  ${row.sshTarget ?? 'local'}${defaultMark}`
  }), ''].join('\n')}\n`
}

export function formatMachineInventory(machines: MachineInventory[]): string {
  const lines = ['Machine fleet', '']
  for (const machine of machines) {
    lines.push(`  ${machine.key}  ${machine.displayName}  [${machine.connection}]`)
    if (machine.issue) lines.push(`    ${machine.issue.message}`)
    for (const project of machine.projects) {
      lines.push(`    ${project.key}  ${project.displayName}  ${project.product}  ${project.runtime.state}`)
    }
  }
  lines.push('')
  return `${lines.join('\n')}\n`
}

function localMachineRow(defaultMachine: string) {
  return { key: 'local', displayName: 'This computer', sshTarget: null, sshPort: null, isDefault: defaultMachine === 'local' }
}

function publicMachineRow(machine: RegisteredMachine) {
  return {
    key: machine.key,
    displayName: machine.displayName,
    sshTarget: machine.sshTarget,
    sshPort: machine.sshPort ?? null,
    isDefault: machine.isDefault,
  }
}

async function prompt(io: MachineCommandIo, question: string): Promise<string> {
  if (io.prompt) return io.prompt(question)
  const rl = createInterface({ input, output })
  try {
    return await rl.question(question)
  } finally {
    rl.close()
  }
}

function requireValue(argv: string[], index: number, flag: string): string {
  const value = argv[index]
  if (!value || value.startsWith('-')) throw usageError(`${flag} requires a value`)
  return value
}

function requirePort(value: string, flag: string): number {
  const port = Number(value)
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw usageError(`${flag} must be an integer between 1 and 65535`)
  }
  return port
}

function usageError(message: string): Error & { code: string; exitCode: number } {
  return Object.assign(new Error(message), { code: 'EUSAGE', exitCode: 2 })
}
