import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer, type Server } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

function listen(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (address === null || typeof address === 'string') {
        reject(new Error('test server has no TCP port'))
        return
      }
      resolve(address.port)
    })
  })
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()))
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function stopChild(child: ChildProcessWithoutNullStreams): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return
  const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()))
  child.kill('SIGTERM')
  await Promise.race([exited, delay(3_000)])
  if (child.exitCode === null && child.signalCode === null) {
    child.kill('SIGKILL')
    await exited
  }
}

describe('UTA process startup resilience', () => {
  it('keeps serving while an IBKR account fails during protocol handshake', async () => {
    const home = await mkdtemp(join(tmpdir(), 'openalice-uta-handshake-'))
    const configDir = join(home, 'data', 'config')
    const fakeTws = createServer((socket) => {
      // Accept the TCP connection, consume the API greeting, then reproduce a
      // TWS/Gateway close before serverVersion/nextValidId arrives.
      socket.once('data', () => socket.destroy())
    })
    const fakeTwsPort = await listen(fakeTws)
    const utaPortReservation = createServer()
    const utaPort = await listen(utaPortReservation)
    await closeServer(utaPortReservation)
    await mkdir(configDir, { recursive: true })
    await Promise.all([
      writeFile(join(configDir, 'accounts.json'), JSON.stringify([{
        id: 'ibkr-handshake-down',
        label: 'IBKR handshake fixture',
        presetId: 'ibkr-tws',
        enabled: true,
        guards: [],
        presetConfig: { host: '127.0.0.1', port: fakeTwsPort, clientId: 19 },
        readOnly: true,
      }, {
        id: 'simulator-healthy',
        label: 'Unaffected simulator fixture',
        presetId: 'mock-simulator',
        enabled: true,
        guards: [],
        presetConfig: { cash: 100_000 },
        readOnly: true,
      }], null, 2)),
      writeFile(join(configDir, 'snapshot.json'), JSON.stringify({ enabled: false, every: '15m' })),
      writeFile(join(configDir, 'trading.json'), JSON.stringify({
        mode: 'readonly',
        observeExternalOrdersEvery: 'off',
        keylessDataSources: [],
      })),
    ])

    const child = spawn(process.execPath, ['--import', 'tsx', 'services/uta/src/main.ts'], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        NODE_OPTIONS: `${process.env['NODE_OPTIONS'] ?? ''} --conditions=openalice-source`.trim(),
        OPENALICE_HOME: home,
        OPENALICE_APP_HOME: process.cwd(),
        OPENALICE_UTA_PORT: String(utaPort),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let output = ''
    child.stdout.on('data', (chunk: Buffer) => { output += chunk.toString('utf8') })
    child.stderr.on('data', (chunk: Buffer) => { output += chunk.toString('utf8') })

    try {
      const deadline = Date.now() + 10_000
      type ListedAccount = {
        id?: string
        health?: { status?: string; reach?: string; connecting?: boolean; recovering?: boolean; lastError?: string }
      }
      let account: ListedAccount | undefined
      let unaffected: ListedAccount | undefined
      while (Date.now() < deadline) {
        if (child.exitCode !== null || child.signalCode !== null) {
          throw new Error(`UTA exited during one-account handshake failure:\n${output}`)
        }
        try {
          const health = await fetch(`http://127.0.0.1:${utaPort}/__uta/health`)
          const listing = await fetch(`http://127.0.0.1:${utaPort}/api/trading/uta`)
          if (health.ok && listing.ok) {
            const healthBody = await health.json() as { ok?: boolean; utas?: number }
            const listingBody = await listing.json() as { utas?: ListedAccount[] }
            const candidate = listingBody.utas?.find((uta) => (
              uta.id === 'ibkr-handshake-down'
            ))
            const healthyCandidate = listingBody.utas?.find((uta) => uta.id === 'simulator-healthy')
            if (
              healthBody.ok === true &&
              healthBody.utas === 2 &&
              candidate?.health?.status === 'offline' &&
              candidate.health.reach === 'down' &&
              candidate.health.connecting === false &&
              candidate.health.recovering === true &&
              healthyCandidate?.health?.status === 'healthy' &&
              healthyCandidate.health.reach === 'readable'
            ) {
              account = candidate
              unaffected = healthyCandidate
              break
            }
          }
        } catch {
          // Service is still binding or the account handshake has not settled.
        }
        await delay(50)
      }

      expect(account, output).toBeDefined()
      expect(account?.health?.lastError).toContain('closed during handshake')
      expect(unaffected?.health).toMatchObject({ status: 'healthy', reach: 'readable' })
      expect(child.exitCode).toBeNull()

      // Prove the service remains usable after the account failure, rather
      // than merely winning a race against process termination.
      await delay(100)
      const stillHealthy = await fetch(`http://127.0.0.1:${utaPort}/__uta/health`)
      await expect(stillHealthy.json()).resolves.toMatchObject({ ok: true, utas: 2 })
      expect(child.exitCode).toBeNull()
      expect(output).not.toContain('[uta] fatal:')
    } finally {
      await stopChild(child)
      await closeServer(fakeTws)
      await rm(home, { recursive: true, force: true })
    }
  }, 15_000)
})
