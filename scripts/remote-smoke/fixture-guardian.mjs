import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'

import { startGuardianControlServer } from './control-server.mjs'

const home = process.env.OPENALICE_HOME
const port = Number(process.env.OPENALICE_WEB_PORT ?? 47331)
const surface = process.env.OPENALICE_LAUNCHER ?? 'cli-server'
const startedAt = new Date().toISOString()
const instanceId = randomUUID()
let stopping = false
let control

const http = createServer((request, response) => {
  if (request.url === '/api/auth/status') {
    response.setHeader('content-type', 'application/json')
    response.end(JSON.stringify({ authed: true, tokenConfigured: false, fixture: 'remote-ssh-smoke' }))
    return
  }
  response.statusCode = 404
  response.end('not found\n')
})

await new Promise((resolvePromise, rejectPromise) => {
  http.once('error', rejectPromise)
  http.listen(port, '127.0.0.1', resolvePromise)
})

control = await startGuardianControlServer({
  homeRoot: home,
  allowStop: surface === 'cli-server',
  getStatus: () => ({
    protocol: 1,
    runtimeVersion: '0.0.0-remote-smoke',
    state: stopping ? 'stopping' : 'running',
    home,
    owner: {
      surface,
      pid: process.pid,
      instanceId,
      startedAt,
      launchRoot: process.cwd(),
      mode: process.env.OPENALICE_SERVER_MODE ?? 'detached',
    },
    endpoints: { web: `http://127.0.0.1:${port}` },
    components: { alice: 'ready', uta: 'disabled', connector: 'disabled' },
    capabilities: surface === 'cli-server' ? ['runtime.stop'] : [],
  }),
  onStop: () => { void shutdown() },
})

async function shutdown() {
  if (stopping) return
  stopping = true
  await new Promise((resolvePromise) => http.close(resolvePromise))
  await control.close()
  process.exit(0)
}

process.on('SIGINT', () => { void shutdown() })
process.on('SIGTERM', () => { void shutdown() })
