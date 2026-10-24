import { resolve } from 'node:path'

/**
 * Default gate for Alice's `/api/version` readiness probe. A cold `tsx` boot
 * on a loaded Windows machine can legitimately take most of this, so the gate
 * is overridable — an abort that fires before a slow-but-healthy child binds
 * its port looks identical to a child that crashed.
 */
export const DEFAULT_GUARDIAN_READY_TIMEOUT_MS = 20_000

const READY_TIMEOUT_ENV = 'OPENALICE_GUARDIAN_READY_TIMEOUT_MS'

export interface DevGuardianOptions {
  readonly home: string | null
  readonly relay: boolean
  /** How long Guardian waits for Alice to answer before aborting the boot. */
  readonly readyTimeoutMs: number
}

function parseReadyTimeout(raw: string, origin: string): number {
  const ms = Number(raw)
  if (!raw || !Number.isInteger(ms) || ms < 1_000 || ms > 600_000) {
    throw new Error(`${origin} requires an integer from 1000 to 600000 milliseconds (got ${JSON.stringify(raw)})`)
  }
  return ms
}

export function parseDevGuardianOptions(
  argv: readonly string[],
  cwd = process.cwd(),
  env: NodeJS.ProcessEnv = process.env,
): DevGuardianOptions {
  let home: string | null = null
  let relay = true
  let readyTimeoutMs: number | null = null
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--') continue
    if (arg === '--no-relay') { relay = false; continue }
    if (arg === '--ready-timeout') {
      readyTimeoutMs = parseReadyTimeout(argv[index + 1] ?? '', '--ready-timeout')
      index += 1
      continue
    }
    if (arg.startsWith('--ready-timeout=')) {
      readyTimeoutMs = parseReadyTimeout(arg.slice('--ready-timeout='.length).trim(), '--ready-timeout')
      continue
    }
    if (arg === '--home') {
      const value = argv[index + 1]
      if (!value || value === '--' || value.startsWith('--')) {
        throw new Error('--home requires a directory path')
      }
      home = resolve(cwd, value)
      index += 1
      continue
    }
    if (arg.startsWith('--home=')) {
      const value = arg.slice('--home='.length).trim()
      if (!value) throw new Error('--home requires a directory path')
      home = resolve(cwd, value)
    }
  }
  if (readyTimeoutMs === null && env[READY_TIMEOUT_ENV]) {
    readyTimeoutMs = parseReadyTimeout(env[READY_TIMEOUT_ENV], READY_TIMEOUT_ENV)
  }
  return { home, relay, readyTimeoutMs: readyTimeoutMs ?? DEFAULT_GUARDIAN_READY_TIMEOUT_MS }
}
