/**
 * `openalice project` — list, select, and copy AI credentials between
 * registered AliceProjects.
 */
import { createInterface } from 'node:readline/promises'
import { stdin as input, stdout as output } from 'node:process'
import { posix, resolve } from 'node:path'

import {
  copyAiCredentials,
  formatAiCredentialCopyResult,
  readAiProviderVault,
  type AiCredentialCopyResult,
} from './ai-credential-copy.ts'
import {
  inspectRegisteredMachine,
  type MachineInventory,
} from './machine-inventory.ts'
import {
  readMachineRegistrySummary,
  type MachineRegistrySummary,
  type RegisteredMachine,
} from './machine-registry.ts'
import { inspectRuntime, stopRuntime } from './lifecycle.mjs'
import {
  planProjectTransfer,
  type ProjectTransferIssuePolicy,
  type ProjectTransferPlan,
} from './project-transfer.ts'
import { transferProjectOverSsh } from './project-transfer-ssh.ts'
import {
  receiveProjectTransferStream,
  type ProjectTransferReceipt,
} from './project-transfer-stream.ts'
import {
  resolveSupervisorRootPath,
} from './launch-context.ts'
import {
  createSupervisorAliceProject,
  persistSelectedSupervisorAliceProject,
  readSupervisorAliceProjectRegistry,
  resolveStoredLaunchContext,
  validateSupervisorAliceProjectKey,
  type SupervisorAliceProjectRegistry,
  type SupervisorAliceProjectSummary,
} from './supervisor-config.ts'

export function formatProjectHelp(): string {
  return `Manage registered AliceProjects

Usage:
  openalice project
  openalice project list [--json]
  openalice project use <key>
  openalice project copy-ai-creds [--from <key>] [--to <key>] [--yes]
  openalice project transfer --from <key> --to-machine <key> --to-project <key> --to-home <absolute-path> [options]

Bare \`project\` lists registered homes and can interactively select the next
bare-start default. TUI \`i\` does the same without leaving Supervisor.

copy-ai-creds copies AI credential rows from one complete home into another.
Matching vendor+key rows are skipped; colliding slugs are renamed. Workspace
launch preferences, broker accounts, and sealing keys are never copied.
Secrets are never printed.

transfer copies portable configuration and Workspace repositories to a
registered SSH Machine. Native/OpenAlice Sessions, Runtime state, ports, auth,
and the source sealing key are excluded. Apply uses remote staging, checksums,
and atomic publication; the source AliceProject is never deleted.

Options:
  --json         Machine-readable list
  --from <key>   Source AliceProject
  --to <key>     Destination AliceProject
  --yes          Non-interactive copy; requires --from and --to
  --plan         Print the transfer plan without changing either Machine
  --without-credentials  Do not transfer AI, broker, Connector, or provider keys
  --session-owner-policy <keep-blocked|new-then-resume>
  --stop-source  With --yes, explicitly stop a running source before planning
`
}

export interface ProjectCommandIo {
  stdout?: { write(chunk: string): void }
  stderr?: { write(chunk: string): void }
  prompt?: (question: string) => Promise<string>
  resolveContext?: () => ReturnType<typeof resolveStoredLaunchContext>
  loadRegistry?: (
    context: Awaited<ReturnType<typeof resolveStoredLaunchContext>>,
  ) => Promise<SupervisorAliceProjectRegistry>
  selectProject?: (
    context: Awaited<ReturnType<typeof resolveStoredLaunchContext>>,
    key: string,
  ) => Promise<void>
  copyCredentials?: (input: {
    fromKey: string
    toKey: string
    fromHome: string
    toHome: string
  }) => Promise<AiCredentialCopyResult>
  interactive?: boolean
  env?: NodeJS.ProcessEnv
  supervisorRoot?: string
  loadMachines?: () => Promise<MachineRegistrySummary>
  inspectMachine?: (machine: RegisteredMachine) => Promise<MachineInventory>
  inspectSourceRuntime?: (home: string) => Promise<{ class?: string; owner?: { surface?: string } | null }>
  stopSourceRuntime?: (home: string) => Promise<unknown>
  planTransfer?: typeof planProjectTransfer
  sendTransfer?: (input: {
    machine: RegisteredMachine
    plan: ProjectTransferPlan
    stderr?: { write(chunk: string): void }
  }) => Promise<ProjectTransferReceipt>
  receiveTransfer?: () => Promise<ProjectTransferReceipt>
}

