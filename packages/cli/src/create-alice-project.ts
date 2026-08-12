/**
 * `openalice create alice-project` — interactive or scripted AliceProject birth.
 */
import { createInterface } from 'node:readline/promises'
import { stdin as input, stdout as output } from 'node:process'
import { homedir } from 'node:os'
import { join } from 'node:path'

import {
  parseAliceProjectProduct,
  type AliceProjectProduct,
} from './alice-project-product.ts'
import {
  createSupervisorAliceProject,
  resolveStoredLaunchContext,
  validateSupervisorAliceProjectKey,
} from './supervisor-config.ts'

export function formatCreateAliceProjectHelp(): string {
  return `Create a named AliceProject

Usage:
  openalice create alice-project
  openalice create alice-project --name <key> --home <path> --product <trader|nano> --yes

Interactive mode asks for a key, product, and complete home. Product is written
once at create time and cannot be changed later.

TraderAlice is the default trading product. NanoAlice is experimental and
never starts UTA.

Options:
  --name <key>       Project key (lowercase, not "default")
  --home <path>      Complete OPENALICE_HOME for this project
  --product <kind>   trader (default) or nano
  --yes              Non-interactive; requires --name and --home
`
}

export interface CreateAliceProjectOptions {
  name?: string
  home?: string
  product?: AliceProjectProduct
  yes?: boolean
}

export function parseCreateAliceProjectArgs(argv: string[]): CreateAliceProjectOptions {
  const options: CreateAliceProjectOptions = {}
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--yes' || arg === '-y') {
      options.yes = true
      continue
    }
    if (arg === '--name') {
      options.name = requireValue(argv, ++index, arg)
      continue
    }
    if (arg === '--home') {
      options.home = requireValue(argv, ++index, arg)
      continue
    }
    if (arg === '--product') {
      const raw = requireValue(argv, ++index, arg)
      const product = parseAliceProjectProduct(raw)
      if (!product) {
        throw usageError('--product must be "trader" or "nano"')
      }
      options.product = product
      continue
    }
    throw usageError(`Unknown option: ${arg}`)
  }
  return options
}

export async function runCreateAliceProjectCommand(
  argv: string[],
  io: {
    stdout?: { write(chunk: string): void }
    stderr?: { write(chunk: string): void }
    prompt?: (question: string) => Promise<string>
    resolveContext?: () => ReturnType<typeof resolveStoredLaunchContext>
    homeDir?: string
  } = {},
): Promise<number> {
  const stdout = io.stdout ?? process.stdout
  const options = parseCreateAliceProjectArgs(argv)
  const prompt = io.prompt ?? defaultPrompt
  const interactive = !options.yes

  if (options.yes && (!options.name || !options.home)) {
    throw usageError('--yes requires --name and --home')
  }

  const name = (options.name ?? (await prompt('Project key: '))).trim()
  const keyError = validateSupervisorAliceProjectKey(name)
  if (keyError) throw usageError(keyError)

  let product = options.product
  if (!product && interactive) {
    const answer = (await prompt('Product [trader]/nano: ')).trim().toLowerCase()
    if (answer === '') product = 'trader'
    else {
      const parsed = parseAliceProjectProduct(answer)
      if (!parsed) throw usageError('Product must be "trader" or "nano"')
      product = parsed
    }
  }
  product ??= 'trader'

  const suggestedHome = join(io.homeDir ?? ioHomeDir(), `.openalice-${name}`)
  const home = (
    options.home
      ?? (interactive ? await prompt(`Complete home [${suggestedHome}]: `) : suggestedHome)
  ).trim() || suggestedHome

  if (interactive && !options.yes) {
    stdout.write(
      `Create AliceProject "${name}" as ${product === 'nano' ? 'NanoAlice' : 'TraderAlice'} at ${home}?\n`,
    )
    const confirm = (await prompt('Proceed? [Y/n]: ')).trim().toLowerCase()
    if (confirm === 'n' || confirm === 'no') {
      stdout.write('Cancelled.\n')
      return 0
    }
  }

  const context = await (io.resolveContext ?? (() => resolveStoredLaunchContext({})))()
  await createSupervisorAliceProject(context, name, home, {
    product,
    homeDir: io.homeDir,
    cwd: home,
  })
  stdout.write(
    `Created AliceProject ${name} (${product === 'nano' ? 'NanoAlice' : 'TraderAlice'}).\n`
    + `Home: ${home}\n`
    + `Selected as the next bare-start default. Start with: openalice up --project ${name}\n`,
  )
  return 0
}

function ioHomeDir(): string {
  return process.env.HOME?.trim() || homedir()
}

async function defaultPrompt(question: string): Promise<string> {
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
