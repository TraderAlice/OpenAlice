/** `openalice machine` — Herdr-style persistent remote profiles. */
import { createInterface } from 'node:readline/promises'
import { stdin as input, stdout as output } from 'node:process'

import { connectRemote, parseRemoteArgs } from './remote.mjs'
import {
  inspectLocalMachine,
  inspectRegisteredMachine,
  MACHINE_INVENTORY_SCHEMA_VERSION,
  type MachineInspectEnvelope,
  type MachineInventory,
  type MachineInventoryOptions,
} from './machine-inventory.ts'
import {
  findRegisteredMachine,
  machineIsEnabled,
  machineProfileId,
  readMachineRegistrySummary,
  registerMachineProfile,
  validateMachineProfile,
  renameMachine,
  removeMachine,
  setMachineEnabled,
  type MachineRegistryOptions,
  type MachineRegistrySummary,
  type RegisterMachineProfileInput,
  type RegisteredMachine,
} from './machine-registry.ts'

export function formatMachineHelp(): string {
  return `Manage saved remote Machines

Usage:
  openalice machine list [--json]
  openalice machine add <user@host> --label <label> [options]
  openalice machine rename <id-or-label> --label <label> [--yes]
  openalice machine remove <id-or-label> [--yes]
  openalice machine enable <id-or-label> [--yes]
  openalice machine disable <id-or-label> [--yes]

OpenAlice also keeps its product-specific inventory probe available for remote
fleet refreshes:
  openalice machine inspect [id-or-label] [--json]

Machine profiles are stored outside every AliceProject. Adding a profile
prepares the matching remote OpenAlice Server before saving it. The profile
contains only connection metadata. Select an AliceProject with --project or
--home on commands that support it; Herdr server sessions have no equivalent
in OpenAlice.

Options:
  --label <label>       Human-readable Machine label
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
  addMachineProfile?: typeof registerMachineProfile
  setupRemote?: (
    input: RegisterMachineProfileInput & { assumeYes: boolean },
    io: MachineCommandIo,
  ) => Promise<void>
  renameMachine?: typeof renameMachine
  deleteMachine?: typeof removeMachine
  setMachineEnabled?: typeof setMachineEnabled
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
  if (action === 'rename') return runRename(rest, io)
  if (action === 'remove') return runRemove(rest, io)
  if (action === 'enable') return runEnablement(rest, true, io)
  if (action === 'disable') return runEnablement(rest, false, io)
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
      machines: summary.machines.map(publicMachineRow),
    })}\n`)
  } else {
    stdout.write(formatMachineList(summary))
  }
  return 0
}

async function runAdd(argv: string[], io: MachineCommandIo): Promise<number> {
  const parsed = parseAddArgs(argv)
  validateMachineProfile(parsed, await loadMachines(io))
  if (!await confirmMutation(
    io,
    parsed.yes,
    `Set up and save Machine ${parsed.label} (${parsed.sshTarget}${parsed.sshPort ? `:${parsed.sshPort}` : ''})? [y/N]: `,
  )) {
    ;(io.stdout ?? process.stdout).write('Cancelled.\n')
    return 0
  }
  const input = {
    label: parsed.label,
    sshTarget: parsed.sshTarget,
    sshPort: parsed.sshPort,
    identityFile: parsed.identityFile,
  }
  await (io.setupRemote ?? setupRemote)(
    { ...input, assumeYes: parsed.yes },
    io,
  )
  const added = await (io.addMachineProfile ?? registerMachineProfile)(input, io)
  ;(io.stdout ?? process.stdout).write(
    `Added Machine ${machineProfileId(added)} (${added.displayName}) at ${added.sshTarget}.\n`,
  )
  return 0
}

async function runRename(argv: string[], io: MachineCommandIo): Promise<number> {
  const { selector, label, yes } = parseRenameArgs(argv)
  if (!await confirmMutation(io, yes, `Rename Machine ${selector} to ${label}? [y/N]: `)) {
    ;(io.stdout ?? process.stdout).write('Cancelled.\n')
    return 0
  }
  const renamed = await (io.renameMachine ?? renameMachine)(selector, label, io)
  ;(io.stdout ?? process.stdout).write(
    `Renamed Machine ${machineProfileId(renamed)} to ${renamed.displayName}.\n`,
  )
  return 0
}

