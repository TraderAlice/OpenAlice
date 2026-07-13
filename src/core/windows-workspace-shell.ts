import { existsSync } from 'node:fs'
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname, resolve, win32 } from 'node:path'

import { z } from 'zod'

import { userDataHome } from './paths.js'
import { resolveBashPath } from './shell-resolver.js'

const preferenceSchema = z.discriminatedUnion('mode', [
  z.object({ version: z.literal(1), mode: z.literal('auto'), customPath: z.null().default(null) }),
  z.object({ version: z.literal(1), mode: z.literal('custom'), customPath: z.string().trim().min(1) }),
])

export type WindowsWorkspaceShellPreference = z.infer<typeof preferenceSchema>
export type WindowsWorkspaceShellSource = 'custom' | 'managed' | 'environment' | 'git-for-windows' | 'none'

export type WindowsWorkspaceShellStatus =
  | { readonly supported: false }
  | {
      readonly supported: true
      readonly mode: WindowsWorkspaceShellPreference['mode']
      readonly customPath: string | null
      readonly resolvedPath: string | null
      readonly source: WindowsWorkspaceShellSource
      readonly valid: boolean
      readonly message: string | null
    }

const DEFAULT_PREFERENCE: WindowsWorkspaceShellPreference = {
  version: 1,
  mode: 'auto',
  customPath: null,
}

const OVERRIDE_ENV = 'OPENALICE_WORKSPACE_SHELL_PATH'

export class InvalidWindowsWorkspaceShellPathError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InvalidWindowsWorkspaceShellPathError'
  }
}

export function windowsWorkspaceShellPreferencePath(): string {
  return resolve(userDataHome, 'state', 'workspace-shell.json')
}

/**
 * Machine-local Windows preference. Non-Windows callers return before any
 * filesystem access so macOS/Linux startup keeps its existing shell path and
 * pays no compatibility cost for this feature.
 */
export async function readWindowsWorkspaceShellPreference(
  path = windowsWorkspaceShellPreferencePath(),
  platform: NodeJS.Platform = process.platform,
): Promise<WindowsWorkspaceShellPreference> {
  if (platform !== 'win32') return { ...DEFAULT_PREFERENCE }
  try {
    return preferenceSchema.parse(JSON.parse(await readFile(path, 'utf8')))
  } catch {
    return { ...DEFAULT_PREFERENCE }
  }
}

export function validateWindowsWorkspaceShellPath(
  rawPath: string,
  fileExists: (path: string) => boolean = existsSync,
): string {
  const path = rawPath.trim()
  if (!win32.isAbsolute(path) || win32.basename(path).toLowerCase() !== 'bash.exe') {
    throw new InvalidWindowsWorkspaceShellPathError('customPath must be an absolute path to bash.exe')
  }
  if (!fileExists(path)) throw new InvalidWindowsWorkspaceShellPathError('customPath does not exist')
  return path
}

export function applyWindowsWorkspaceShellPreference(
  preference: WindowsWorkspaceShellPreference,
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): void {
  if (platform !== 'win32') return
  if (preference.mode === 'custom') env[OVERRIDE_ENV] = preference.customPath
  else delete env[OVERRIDE_ENV]
}

export async function initializeWindowsWorkspaceShellPreference(
  path = windowsWorkspaceShellPreferencePath(),
  platform: NodeJS.Platform = process.platform,
): Promise<void> {
  if (platform !== 'win32') return
  applyWindowsWorkspaceShellPreference(
    await readWindowsWorkspaceShellPreference(path, platform),
    process.env,
    platform,
  )
}

export async function saveWindowsWorkspaceShellPreference(
  input: { readonly mode: 'auto' | 'custom'; readonly customPath?: string | null },
  opts: {
    readonly path?: string
    readonly platform?: NodeJS.Platform
    readonly fileExists?: (path: string) => boolean
    readonly env?: NodeJS.ProcessEnv
  } = {},
): Promise<WindowsWorkspaceShellStatus> {
  const platform = opts.platform ?? process.platform
  if (platform !== 'win32') return { supported: false }

  const preference: WindowsWorkspaceShellPreference = input.mode === 'custom'
    ? {
        version: 1,
        mode: 'custom',
        customPath: validateWindowsWorkspaceShellPath(input.customPath ?? '', opts.fileExists),
      }
    : { ...DEFAULT_PREFERENCE }

  const path = opts.path ?? windowsWorkspaceShellPreferencePath()
  await mkdir(dirname(path), { recursive: true })
  const tempPath = `${path}.${process.pid}.tmp`
  try {
    await writeFile(tempPath, JSON.stringify(preference, null, 2) + '\n', { mode: 0o600 })
    await rename(tempPath, path)
  } catch (error) {
    await unlink(tempPath).catch(() => undefined)
    throw error
  }

  const env = opts.env ?? process.env
  applyWindowsWorkspaceShellPreference(preference, env, platform)
  return resolveWindowsWorkspaceShellStatus(preference, env, platform, opts.fileExists)
}

export function resolveWindowsWorkspaceShellStatus(
  preference: WindowsWorkspaceShellPreference,
  env: Readonly<Record<string, string | undefined>> = process.env,
  platform: NodeJS.Platform = process.platform,
  fileExists: (path: string) => boolean = existsSync,
): WindowsWorkspaceShellStatus {
  if (platform !== 'win32') return { supported: false }

  if (preference.mode === 'custom') {
    const valid = fileExists(preference.customPath)
    return {
      supported: true,
      mode: 'custom',
      customPath: preference.customPath,
      resolvedPath: preference.customPath,
      source: 'custom',
      valid,
      message: valid ? null : 'The configured bash.exe no longer exists.',
    }
  }

  const resolvedPath = resolveBashPath(env, platform)
  if (!resolvedPath) {
    return {
      supported: true,
      mode: 'auto',
      customPath: null,
      resolvedPath: null,
      source: 'none',
      valid: false,
      message: 'Git Bash was not found. Install Git for Windows or choose bash.exe manually.',
    }
  }

  const source: WindowsWorkspaceShellSource = samePath(resolvedPath, env['OPENALICE_MANAGED_SHELL_PATH'])
    ? 'managed'
    : samePath(resolvedPath, env['SHELL'])
      ? 'environment'
      : 'git-for-windows'
  const valid = fileExists(resolvedPath)
  return {
    supported: true,
    mode: 'auto',
    customPath: null,
    resolvedPath,
    source,
    valid,
    message: valid ? null : 'The resolved bash.exe no longer exists.',
  }
}

export async function getWindowsWorkspaceShellStatus(
  path = windowsWorkspaceShellPreferencePath(),
  platform: NodeJS.Platform = process.platform,
): Promise<WindowsWorkspaceShellStatus> {
  if (platform !== 'win32') return { supported: false }
  const preference = await readWindowsWorkspaceShellPreference(path, platform)
  return resolveWindowsWorkspaceShellStatus(preference, process.env, platform)
}

function samePath(left: string, right: string | undefined): boolean {
  return !!right && win32.normalize(left).toLowerCase() === win32.normalize(right).toLowerCase()
}
