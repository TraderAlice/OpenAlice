import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { createServer } from 'node:http'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const fixture = fileURLToPath(new URL('./alice-shutdown-fixture.ts', import.meta.url))

function deadline<T>(promise: Promise<T>, ms: number, label: () => string): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(label())), ms) }),
  ]).finally(() => clearTimeout(timer))
}

describe('Alice news module shutdown ownership', () => {
  it.each([
    { closeFails: false, exitCode: 0 },
    { closeFails: true, exitCode: 1 },
  ])('real IPC shutdown keeps runtime ownership only when module close fails ($closeFails)', async ({ closeFails, exitCode }) => {
    const home = await mkdtemp(join(tmpdir(), 'alice-news-shutdown-'))
    const configDir = join(home, 'data', 'config')
    const equityCacheDir = join(home, 'data', 'cache', 'equity')
    await Promise.all([mkdir(configDir, { recursive: true }), mkdir(equityCacheDir, { recursive: true })])
    await Promise.all([
      writeFile(join(configDir, 'news.json'), JSON.stringify({ enabled: false, feeds: [], modules: [], subscriptions: [] })),
      writeFile(join(equityCacheDir, 'symbols.json'), JSON.stringify({ cachedAt: new Date().toISOString(), sources: ['sec'], count: 0, entries: [] })),
    ])

    const connector = createServer((_, response) => response.writeHead(503).end())
    connector.listen(0, '127.0.0.1')
    await once(connector, 'listening')
    const connectorAddress = connector.address()
    if (!connectorAddress || typeof connectorAddress === 'string') throw new Error('Missing isolated Connector port')
    const child = spawn(process.execPath, ['--import', 'tsx', fixture], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        NODE_OPTIONS: '--conditions=openalice-source',
        OPENALICE_HOME: home,
        OPENALICE_APP_HOME: process.cwd(),
        AQ_LAUNCHER_ROOT: join(home, 'workspaces'),
        OPENALICE_GLOBAL_DIR: join(home, 'global'),
        HOME: home,
        USERPROFILE: home,
        OPENALICE_LITE_MODE: '1',
        OPENALICE_MCP_ENABLED: '0',
        OPENALICE_LOCAL_CLI_ON_WEB: '1',
        OPENALICE_WEB_TRANSPORT: 'ipc',
        OPENALICE_CONNECTOR_URL: `http://127.0.0.1:${connectorAddress.port}`,
        OPENALICE_TOOL_SOCKET: '',
        OPENALICE_TEST_FAIL_MODULE_CLOSE: closeFails ? '1' : '0',
      },
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    })
    let output = ''
    // Startup auth banners are private test state, not failure diagnostics.
    const diagnostics = () => output.split(/\r?\n/).filter(line => /^(?:news-test:|engine:|news-collector:|uta:|equity:|fatal:|plugin started:|web plugin listening)/.test(line)).slice(-20).join('\n')
    try {
      const ready = new Promise<void>((resolve, reject) => {
        const capture = (chunk: Buffer) => {
          output += chunk.toString('utf8')
          if (output.includes('engine: started')) resolve()
        }
        child.stdout!.on('data', capture)
        child.stderr!.on('data', capture)
        child.once('exit', (code, signal) => reject(new Error(`Alice exited before readiness (code=${code}, signal=${signal}):
${diagnostics()}`)))
        child.once('error', reject)
      })
      // Source initialization imports every provider before the shutdown behavior can run.
      await deadline(ready, 150_000, () => `Alice did not start:
${diagnostics()}`)

      const lockDirs = [join(home, 'workspaces', 'state', 'runtime.lock'), join(home, 'state', 'runtime.lock')]
      for (const lockDir of lockDirs) {
        const owner = JSON.parse(await readFile(join(lockDir, 'owner.json'), 'utf8')) as { pid: number }
        expect(owner.pid).toBe(child.pid)
      }

      const exited = once(child, 'exit') as Promise<[number | null, NodeJS.Signals | null]>
      child.send({ type: 'openalice:shutdown' })
      const [code, signal] = await deadline(exited, 15_000, () => `Alice did not finish IPC shutdown:
${diagnostics()}`)
      expect(signal).toBeNull()
      expect(existsSync(join(home, 'state', 'module-close-attempted'))).toBe(closeFails)
      expect(code).toBe(exitCode)
      for (const lockDir of lockDirs) {
        if (closeFails) {
          const owner = JSON.parse(await readFile(join(lockDir, 'owner.json'), 'utf8')) as { pid: number }
          expect(owner.pid).toBe(child.pid)
        } else {
          expect(existsSync(lockDir)).toBe(false)
        }
      }
    } finally {
      if (child.pid && child.exitCode === null && child.signalCode === null) {
        const exited = once(child, 'exit')
        child.kill('SIGKILL')
        await deadline(exited, 5_000, () => `Alice test child would not exit:
${diagnostics()}`)
      }
      await new Promise<void>(resolve => connector.close(() => resolve()))
      await rm(home, { recursive: true, force: true })
    }
  }, 170_000)
})