export async function runProjectCommand(
  argv: string[],
  io: ProjectCommandIo = {},
): Promise<number> {
  const [action, ...rest] = argv
  if (!action || action === 'list' || action === '--json') {
    return runProjectList(action === 'list' ? rest : argv, io, { select: !action })
  }
  if (action === 'use') {
    return runProjectUse(rest, io)
  }
  if (action === 'copy-ai-creds') {
    return runProjectCopyAiCreds(rest, io)
  }
  if (action === 'transfer') return runProjectTransfer(rest, io)
  if (action === 'transfer-receive') return runProjectTransferReceive(rest, io)
  throw usageError(`Unknown project command: ${action}\n\n${formatProjectHelp()}`)
}

async function runProjectList(
  argv: string[],
  io: ProjectCommandIo,
  options: { select: boolean },
): Promise<number> {
  const json = argv.includes('--json')
  if (json && argv.some((arg) => arg !== '--json')) {
    throw usageError('openalice project list only accepts --json')
  }
  if (!json && argv.length > 0) throw usageError(`Unknown option: ${argv[0]}`)
  const { context, registry } = await loadRegistry(io)
  const stdout = io.stdout ?? process.stdout
  if (json) {
    stdout.write(`${JSON.stringify({
      defaultProject: registry.defaultProject,
      projects: registry.projects,
    })}\n`)
    return 0
  }
  stdout.write(formatProjectList(registry))
  if (!options.select || !isInteractive(io)) return 0
  const answer = (await prompt(io, `Select AliceProject [${registry.defaultProject}]: `)).trim()
  if (!answer || answer === registry.defaultProject) return 0
  await selectProject(io, context, registry, answer)
  stdout.write(`Selected AliceProject ${answer}; future bare starts use it.\n`)
  return 0
}

async function runProjectUse(argv: string[], io: ProjectCommandIo): Promise<number> {
  const key = argv[0]
  if (!key || key.startsWith('-')) throw usageError('Usage: openalice project use <key>')
  if (argv.length > 1) throw usageError('openalice project use takes exactly one project key')
  const { context, registry } = await loadRegistry(io)
  await selectProject(io, context, registry, key)
  ;(io.stdout ?? process.stdout).write(
    `Selected AliceProject ${key}; future bare starts use it.\n`,
  )
  return 0
}

async function runProjectCopyAiCreds(argv: string[], io: ProjectCommandIo): Promise<number> {
  const options = parseCopyArgs(argv)
  const { registry } = await loadRegistry(io)
  const stdout = io.stdout ?? process.stdout
  let fromKey = options.from
  let toKey = options.to
  if (!fromKey || !toKey) {
    if (options.yes) throw usageError('--yes requires --from and --to')
    if (!isInteractive(io)) throw usageError('copy-ai-creds requires --from and --to when stdin is not a TTY')
    stdout.write(formatProjectList(registry))
    fromKey = fromKey ?? (await prompt(io, 'Copy AI credentials from: ')).trim()
    toKey = toKey ?? (await prompt(io, 'Copy AI credentials to: ')).trim()
  }
  const from = requireProject(registry, fromKey)
  const to = requireProject(registry, toKey)
  if (from.key === to.key) {
    throw usageError('Source and destination AliceProjects must be different.')
  }
  const sourceVault = await readAiProviderVault(from.home)
  const sourceCount = Object.keys(sourceVault.credentials).length
  if (sourceCount > 0 && !options.yes) {
    if (!isInteractive(io)) throw usageError('Refusing to copy AI credentials without --yes')
    stdout.write(
      `Copy ${sourceCount} AI credential${sourceCount === 1 ? '' : 's'} from ${from.key} to ${to.key}?\n`
      + 'Matching keys are skipped. Broker accounts are not copied.\n',
    )
    const confirm = (await prompt(io, 'Proceed? [y/N]: ')).trim().toLowerCase()
    if (confirm !== 'y' && confirm !== 'yes') {
      stdout.write('Cancelled.\n')
      return 0
    }
  }
  const copy = io.copyCredentials ?? copyAiCredentials
  const result = await copy({
    fromKey: from.key,
    toKey: to.key,
    fromHome: from.home,
    toHome: to.home,
  })
  stdout.write(formatAiCredentialCopyResult(result))
  return 0
}

