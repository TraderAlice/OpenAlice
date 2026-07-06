export const ALICE_BACKEND_WATCH_INCLUDES = ['src', 'packages'] as const
export const UTA_BACKEND_WATCH_INCLUDES = ['services/uta/src', 'packages'] as const
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
