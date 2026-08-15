/**
 * `openalice project` — list, select, and copy AI credentials between
 * registered AliceProjects.
 */
import { createInterface } from 'node:readline/promises'
import { stdin as input, stdout as output } from 'node:process'

import {
  copyAiCredentials,
  formatAiCredentialCopyResult,
  readAiProviderVault,
  type AiCredentialCopyResult,
} from './ai-credential-copy.ts'
import {
  persistSelectedSupervisorAliceProject,
  readSupervisorAliceProjectRegistry,
  resolveStoredLaunchContext,
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

Bare \`project\` lists registered homes and can interactively select the next
bare-start default. TUI \`i\` does the same without leaving Supervisor.

copy-ai-creds copies the AI vault from one complete home into another. Matching
vendor+key rows are skipped; colliding slugs are renamed. Broker accounts and
sealing keys are never copied. Secrets are never printed.

Options:
  --json         Machine-readable list
  --from <key>   Source AliceProject
  --to <key>     Destination AliceProject
  --yes          Non-interactive copy; requires --from and --to
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
  if (!options.select || !isInteractive()) return 0
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
    if (!isInteractive()) throw usageError('copy-ai-creds requires --from and --to when stdin is not a TTY')
    stdout.write(formatProjectList(registry))
    fromKey = fromKey ?? (await prompt(io, 'Copy AI credentials from: ')).trim()
    toKey = toKey ?? (await prompt(io, 'Copy AI credentials to: ')).trim()
  }
  const from = requireProject(registry, fromKey)
  const to = requireProject(registry, toKey)
  const sourceVault = await readAiProviderVault(from.home)
  const sourceCount = Object.keys(sourceVault.credentials).length
  if (sourceCount === 0) {
    stdout.write(`No AI credentials in ${from.key} to copy.\n`)
    return 0
  }
  if (!options.yes) {
    if (!isInteractive()) throw usageError('Refusing to copy AI credentials without --yes')
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

function isInteractive(): boolean {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY)
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