interface TransferCommandOptions {
  from: string
  machine: string
  project: string
  home: string
  displayName?: string
  credentials: 'include' | 'omit'
  issuePolicy: ProjectTransferIssuePolicy | null
  planOnly: boolean
  yes: boolean
  stopSource: boolean
  json: boolean
}

async function runProjectTransfer(argv: string[], io: ProjectCommandIo): Promise<number> {
  const options = parseTransferArgs(argv)
  const stdout = io.stdout ?? process.stdout
  const stderr = io.stderr ?? process.stderr
  const { registry } = await loadRegistry(io)
  const source = requireProject(registry, options.from)
  const machines = await (io.loadMachines ?? (() => readMachineRegistrySummary({
    env: io.env,
    supervisorRoot: io.supervisorRoot,
  })))()
  const machine = requireRegisteredMachine(machines, options.machine)
  const inspectMachine = io.inspectMachine ?? ((entry) => inspectRegisteredMachine(entry, {
    env: io.env,
    supervisorRoot: io.supervisorRoot,
  }))
  let remote = await inspectMachine(machine)
  if (remote.connection !== 'online') {
    throw transferBlocked(`Machine ${machine.key} is ${remote.connection}: ${remote.issue?.message ?? 'SSH inventory is unavailable.'}`)
  }
  if (!remote.capabilities.transferReceive) {
    throw transferBlocked(`Machine ${machine.key} does not advertise compatible AliceProject transfer support.`)
  }

  const inspectSource = io.inspectSourceRuntime ?? (async (home) => inspectRuntime({ homeRoot: home, waitMs: 2_000 }))
  const stopSource = io.stopSourceRuntime ?? (async (home) => stopRuntime({ homeRoot: home, waitMs: 15_000 }))
  let sourceRuntime = await inspectSource(source.home)
  let sourceRunningBlocker = sourceRuntime.class !== 'absent'
  if (sourceRunningBlocker && sourceRuntime.owner?.surface !== 'cli-server') {
    throw transferBlocked(
      `Source AliceProject is owned by ${sourceRuntime.owner?.surface ?? 'another Runtime'}; close that owner normally before transfer.`,
    )
  }
  if (sourceRunningBlocker && !options.planOnly) {
    let allowStop = options.stopSource
    if (!allowStop && isInteractive(io)) {
      const answer = (await prompt(
        io,
        `Source AliceProject ${source.key} is ${sourceRuntime.class ?? 'active'}. Stop it for a consistent transfer? [y/N]: `,
      )).trim().toLowerCase()
      allowStop = answer === 'y' || answer === 'yes'
    }
    if (!allowStop) {
      throw transferBlocked(
        options.yes
          ? 'The source Runtime must be absent before apply. Re-run with --stop-source to authorize that separate action.'
          : 'The source Runtime must be stopped before apply.',
      )
    }
    await stopSource(source.home)
    sourceRuntime = await inspectSource(source.home)
    sourceRunningBlocker = sourceRuntime.class !== 'absent'
    if (sourceRunningBlocker) throw transferBlocked('The source Runtime did not become quiescent after stop.')
  }

  const planner = io.planTransfer ?? planProjectTransfer
  const plan = await planner({
    source,
    destinationMachineKey: machine.key,
    destinationProjectKey: options.project,
    destinationDisplayName: options.displayName,
    destinationHome: options.home,
    credentials: options.credentials,
    scheduledIssues: options.issuePolicy,
    env: io.env ?? process.env,
  })
  if (sourceRunningBlocker) {
    plan.blockers.unshift({
      code: 'ESOURCERUNNING',
      message: `Source AliceProject Runtime is ${sourceRuntime.class ?? 'active'}; apply requires a separate stop confirmation.`,
    })
  }
  plan.blockers.push(...remoteDestinationBlockers(remote, options.project, options.home))
  plan.readyToApply = plan.blockers.length === 0

  if (options.planOnly) {
    stdout.write(options.json
      ? `${JSON.stringify({ schemaVersion: 1, plan })}\n`
      : formatProjectTransferPlan(plan))
    return plan.readyToApply ? 0 : 1
  }
  if (!plan.readyToApply) throw transferBlocked(formatPlanBlockers(plan))
  if (!options.yes) {
    if (!isInteractive(io)) throw usageError('Transfer apply requires --yes when stdin is not a TTY.')
    stdout.write(formatProjectTransferPlan(plan))
    const answer = (await prompt(io, 'Transfer this AliceProject now? [y/N]: ')).trim().toLowerCase()
    if (answer !== 'y' && answer !== 'yes') {
      stdout.write('Cancelled. Nothing changed.\n')
      return 0
    }
  } else if (!options.json) {
    stdout.write(formatProjectTransferPlan(plan))
  }

  sourceRuntime = await inspectSource(source.home)
  if (sourceRuntime.class !== 'absent') throw transferBlocked('Source Runtime changed after planning; transfer was not started.')
  remote = await inspectMachine(machine)
  if (remote.connection !== 'online' || !remote.capabilities.transferReceive) {
    throw transferBlocked('Destination Machine changed after planning; transfer was not started.')
  }
  const destinationBlockers = remoteDestinationBlockers(remote, options.project, options.home)
  if (destinationBlockers.length > 0) {
    throw transferBlocked(`Destination changed after planning: ${destinationBlockers[0]!.message}`)
  }
  const sender = io.sendTransfer ?? ((transferInput) => transferProjectOverSsh({
    ...transferInput,
    stderr: transferInput.stderr,
  }))
  const receipt = await sender({ machine, plan, stderr })
  stdout.write(options.json
    ? `${JSON.stringify({ schemaVersion: 1, plan, receipt })}\n`
    : formatProjectTransferReceipt(receipt))
  return 0
}

