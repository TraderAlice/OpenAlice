import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

export function pinnedBunVersion() {
  const version = readFileSync(new URL('../.bun-version', import.meta.url), 'utf8').trim()
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Invalid exact .bun-version')
  return version
}

export function requireBunVersion(actual) {
  const expected = pinnedBunVersion()
  if (actual !== expected) throw new Error(`Bun ${expected} is required, but ${actual} is running`)
  return actual
}

// Check the same executable subsequently used to compile, including manual PATH runs.
export function requireBunExecutable(executable = 'bun', options = {}) {
  return requireBunVersion(execFileSync(executable, ['--version'], {
    ...options, encoding: 'utf8', timeout: 30_000,
  }).trim())
}