async function runRemove(argv: string[], io: MachineCommandIo): Promise<number> {
  const { selector, yes } = parseRemoveArgs(argv)
  if (!await confirmMutation(io, yes, `Remove saved Machine ${selector}? [y/N]: `)) {
    ;(io.stdout ?? process.stdout).write('Cancelled.\n')
    return 0
  }
  const removed = await (io.deleteMachine ?? removeMachine)(selector, io)
  ;(io.stdout ?? process.stdout).write(`Removed Machine ${machineProfileId(removed)}. Remote data was not changed.\n`)
  return 0
}

async function runEnablement(
  argv: string[],
  enabled: boolean,
  io: MachineCommandIo,
): Promise<number> {
  const { selector, yes } = parseRemoveArgs(argv)
  const action = enabled ? 'Enable' : 'Disable'
  if (!await confirmMutation(io, yes, `${action} Machine ${selector}? [y/N]: `)) {
    ;(io.stdout ?? process.stdout).write('Cancelled.\n')
    return 0
  }
  const updated = await (io.setMachineEnabled ?? setMachineEnabled)(selector, enabled, io)
  ;(io.stdout ?? process.stdout).write(
    `${action}d Machine ${machineProfileId(updated)}.\n`,
  )
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
  label: string
  sshTarget: string
  sshPort?: number
  identityFile?: string
  yes: boolean
} {
  const sshTarget = argv[0]
  if (!sshTarget || sshTarget.startsWith('-')) throw usageError('Usage: openalice machine add <user@host> --label <label> [options]')
  let label: string | undefined
  let identityFile: string | undefined
  let sshPort: number | undefined
  let yes = false
  for (let index = 1; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--label') label = requireValue(argv, ++index, arg)
    else if (arg === '--remote-session') throw usageError('--remote-session is unsupported: OpenAlice has no named server sessions. Use --project or --home on the target command.')
    else if (arg === '--identity') identityFile = requireValue(argv, ++index, arg)
    else if (arg === '--ssh-port') sshPort = requirePort(requireValue(argv, ++index, arg), arg)
    else if (arg === '--yes' || arg === '-y') yes = true
    else throw usageError(`Unknown option: ${String(arg)}`)
  }
  if (!label) throw usageError('--label is required')
  return { label, sshTarget, sshPort, identityFile, yes }
}

function parseRemoveArgs(argv: string[]): { selector: string; yes: boolean } {
  const selector = argv[0]
  if (!selector || selector.startsWith('-')) throw usageError('Usage: openalice machine remove <id-or-label> [--yes]')
  let yes = false
  for (const arg of argv.slice(1)) {
    if (arg === '--yes' || arg === '-y') yes = true
    else throw usageError(`Unknown option: ${arg}`)
  }
  return { selector, yes }
}

function parseRenameArgs(argv: string[]): { selector: string; label: string; yes: boolean } {
  const selector = argv[0]
  if (!selector || selector.startsWith('-')) throw usageError('Usage: openalice machine rename <id-or-label> --label <label> [--yes]')
  let label: string | undefined
  let yes = false
  for (let index = 1; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--label') label = requireValue(argv, ++index, arg)
    else if (arg === '--yes' || arg === '-y') yes = true
    else throw usageError(`Unknown option: ${arg}`)
  }
  if (!label) throw usageError('--label is required')
  return { selector, label, yes }
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

async function setupRemote(
  input: RegisterMachineProfileInput & { assumeYes: boolean },
  io: MachineCommandIo,
): Promise<void> {
  const argv = [input.sshTarget, '--yes', '--no-open']
  if (input.sshPort !== undefined) argv.push('--ssh-port', String(input.sshPort))
  if (input.identityFile !== undefined) argv.push('--identity', input.identityFile)
  await connectRemote(parseRemoteArgs(argv), {
    stdout: io.stdout ?? process.stdout,
    env: io.env ?? process.env,
    connectTunnel: async () => 0,
  })
}

function requireMachine(summary: MachineRegistrySummary, key: string): RegisteredMachine {
  const machine = findRegisteredMachine(summary, key)
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
  const rows = summary.machines.map(publicMachineRow)
  const width = Math.max(5, ...rows.map((row) => row.label.length))
  return `${['Machines', '', ...rows.map((row) => {
    const state = row.enabled ? 'enabled' : 'disabled'
    return `  ${row.label.padEnd(width)}  ${row.id}  ${row.target}  [${state}]`
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

function publicMachineRow(machine: RegisteredMachine) {
  return {
    id: machineProfileId(machine),
    label: machine.displayName,
    target: machine.sshTarget,
    enabled: machineIsEnabled(machine),
    sshPort: machine.sshPort ?? null,
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