async function runProjectTransferReceive(argv: string[], io: ProjectCommandIo): Promise<number> {
  if (argv.length > 0) throw usageError('project transfer-receive does not accept arguments')
  const supervisorRoot = io.supervisorRoot ?? resolveSupervisorRootPath({ env: io.env })
  const receive = io.receiveTransfer ?? (() => receiveProjectTransferStream({
    source: process.stdin,
    register: async (plan) => {
      const context = { supervisorRoot }
      const registry = await readSupervisorAliceProjectRegistry(context, { env: io.env })
      const existing = registry.projects.find((project) => project.key === plan.destination.key)
      if (existing) {
        if (resolve(existing.home) !== resolve(plan.destination.home)) {
          throw transferBlocked(`Remote AliceProject key ${plan.destination.key} is already registered to another Home.`)
        }
        return
      }
      await createSupervisorAliceProject(
        context,
        plan.destination.key,
        plan.destination.home,
        {
          product: plan.source.product,
          displayName: plan.destination.displayName,
          select: false,
        },
      )
    },
  }))
  const receipt = await receive()
  ;(io.stdout ?? process.stdout).write(`${JSON.stringify(receipt)}\n`)
  return 0
}

function parseTransferArgs(argv: string[]): TransferCommandOptions {
  let from: string | undefined
  let machine: string | undefined
  let project: string | undefined
  let home: string | undefined
  let displayName: string | undefined
  let credentials: TransferCommandOptions['credentials'] = 'include'
  let issuePolicy: ProjectTransferIssuePolicy | null = null
  let planOnly = false
  let yes = false
  let stopSource = false
  let json = false
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--from') from = requireValue(argv, ++index, arg)
    else if (arg === '--to-machine') machine = requireValue(argv, ++index, arg)
    else if (arg === '--to-project') project = requireValue(argv, ++index, arg)
    else if (arg === '--to-home') home = requireValue(argv, ++index, arg)
    else if (arg === '--name') displayName = requireValue(argv, ++index, arg)
    else if (arg === '--without-credentials') credentials = 'omit'
    else if (arg === '--session-owner-policy') {
      const value = requireValue(argv, ++index, arg)
      if (value !== 'keep-blocked' && value !== 'new-then-resume') {
        throw usageError('--session-owner-policy must be keep-blocked or new-then-resume')
      }
      issuePolicy = value
    } else if (arg === '--plan') planOnly = true
    else if (arg === '--yes' || arg === '-y') yes = true
    else if (arg === '--stop-source') stopSource = true
    else if (arg === '--json') json = true
    else throw usageError(`Unknown transfer option: ${arg}`)
  }
  if (!from || !machine || !project || !home) {
    throw usageError('transfer requires --from, --to-machine, --to-project, and --to-home')
  }
  const projectError = validateSupervisorAliceProjectKey(project)
  if (projectError) throw usageError(`Invalid destination AliceProject key: ${projectError}`)
  if (!posix.isAbsolute(home) || /[\u0000-\u001f\u007f-\u009f]/u.test(home)) {
    throw usageError('--to-home must be an absolute, control-character-free remote path')
  }
  if (planOnly && stopSource) throw usageError('--plan cannot be combined with --stop-source')
  return { from, machine, project, home, displayName, credentials, issuePolicy, planOnly, yes, stopSource, json }
}

