import { dirname, resolve } from 'node:path'

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
