import { existsSync, readFileSync } from 'node:fs'
import { delimiter, dirname, join, resolve } from 'node:path'

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
  const gitRoot = join(resourceRoot, 'runtime', 'git')
  const gitBin = join(gitRoot, 'bin')
  const runtimeEnv = buildExternalAgentRuntimeEnvironment(env)
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
    LOCAL_GIT_DIRECTORY: gitRoot,
    GIT_EXEC_PATH: join(gitRoot, 'libexec', 'git-core'),
    GIT_TEMPLATE_DIR: join(gitRoot, 'share', 'git-core', 'templates'),
    PATH: runtimeEnv.PATH ? `${gitBin}${delimiter}${runtimeEnv.PATH}` : gitBin,
  }
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
