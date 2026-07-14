#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:net'

const home = await mkdtemp(join(tmpdir(), 'openalice-connector-smoke-'))
const port = await freePort()
const child = spawn(process.execPath, ['services/connector/dist/connector.cjs'], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    OPENALICE_HOME: home,
    OPENALICE_CONNECTOR_PORT: String(port),
  },
  stdio: ['ignore', 'pipe', 'pipe'],
})
let output = ''
child.stdout.on('data', (chunk) => { output += String(chunk) })
child.stderr.on('data', (chunk) => { output += String(chunk) })

try {
  const base = `http://127.0.0.1:${port}`
  await waitFor(`${base}/__connector/health`)
  const health = await fetch(`${base}/__connector/health`).then((response) => response.json())
  if (health.status !== 'healthy' || !Array.isArray(health.adapters)) {
    throw new Error(`unexpected health: ${JSON.stringify(health)}`)
  }
  const response = await fetch(`${base}/v1/notifications/inbox`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      id: 'smoke-entry',
      createdAt: new Date().toISOString(),
      workspaceId: 'smoke-workspace',
      title: 'Connector smoke',
      body: 'Accepted without any configured external adapter.',
    }),
  })
  const receipt = await response.json()
  if (response.status !== 202 || receipt.accepted !== true || typeof receipt.deliveryId !== 'string') {
    throw new Error(`delivery was not accepted: ${response.status} ${JSON.stringify(receipt)}`)
  }
  const journalPath = join(home, 'data', 'logs', 'connector-io.jsonl')
  const event = await waitForJournal(journalPath, receipt.deliveryId)
  if (event.stage !== 'notification.received' || event.payload?.notification?.id !== 'smoke-entry') {
    throw new Error(`unexpected connector I/O event: ${JSON.stringify(event)}`)
  }
  console.log(`connector smoke passed on 127.0.0.1:${port}`)
} catch (error) {
  console.error(output)
  throw error
} finally {
  child.kill('SIGTERM')
  await Promise.race([
    new Promise((resolveExit) => child.once('exit', resolveExit)),
    new Promise((resolveWait) => setTimeout(resolveWait, 3_000)),
  ])
  if (child.exitCode === null) child.kill('SIGKILL')
  await rm(home, { recursive: true, force: true })
}

async function freePort() {
  const server = createServer()
  await new Promise((resolveListen, rejectListen) => {
    server.once('error', rejectListen)
    server.listen(0, '127.0.0.1', resolveListen)
  })
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : 0
  await new Promise((resolveClose) => server.close(resolveClose))
  return port
}

async function waitFor(url) {
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Connector Service exited early (${child.exitCode})`)
    try {
      const response = await fetch(url)
      if (response.ok) return
    } catch { /* retry */ }
    await new Promise((resolveWait) => setTimeout(resolveWait, 100))
  }
  throw new Error(`Connector Service did not become ready: ${url}`)
}

async function waitForJournal(path, correlationId) {
  const deadline = Date.now() + 3_000
  while (Date.now() < deadline) {
    try {
      const events = (await readFile(path, 'utf8')).trim().split(/\r?\n/).filter(Boolean).map(JSON.parse)
      const event = events.find((item) => item.correlationId === correlationId)
      if (event) return event
    } catch { /* journal not flushed yet */ }
    await new Promise((resolveWait) => setTimeout(resolveWait, 30))
  }
  throw new Error(`Connector I/O journal did not record ${correlationId}`)
}
