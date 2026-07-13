import {
  acquireGuardianRuntime,
  acquireOpenAliceRuntimeLocks,
} from '../../packages/guardian-runtime/src/index.js'

const userDataHome = process.env['OPENALICE_HOME']
const launcherRoot = process.env['AQ_LAUNCHER_ROOT']
const mode = process.env['OPENALICE_RUNTIME_FIXTURE_MODE'] ?? 'healthy'
const heartbeatMs = Number(process.env['OPENALICE_RUNTIME_FIXTURE_HEARTBEAT_MS'] ?? '100')
const emulateGuardian = process.env['OPENALICE_RUNTIME_FIXTURE_GUARDIAN'] === '1'

if (!userDataHome || !launcherRoot) {
  throw new Error('OPENALICE_HOME and AQ_LAUNCHER_ROOT are required')
}

const guardianLock = emulateGuardian
  ? await acquireGuardianRuntime({
      userDataHome,
      launcherRoot,
      launcher: `fixture-guardian-${mode}`,
      heartbeatMs,
    })
  : null

const locks = await acquireOpenAliceRuntimeLocks({
  userDataHome,
  launcherRoot,
  launcher: `fixture-${mode}`,
  heartbeatMs,
  onOwnershipLost: (err) => {
    console.error(`[runtime-fixture] ownership-lost ${err.message}`)
    process.exit(70)
  },
})

console.log(`[runtime-fixture] ready pid=${process.pid} mode=${mode}`)

if (mode === 'crash') {
  setTimeout(() => process.kill(process.pid, 'SIGKILL'), 100).unref()
} else if (mode === 'stubborn') {
  process.on('SIGTERM', () => {
    console.log('[runtime-fixture] ignored SIGTERM')
  })
} else {
  let stopping = false
  const shutdown = async (): Promise<void> => {
    if (stopping) return
    stopping = true
    await locks.release()
    await guardianLock?.release()
    process.exit(0)
  }
  process.on('SIGINT', () => { void shutdown() })
  process.on('SIGTERM', () => { void shutdown() })
}

setInterval(() => undefined, 60_000)
