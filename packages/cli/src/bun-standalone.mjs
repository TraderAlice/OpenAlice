import { existsSync, readFileSync } from 'node:fs'
import { dirname, posix, win32, resolve } from 'node:path'
import { inspectSystemDependencies } from './system-dependencies.mjs'

export function isBunStandalone() {
  return globalThis.__OPENALICE_BUN_STANDALONE__ === true
}

export function resolveBunResourceRoot(env = process.env, executable = process.execPath) {
  return resolve(
    env.OPENALICE_APP_HOME?.trim()
      || resolve(dirname(executable), '..', 'share', 'openalice'),
  )
}

export function bunInstallSourceLocations(
  env = process.env,
  executable = process.execPath,
  resourceRoot = resolveBunResourceRoot(env, executable),
) {
  const explicit = env.OPENALICE_INSTALL_SOURCE?.trim()
  if (explicit) return [explicit]
  return [
    resolve(dirname(dirname(executable)), 'install-source.json'),
    resolve(resourceRoot, 'install-source.json'),
  ]
}

export function resolveBunInstallSourcePath(
  env = process.env,
  executable = process.execPath,
  resourceRoot = resolveBunResourceRoot(env, executable),
  exists = existsSync,
) {
  const locations = bunInstallSourceLocations(env, executable, resourceRoot)
  if (env.OPENALICE_INSTALL_SOURCE?.trim()) return locations[0]
  return locations.find((path) => exists(path)) ?? null
}

export function bunGuardianProcessSpec(executable = process.execPath) {
  return {
    cmd: executable,
    args: ['--internal-role', 'guardian'],
  }
}

export function buildExternalAgentRuntimeEnvironment(env) {
  const externalEnv = { ...env }
  delete externalEnv.OPENALICE_MANAGED_PI_PATH
  delete externalEnv.OPENALICE_MANAGED_PI_NODE_PATH
  return externalEnv
}

export function buildBunRuntimeEnvironment(
  env,
  resourceRoot,
  executable = process.execPath,
  options = {},
) {
  const windows = (options.platform ?? process.platform) === 'win32'
  const path = windows ? win32 : posix
  const runtimeEnv = buildExternalAgentRuntimeEnvironment(env)
  // Windows environment names are case-insensitive; do not pass both Path and PATH.
  const inheritedPath = runtimeEnv.PATH ?? runtimeEnv.Path ?? ''
  if (windows) delete runtimeEnv.Path
  const checks = options.dependencyChecks ?? []
  const git = checks.find(check => check.id === 'git' && check.status === 'available')?.executable
  const bash = checks.find(check => check.id === 'bash' && check.status === 'available')?.executable
  // These select desktop-owned runtimes, not the user's system installation.
  delete runtimeEnv.LOCAL_GIT_DIRECTORY
  delete runtimeEnv.OPENALICE_MANAGED_SHELL_PATH
  delete runtimeEnv.OPENALICE_SYSTEM_GIT_PATH
  const systemPaths = [...new Set([git, bash].filter(Boolean).map(file => path.dirname(file)))]
  const installSource = resolveBunInstallSourcePath(
    runtimeEnv,
    executable,
    resourceRoot,
    options.exists ?? existsSync,
  )
  return {
    ...runtimeEnv,
    ...(installSource ? { OPENALICE_INSTALL_SOURCE: installSource } : {}),
    OPENALICE_RUNTIME_EXECUTABLE: executable,
    ...(git ? { OPENALICE_SYSTEM_GIT_PATH: git } : {}),
    ...(windows && bash ? { OPENALICE_MANAGED_SHELL_PATH: bash } : {}),
    PATH: [...systemPaths, ...(inheritedPath ? [inheritedPath] : [])].join(windows ? ';' : ':'),
  }
}

export async function prepareBunRuntimeEnvironment(env, resourceRoot, executable, options = {}) {
  const inspect = options.inspectDependencies ?? inspectSystemDependencies
  const dependencyChecks = await inspect({ env, platform: options.platform ?? process.platform })
  const unavailable = dependencyChecks.filter(check => check.status !== 'available')
  if (unavailable.length) {
    throw new Error(`System dependencies unavailable: ${unavailable.map(check => `${check.id} (${check.status})`).join(', ')}. Run openalice setup to finish installation.`)
  }
  return buildBunRuntimeEnvironment(env, resourceRoot, executable, { ...options, dependencyChecks })
}

export function resolveBunContentIdentity(resourceRoot, env = process.env, read = readFileSync) {
  const explicit = env.OPENALICE_RUNTIME_CONTENT_IDENTITY?.trim()
  if (explicit && /^[A-Za-z0-9._-]{1,128}$/.test(explicit)) return explicit
  for (const path of [
    resolve(resourceRoot, '..', '..', 'release.json'),
    resolve(resourceRoot, 'release.json'),
  ]) {
    try {
      const release = JSON.parse(read(path, 'utf8'))
      if (
        typeof release.contentIdentity === 'string'
        && /^[A-Za-z0-9._-]{1,128}$/.test(release.contentIdentity)
      ) return release.contentIdentity
    } catch {
      // Try the package-manager layout before reporting no identity.
    }
  }
  return null
}
