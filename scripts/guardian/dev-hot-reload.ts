import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

export const ALICE_BACKEND_WATCH_INCLUDES = ['src', 'packages'] as const
export const UTA_BACKEND_WATCH_INCLUDES = ['services/uta/src', 'packages'] as const
export const CONNECTOR_BACKEND_WATCH_INCLUDES = ['services/connector/src', 'packages/connector-protocol/src', 'src/core'] as const
export const BACKEND_WATCH_EXCLUDES = [
  'src/**/*.spec.ts',
  'src/**/__test__/**',
  'src/**/__tests__/**',
  'services/uta/src/**/*.spec.ts',
  'services/uta/src/**/__test__/**',
  'services/uta/src/**/__tests__/**',
  'packages/**/*.spec.ts',
  'packages/**/dist/**',
  'packages/**/.turbo/**',
] as const

const TRUTHY = new Set(['1', 'true', 'yes', 'on'])
const FALSY = new Set(['0', 'false', 'no', 'off'])

export function isBackendHotReloadEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env['OPENALICE_BACKEND_HOT_RELOAD']?.trim().toLowerCase()
  if (!raw) return true
  if (FALSY.has(raw)) return false
  if (TRUTHY.has(raw)) return true
  return true
}

export function buildTsxWatchArgs(
  entry: string,
  includes: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  if (!isBackendHotReloadEnabled(env)) {
    return [entry]
  }
  return [
    'watch',
    '--clear-screen=false',
    ...includes.flatMap((path) => ['--include', path]),
    ...BACKEND_WATCH_EXCLUDES.flatMap((path) => ['--exclude', path]),
    entry,
  ]
}

interface FsEventsModule {
  watch: (dir: string, callback: () => void) => () => Promise<void> | void
}

function loadFsEvents(appRoot: string): FsEventsModule | null {
  try {
    const uiReq = createRequire(resolve(appRoot, 'ui', 'package.json'))
    const vitePkg = uiReq.resolve('vite/package.json')
    const viteReq = createRequire(vitePkg)
    const mod = viteReq('fsevents') as Partial<FsEventsModule> | undefined
    return typeof mod?.watch === 'function' ? (mod as FsEventsModule) : null
  } catch {
    return null
  }
}

/**
 * Sandboxed macOS environments (e.g. Seatbelt / sandbox-exec) silently drop
 * FSEvents callbacks without throwing, leaving Vite and tsx watch blind to
 * file edits. Probe with a short-lived temp file to detect silent blocking.
 */
export async function probeFsEventsWorking(options: {
  appRoot?: string
  timeoutMs?: number
} = {}): Promise<boolean> {
  const fsevents = loadFsEvents(options.appRoot ?? process.cwd())
  if (!fsevents) return true

  const timeoutMs = options.timeoutMs ?? 450
  const dir = mkdtempSync(join(tmpdir(), 'openalice-fsevents-probe-'))
  let stop: (() => Promise<void> | void) | null = null
  let writeTimer: ReturnType<typeof setTimeout> | null = null
  let timeoutTimer: ReturnType<typeof setTimeout> | null = null

  try {
    return await new Promise<boolean>((resolveProbe) => {
      let settled = false
      const finish = (working: boolean) => {
        if (settled) return
        settled = true
        if (writeTimer) clearTimeout(writeTimer)
        if (timeoutTimer) clearTimeout(timeoutTimer)
        resolveProbe(working)
      }

      stop = fsevents.watch(dir, () => finish(true))
      writeTimer = setTimeout(() => {
        try {
          writeFileSync(join(dir, 'probe'), '1')
        } catch {
          finish(false)
        }
      }, 20)
      timeoutTimer = setTimeout(() => finish(false), timeoutMs)
    })
  } catch {
    return false
  } finally {
    const cleanup = stop as (() => Promise<void> | void) | null
    try {
      await cleanup?.()
    } catch { /* ignore */ }
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch { /* ignore */ }
  }
}

export interface DevWatchEnvResolution {
  viteEnv: Record<string, string>
  backendEnv: Record<string, string>
  diagnostic?: string
}

export async function resolveDevWatchEnv(
  env: NodeJS.ProcessEnv = process.env,
  options: {
    platform?: NodeJS.Platform
    probe?: () => Promise<boolean>
    appRoot?: string
  } = {},
): Promise<DevWatchEnvResolution> {
  const platform = options.platform ?? process.platform
  if (platform !== 'darwin') return { viteEnv: {}, backendEnv: {} }
  if (env['CHOKIDAR_USEPOLLING'] !== undefined || env['OPENALICE_VITE_USE_FSEVENTS'] !== undefined) {
    return { viteEnv: {}, backendEnv: {} }
  }

  const working = await (options.probe ?? (() => probeFsEventsWorking({ appRoot: options.appRoot })))()
  if (working) return { viteEnv: {}, backendEnv: {} }

  return {
    viteEnv: { OPENALICE_VITE_USE_FSEVENTS: '0' },
    backendEnv: { CHOKIDAR_USEPOLLING: '1', CHOKIDAR_INTERVAL: '300' },
    diagnostic: 'watch    →  fsevents unavailable (sandboxed macOS?); falling back to fs.watch for Vite and polling for backend watch',
  }
}