export function formatProjectTransferPlan(plan: ProjectTransferPlan): string {
  const excludedSessions = plan.excluded
    .filter((entry) => entry.reason === 'session-plane' || entry.reason === 'untracked-session-dossier')
    .reduce((sum, entry) => sum + entry.files, 0)
  const credentials = plan.policy.credentials === 'omit'
    ? 'omitted by request'
    : `${plan.credentials.ai.count} AI, ${plan.credentials.broker.count} broker, ${plan.credentials.connector.count} Connector, ${plan.credentials.providerKeys.count} provider key(s)`
  const lines = [
    'AliceProject transfer plan',
    '',
    `  Source       ${plan.source.displayName} (${plan.source.key})`,
    `  Source Home  ${plan.source.home}`,
    `  Destination  ${plan.destination.machineKey} / ${plan.destination.displayName} (${plan.destination.key})`,
    `  Remote Home  ${plan.destination.home}`,
    `  Product      ${plan.source.product}`,
    `  Portable     ${plan.portable.files} files, ${formatBytes(plan.portable.bytes)}`,
    `  Free space   ${formatBytes(plan.destination.requiredFreeBytes)} required on destination`,
    `  Credentials  ${credentials}`,
    `  Sessions     0 imported; ${excludedSessions} runtime file(s) excluded`,
    `  Issues       ${plan.scheduledIssues.length} exact-Session scheduled owner(s); policy ${plan.policy.scheduledIssues ?? 'required'}`,
  ]
  if (plan.blockers.length > 0) {
    lines.push('', 'Blockers:', ...plan.blockers.map((blocker) => `  - ${blocker.message}`))
  }
  lines.push('', 'The source AliceProject is left unchanged.', 'Nothing has changed yet.', '')
  return `${lines.join('\n')}\n`
}

function formatProjectTransferReceipt(receipt: ProjectTransferReceipt): string {
  return [
    'AliceProject transfer complete.',
    `Remote Home: ${receipt.destinationHome}`,
    `Published ${receipt.files} files (${formatBytes(receipt.bytes)}); Sessions imported: 0.`,
    `Receipt: ${receipt.transferId}`,
    '',
  ].join('\n')
}

function requireRegisteredMachine(summary: MachineRegistrySummary, key: string): RegisteredMachine {
  const machine = summary.machines.find((entry) => entry.key === key)
  if (!machine) throw usageError(`Machine "${key}" is not registered.`)
  return machine
}

