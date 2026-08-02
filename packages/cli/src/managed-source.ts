import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import {
  lstat,
  mkdir,
  readFile,
  rename,
  rm,
} from 'node:fs/promises'
import { dirname, join } from 'node:path'

import { resolveInstalledLayout } from './install-layout.mjs'
import {
  managedSourceKey,
  readInstallSource,
  requireInstallSource,
} from './install-source.mjs'

const DEFAULT_REPOSITORY_URL = 'https://github.com/TraderAlice/OpenAlice.git'
const MAX_GIT_ERROR_OUTPUT_BYTES = 64 * 1024

interface InstallSource {
  schemaVersion: 1 | 2
  repository: string
  cliVersion: string
  selector: {
    kind: 'branch' | 'version'
    value: string
  }
  installerUrl: string
  updateChannel?: 'stable' | 'pinned' | 'development' | 'custom'
}

interface InstalledLayout {
  installRoot: string
}

export interface ManagedSourcePlan {
  appDir: string
  installRoot: string
  repositoryUrl: string
  selector: InstallSource['selector']
  state: 'absent' | 'present' | 'invalid'
}

export interface ManagedSourceResult extends ManagedSourcePlan {
  state: 'present'
  created: boolean
}

export interface InspectManagedSourceOptions {
  installSource?: InstallSource
  layout?: InstalledLayout | null
  repositoryUrl?: string
}

export interface ManagedSourceDependencies {
  readInstallSource?: () => Promise<InstallSource>
  resolveLayout?: () => InstalledLayout | null
  inspectCheckout?: (
    appDir: string,
  ) => Promise<ManagedSourcePlan['state']>
  runGit?: (
    args: string[],
    options: { cwd?: string },
  ) => Promise<void>
}

export async function inspectManagedSource(
  options: InspectManagedSourceOptions = {},
  dependencies: ManagedSourceDependencies = {},
): Promise<ManagedSourcePlan> {
  const source = requireInstallSource(
    options.installSource
      ?? await (dependencies.readInstallSource ?? readInstallSource)(),
  ) as InstallSource
  const layout = options.layout === undefined
    ? (dependencies.resolveLayout ?? (() => resolveInstalledLayout(import.meta.url)))()
    : options.layout
  if (!layout) {
    throw managedSourceError(
      'EMANAGEDSOURCEUNAVAILABLE',
      'Managed source preparation is available from an installed OpenAlice CLI. This source-run CLI should use its current checkout.',
    )
  }
  const appDir = join(
    layout.installRoot,
    'sources',
    managedSourceKey(source),
    'OpenAlice',
  )
  const inspect = dependencies.inspectCheckout ?? inspectSourceCheckout
  return {
    appDir,
    installRoot: layout.installRoot,
    repositoryUrl: options.repositoryUrl ?? DEFAULT_REPOSITORY_URL,
    selector: { ...source.selector },
    state: await inspect(appDir),
  }
}

export async function prepareManagedSource(
  options: InspectManagedSourceOptions = {},
  dependencies: ManagedSourceDependencies = {},
): Promise<ManagedSourceResult> {
  const plan = await inspectManagedSource(options, dependencies)
  if (plan.state === 'present') {
    return { ...plan, state: 'present', created: false }
  }
  if (plan.state === 'invalid') {
    throw managedSourceError(
      'EMANAGEDSOURCECOLLISION',
      `The managed source path exists but is not an OpenAlice checkout: ${plan.appDir}`,
    )
  }

  const parent = dirname(plan.appDir)
  const temporary = join(
    parent,
    `.OpenAlice.prepare.${process.pid}.${randomUUID()}`,
  )
  await mkdir(parent, { recursive: true, mode: 0o700 })
  const runGit = dependencies.runGit ?? runGitChecked
  try {
    const cloneArgs = plan.selector.kind === 'branch'
      ? [
          'clone',
          '--branch',
          plan.selector.value,
          '--single-branch',
          plan.repositoryUrl,
          temporary,
        ]
      : ['clone', plan.repositoryUrl, temporary]
    await runGit(cloneArgs, { cwd: parent })
    if (plan.selector.kind === 'version') {
      await runGit(
        ['-C', temporary, 'checkout', '--detach', plan.selector.value],
        { cwd: parent },
      )
    }
    if (await inspectSourceCheckout(temporary) !== 'present') {
      throw managedSourceError(
        'EMANAGEDSOURCEINVALID',
        'The downloaded repository is not a valid OpenAlice source checkout.',
      )
    }
    await rename(temporary, plan.appDir)
  } catch (error: unknown) {
    await rm(temporary, { recursive: true, force: true }).catch(() => undefined)
    if (await inspectSourceCheckout(plan.appDir) === 'present') {
      return { ...plan, state: 'present', created: false }
    }
    if (isManagedSourceError(error)) throw error
    throw managedSourceError(
      'EMANAGEDSOURCEPREPARE',
      `Could not prepare the managed OpenAlice source: ${errorMessage(error)}`,
    )
  }

  return { ...plan, state: 'present', created: true }
}

export async function inspectSourceCheckout(
  appDir: string,
): Promise<ManagedSourcePlan['state']> {
  try {
    const stats = await lstat(appDir)
    if (!stats.isDirectory() || stats.isSymbolicLink()) return 'invalid'
  } catch (error: unknown) {
    if (isNodeError(error, 'ENOENT')) return 'absent'
    throw error
  }

  try {
    const manifest = JSON.parse(
      await readFile(join(appDir, 'package.json'), 'utf8'),
    ) as {
      name?: unknown
      scripts?: Record<string, unknown>
    }
    return manifest.name === 'open-alice'
      && typeof manifest.scripts?.['build:server'] === 'string'
      ? 'present'
      : 'invalid'
  } catch {
    return 'invalid'
  }
}

function runGitChecked(
  args: string[],
  options: { cwd?: string },
): Promise<void> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn('git', args, {
      cwd: options.cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
    let outputTail = ''
    const rememberOutput = (chunk: Buffer | string) => {
      outputTail = `${outputTail}${String(chunk)}`
        .slice(-MAX_GIT_ERROR_OUTPUT_BYTES)
    }
    child.stdout?.on('data', rememberOutput)
    child.stderr?.on('data', rememberOutput)
    child.once('error', (error) => {
      if (isNodeError(error, 'ENOENT')) {
        rejectPromise(new Error(
          'Git is required to prepare the managed source. Re-run the OpenAlice installer with --with-runtime-deps, or install Git and retry.',
        ))
      } else {
        rejectPromise(error)
      }
    })
    child.once('exit', (code, signal) => {
      if (code === 0) resolvePromise()
      else {
        const details = outputTail.trim()
        rejectPromise(new Error(
          `git ${args[0] ?? ''} failed (code=${String(code)}, signal=${String(signal)})${details ? `\n\n${details}` : ''}`,
        ))
      }
    })
  })
}

function managedSourceError(
  code: string,
  message: string,
): Error & { code: string; exitCode: number } {
  return Object.assign(new Error(message), { code, exitCode: 1 })
}

function isManagedSourceError(error: unknown): boolean {
  return error instanceof Error
    && 'code' in error
    && typeof error.code === 'string'
    && error.code.startsWith('EMANAGEDSOURCE')
}

function isNodeError(error: unknown, code: string): boolean {
  return error instanceof Error
    && 'code' in error
    && error.code === code
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
