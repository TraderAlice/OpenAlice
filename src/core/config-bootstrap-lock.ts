import {
  RuntimeAlreadyRunningError,
  acquireRuntimeLock,
  type RuntimeProcessLock,
} from '@traderalice/guardian-runtime'

import { dataPath } from './paths.js'

const DEFAULT_WAIT_MS = 120_000
const DEFAULT_POLL_MS = 25
const DEFAULT_LOCK_DIR = dataPath('state', 'config-bootstrap.lock')

export interface ConfigBootstrapLockOptions {
  /** Override only for isolated tests. Production always uses the user-data root. */
  readonly lockDir?: string
  readonly waitMs?: number
  readonly pollMs?: number
}

function positiveEnvNumber(name: string): number | undefined {
  const value = Number(process.env[name])
  return Number.isSafeInteger(value) && value > 0 ? value : undefined
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Serialize config bootstrap across Alice and UTA processes sharing one home.
 *
 * Both children legitimately call `loadConfig()` during startup. That path is
 * write-capable: it runs migrations and seeds missing defaults. A Guardian
 * runtime lock prevents a second OpenAlice instance, but it intentionally does
 * not prevent sibling Alice/UTA children from running together, so this
 * shorter critical-section lock is still required.
 *
 * A live owner is waited on and never taken over. Dead owners are reclaimed by
 * the Guardian lock primitive using PID/start-time/token identity, which keeps
 * crash recovery safe without treating a stale heartbeat as permission to
 * unlock a process that may still write.
 */
export async function withConfigBootstrapLock<T>(
  run: () => Promise<T>,
  opts: ConfigBootstrapLockOptions = {},
): Promise<T> {
  const lockDir = opts.lockDir ?? DEFAULT_LOCK_DIR
  const waitMs = opts.waitMs ?? DEFAULT_WAIT_MS
  const pollMs = opts.pollMs ?? DEFAULT_POLL_MS
  const deadline = Date.now() + waitMs
  let lock: RuntimeProcessLock | null = null

  while (lock === null) {
    try {
      lock = await acquireRuntimeLock(lockDir, {
        launcher: `${process.env['OPENALICE_LAUNCHER'] ?? 'standalone'}-config-bootstrap`,
        guardianPid: positiveEnvNumber('OPENALICE_GUARDIAN_PID'),
        guardianStartedAt: positiveEnvNumber('OPENALICE_GUARDIAN_STARTED_AT'),
      })
    } catch (err) {
      if (!(err instanceof RuntimeAlreadyRunningError)) throw err
      if (Date.now() >= deadline) {
        const owner = err.inspection.owner
        throw new Error(
          owner
            ? `Timed out waiting for config bootstrap owned by ${owner.launcher} pid=${owner.pid}`
            : `Timed out waiting for config bootstrap lock at ${lockDir}: ${err.inspection.reason}`,
          { cause: err },
        )
      }
      await sleep(Math.min(pollMs, Math.max(1, deadline - Date.now())))
    }
  }

  try {
    return await run()
  } finally {
    await lock.release()
  }
}