function remotePathOverlaps(left: string, right: string): boolean {
  const leftPath = posix.normalize(left)
  const rightPath = posix.normalize(right)
  const leftToRight = posix.relative(leftPath, rightPath)
  const rightToLeft = posix.relative(rightPath, leftPath)
  return leftToRight === ''
    || (!leftToRight.startsWith('../') && leftToRight !== '..')
    || (!rightToLeft.startsWith('../') && rightToLeft !== '..')
}

function remoteDestinationBlockers(
  inventory: MachineInventory,
  projectKey: string,
  home: string,
): ProjectTransferPlan['blockers'] {
  const blockers: ProjectTransferPlan['blockers'] = []
  for (const project of inventory.projects) {
    if (project.key === projectKey) {
      blockers.push({ code: 'EDESTPROJECT', message: `Remote AliceProject key ${projectKey} is already registered.` })
    }
    if (remotePathOverlaps(project.home, home)) {
      blockers.push({ code: 'EDESTHOME', message: `Destination Home overlaps remote AliceProject ${project.key}.` })
    }
  }
  return blockers
}

function formatPlanBlockers(plan: ProjectTransferPlan): string {
  return plan.blockers.map((blocker) => blocker.message).join(' ')
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KiB`
  if (value < 1024 * 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MiB`
  return `${(value / (1024 * 1024 * 1024)).toFixed(1)} GiB`
}

function transferBlocked(message: string): Error & { code: string; exitCode: number } {
  return Object.assign(new Error(message), { code: 'ETRANSFERBLOCKED', exitCode: 1 })
}

function parseCopyArgs(argv: string[]): { from?: string; to?: string; yes: boolean } {
  const options: { from?: string; to?: string; yes: boolean } = { yes: false }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--yes' || arg === '-y') {
      options.yes = true
      continue
    }
    if (arg === '--from') {
      options.from = requireValue(argv, ++index, arg)
      continue
    }
    if (arg === '--to') {
      options.to = requireValue(argv, ++index, arg)
      continue
    }
    throw usageError(`Unknown option: ${arg}`)
  }
  return options
}

async function loadRegistry(io: ProjectCommandIo) {
  const context = await (io.resolveContext ?? (() => resolveStoredLaunchContext({})))()
  const registry = await (io.loadRegistry ?? readSupervisorAliceProjectRegistry)(context)
  return { context, registry }
}

async function selectProject(
  io: ProjectCommandIo,
  context: Awaited<ReturnType<typeof resolveStoredLaunchContext>>,
  registry: SupervisorAliceProjectRegistry,
  key: string,
): Promise<void> {
  requireProject(registry, key)
  await (io.selectProject ?? persistSelectedSupervisorAliceProject)(context, key)
}

function requireProject(
  registry: SupervisorAliceProjectRegistry,
  key: string,
): SupervisorAliceProjectSummary {
  const project = registry.projects.find((entry) => entry.key === key)
  if (!project) {
    throw usageError(
      `AliceProject "${key}" is not registered.\n\n${formatProjectList(registry)}`,
    )
  }
  return project
}

export function formatProjectList(registry: SupervisorAliceProjectRegistry): string {
  const width = Math.max(7, ...registry.projects.map((entry) => entry.key.length))
  const lines = ['AliceProjects', '']
  for (const entry of registry.projects) {
    const marks = [
      entry.isDefault ? 'default' : undefined,
    ].filter(Boolean).join(', ')
    lines.push(
      `  ${entry.key.padEnd(width)}  ${entry.displayName}  ${entry.home}${marks ? `  (${marks})` : ''}`,
    )
  }
  lines.push('')
  return `${lines.join('\n')}\n`
}

function isInteractive(io?: ProjectCommandIo): boolean {
  return io?.interactive ?? Boolean(process.stdin.isTTY && process.stdout.isTTY)
}

async function prompt(io: ProjectCommandIo, question: string): Promise<string> {
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

function usageError(message: string): Error & { code: string; exitCode: number } {
  return Object.assign(new Error(message), { code: 'EUSAGE', exitCode: 2 })
}
