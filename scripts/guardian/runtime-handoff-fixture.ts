import { createServer } from 'node:http'

import {
  acquireGuardianRuntime,
  buildGuardianRuntimeStatus,
  startGuardianControlServer,
} from '../../packages/guardian-runtime/src/index.js'

const userDataHome = process.env['OPENALICE_HOME']
const launcherRoot = process.env['AQ_LAUNCHER_ROOT']
const surface = process.env['OPENALICE_RUNTIME_FIXTURE_SURFACE'] === 'cli-server'
  ? 'cli-server'
  : 'dev'

if (!userDataHome || !launcherRoot) {
  throw new Error('OPENALICE_HOME and AQ_LAUNCHER_ROOT are required')
}

const authServer = createServer((request, response) => {
  if (request.url === '/api/auth/status') {
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ authed: false, tokenConfigured: true }))
    return
  }
  response.writeHead(404)
  response.end()
})

await new Promise<void>((resolvePromise, rejectPromise) => {
  authServer.once('error', rejectPromise)
  authServer.listen(0, '127.0.0.1', () => resolvePromise())
})
const address = authServer.address()
if (!address || typeof address !== 'object') throw new Error('failed to bind handoff fixture')
const webUrl = `http://127.0.0.1:${address.port}`

const heartbeatMs = Number(process.env['OPENALICE_RUNTIME_FIXTURE_HEARTBEAT_MS'] ?? '200')
const guardianLock = await acquireGuardianRuntime({
  userDataHome,
  launcherRoot,
  launcher: `guardian-${surface}`,
  heartbeatMs,
})

const control = await startGuardianControlServer({
  homeRoot: userDataHome,
  allowStop: false,
  getStatus: () => buildGuardianRuntimeStatus({
    productVersion: '0.89.3-beta',
    state: 'running',
    home: userDataHome,
    owner: {
      surface,
      pid: process.pid,
      instanceId: 'handoff-fixture',
      startedAt: guardianLock.owner.acquiredAt,
      mode: 'foreground',
    },
    endpoints: { web: webUrl },
    provider: { kind: 'source' },
    startedAtMs: Date.now(),
    components: { alice: 'ready', uta: 'disabled', connector: 'disabled' },
    componentDetail: {
      alice: { state: 'ready', required: true, pid: process.pid },
      uta: { state: 'disabled', required: false },
      connector: { state: 'disabled', required: false },
    },
    capabilities: [],
  }),
  onStop: () => undefined,
})

console.log(`[handoff-fixture] ready pid=${process.pid} surface=${surface} web=${webUrl} home=${userDataHome}`)

let stopping = false
const shutdown = async (): Promise<void> => {
  if (stopping) return
  stopping = true
  await control.close()
  await guardianLock.release()
  await new Promise<void>((resolvePromise) => authServer.close(() => resolvePromise()))
  process.exit(0)
}
process.on('SIGINT', () => { void shutdown() })
process.on('SIGTERM', () => { void shutdown() })

setInterval(() => undefined, 60_000)
