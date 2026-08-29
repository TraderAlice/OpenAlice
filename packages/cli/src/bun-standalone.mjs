import { readFileSync } from 'node:fs'
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

export function bunGuardianProcessSpec(executable = process.execPath) {
  return {
    cmd: executable,
    args: ['--internal-role', 'guardian'],
  }
}

export function buildBunRuntimeEnvironment(
  env,
  resourceRoot,
  executable = process.execPath,
) {
  const gitRoot = join(resourceRoot, 'runtime', 'git')
  const gitBin = join(gitRoot, 'bin')
  return {
    ...env,
    OPENALICE_RUNTIME_EXECUTABLE: executable,
    LOCAL_GIT_DIRECTORY: gitRoot,
    GIT_EXEC_PATH: join(gitRoot, 'libexec', 'git-core'),
    GIT_TEMPLATE_DIR: join(gitRoot, 'share', 'git-core', 'templates'),
    PATH: env.PATH ? `${gitBin}${delimiter}${env.PATH}` : gitBin,
  }
}

export function resolveBunContentIdentity(resourceRoot, env = process.env, read = readFileSync) {
  const explicit = env.OPENALICE_RUNTIME_CONTENT_IDENTITY?.trim()
  if (explicit && /^[A-Za-z0-9._-]{1,128}$/.test(explicit)) return explicit
  try {
    const release = JSON.parse(read(resolve(resourceRoot, '..', '..', 'release.json'), 'utf8'))
    return typeof release.contentIdentity === 'string'
      && /^[A-Za-z0-9._-]{1,128}$/.test(release.contentIdentity)
      ? release.contentIdentity
      : null
  } catch {
    return null
  }
}
