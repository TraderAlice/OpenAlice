import { createServer } from 'node:net'
import { cp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url))
const pinnedBunVersion = (await readFile(join(repositoryRoot, '.bun-version'), 'utf8')).trim()
if (Bun.version !== pinnedBunVersion) {
  throw new Error(`Bun ${pinnedBunVersion} is required, but ${Bun.version} is running`)
}

const outputRoot = resolve(
  process.env['OPENALICE_BUN_OUTPUT_DIR']
    ?? join(repositoryRoot, 'dist/bun-alice-feasibility'),
)
const executableName = process.platform === 'win32' ? 'alice.exe' : 'alice'
const executablePath = join(outputRoot, executableName)
const smokeHome = join(outputRoot, 'smoke-home')

await rm(outputRoot, { recursive: true, force: true })
await mkdir(outputRoot, { recursive: true })
process.chdir(outputRoot)

const nodePtyPackage = dirname(
  createRequire(import.meta.url).resolve('node-pty/package.json'),
)
const nodePtySidecar = join(outputRoot, 'native', 'node-pty')
await cp(nodePtyPackage, nodePtySidecar, { recursive: true, dereference: true })

const buildStartedAt = performance.now()
const result = await Bun.build({
  entrypoints: [join(repositoryRoot, 'src/main.ts')],
  compile: {
    outfile: executablePath,
    autoloadBunfig: false,
    autoloadDotenv: false,
  },
  define: {
    'globalThis.__OPENALICE_BUN_STANDALONE__': 'true',
  },
  minify: true,
})
const buildDurationMs = performance.now() - buildStartedAt
if (!result.success) {
  for (const log of result.logs) console.error(log)
  throw new Error('Bun Alice feasibility build failed')
}

const [webPort, mcpPort, utaPort, connectorPort] = await allocatePorts(4)
const startedAt = performance.now()
const child = Bun.spawn([executablePath], {
  cwd: outputRoot,
  env: {
    HOME: smokeHome,
    PATH: '',
    TMPDIR: process.env['TMPDIR'] ?? '/tmp',
    OPENALICE_HOME: smokeHome,
    OPENALICE_APP_HOME: repositoryRoot,
    OPENALICE_TRADING_MODE: 'lite',
    OPENALICE_BIND_HOST: '127.0.0.1',
    OPENALICE_WEB_PORT: String(webPort),
    OPENALICE_MCP_PORT: String(mcpPort),
    OPENALICE_UTA_PORT: String(utaPort),
    OPENALICE_CONNECTOR_PORT: String(connectorPort),
  },
  stdout: 'pipe',
  stderr: 'pipe',
})
const stdoutPromise = new Response(child.stdout).text()
const stderrPromise = new Response(child.stderr).text()

let authStatus = 0
let rootStatus = 0
let readyDurationMs = 0
let probeError: unknown = null
try {
  const auth = await waitForHttp(`http://127.0.0.1:${webPort}/api/auth/status`, 30_000)
  authStatus = auth.status
  JSON.parse(auth.body)
  readyDurationMs = Math.round(performance.now() - startedAt)
  const root = await waitForHttp(`http://127.0.0.1:${webPort}/`, 10_000)
  rootStatus = root.status
  if (!root.body.includes('<div id="root">')) {
    throw new Error('compiled Alice root did not serve the real Web UI shell')
  }
} catch (error) {
  probeError = error
} finally {
  child.kill('SIGTERM')
}
const exitCode = await child.exited
const stdout = await stdoutPromise
const stderr = await stderrPromise
if (exitCode !== 0) {
  throw new Error(`compiled Alice exited with ${exitCode}: ${stderr || stdout}`)
}
if (probeError) {
  throw new Error(`compiled Alice probe failed: ${String(probeError)}\n${stderr || stdout}`)
}
if (authStatus !== 200 || rootStatus !== 200) {
  throw new Error(`compiled Alice HTTP probes failed: auth=${authStatus} root=${rootStatus}`)
}

const executable = await stat(executablePath)
const report = {
  schemaVersion: 1,
  status: 'pass',
  bunVersion: Bun.version,
  platform: process.platform,
  arch: process.arch,
  executable: basename(executablePath),
  executableBytes: executable.size,
  buildDurationMs: Math.round(buildDurationMs),
  readyDurationMs,
  authStatus,
  rootStatus,
  ptySidecar: 'native/node-pty',
  smokePath: '',
}
await writeFile(join(outputRoot, 'report.json'), `${JSON.stringify(report, null, 2)}\n`)
console.log(`Bun Alice feasibility boot passed: ${executablePath}`)
console.log(JSON.stringify(report))

async function waitForHttp(
  url: string,
  timeoutMs: number,
): Promise<{ status: number; body: string }> {
  const deadline = Date.now() + timeoutMs
  let lastError: unknown = null
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url)
      const body = await response.text()
      if (response.status === 200) return { status: response.status, body }
      lastError = new Error(`${url} returned ${response.status}`)
    } catch (error) {
      lastError = error
    }
    await Bun.sleep(100)
  }
  throw new Error(`Timed out waiting for ${url}: ${String(lastError)}`)
}

async function allocatePorts(count: number): Promise<number[]> {
  const ports: number[] = []
  for (let index = 0; index < count; index += 1) {
    const server = createServer()
    await new Promise<void>((resolveListen, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolveListen)
    })
    const address = server.address()
    if (!address || typeof address === 'string') {
      server.close()
      throw new Error('Could not allocate an isolated loopback port')
    }
    ports.push(address.port)
    await new Promise<void>((resolveClose, reject) => {
      server.close((error) => error ? reject(error) : resolveClose())
    })
  }
  return ports
}
