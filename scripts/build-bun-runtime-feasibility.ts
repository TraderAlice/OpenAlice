import { createServer } from 'node:net'
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url))
const pinnedBunVersion = (await readFile(join(repositoryRoot, '.bun-version'), 'utf8')).trim()
if (Bun.version !== pinnedBunVersion) {
  throw new Error(`Bun ${pinnedBunVersion} is required, but ${Bun.version} is running`)
}

const product = JSON.parse(await readFile(join(repositoryRoot, 'package.json'), 'utf8')) as {
  version?: unknown
}
if (typeof product.version !== 'string' || product.version.length === 0) {
  throw new Error('package.json must contain a version')
}

const outputRoot = resolve(
  process.env['OPENALICE_BUN_OUTPUT_DIR']
    ?? join(repositoryRoot, 'dist/bun-runtime-feasibility'),
)
const executablePath = join(
  outputRoot,
  process.platform === 'win32' ? 'openalice.exe' : 'openalice',
)
const smokeHome = join(outputRoot, 'smoke-home')

await rm(outputRoot, { recursive: true, force: true })
await mkdir(join(smokeHome, 'data/config'), { recursive: true })
await writeFile(
  join(smokeHome, 'data/config/connector-service.json'),
  `${JSON.stringify({ enabled: true, adapters: {} }, null, 2)}\n`,
)

const buildStartedAt = performance.now()
const build = await Bun.build({
  entrypoints: [join(repositoryRoot, 'packages/cli/bin/openalice-bun.ts')],
  compile: {
    outfile: executablePath,
    autoloadBunfig: false,
    autoloadDotenv: false,
  },
  define: {
    'globalThis.__OPENALICE_BUILD_VERSION__': JSON.stringify(product.version),
    'globalThis.__OPENALICE_BUN_STANDALONE__': 'true',
  },
  minify: true,
})
if (!build.success) {
  for (const log of build.logs) console.error(log)
  throw new Error('Bun multiprocess Runtime build failed')
}
const buildDurationMs = Math.round(performance.now() - buildStartedAt)

const [webPort, mcpPort, utaPort, connectorPort] = await allocatePorts(4)
const smokeEnvironment = minimalSmokeEnvironment({
  home: smokeHome,
  executable: executablePath,
  webPort,
  mcpPort,
  utaPort,
  connectorPort,
})
const version = runProbe(['--version'], smokeEnvironment)
if (version.stdout.trim() !== product.version) {
  throw new Error(`compiled Runtime reported version ${JSON.stringify(version.stdout.trim())}`)
}

const runtimeStartedAt = performance.now()
const runtime = Bun.spawn([
  executablePath,
  'run',
  '--home', smokeHome,
  '--port', String(webPort),
  '--wait', '90',
  '--no-update-check',
], {
  cwd: outputRoot,
  env: smokeEnvironment,
  stdout: 'pipe',
  stderr: 'pipe',
})
const stdoutPromise = new Response(runtime.stdout).text()
const stderrPromise = new Response(runtime.stderr).text()

let acceptanceError: unknown = null
let initialStatus: RuntimeStatus | null = null
let recoveredStatus: RuntimeStatus | null = null
let readyDurationMs = 0
try {
  await Promise.all([
    waitForHttp(`http://127.0.0.1:${webPort}/api/auth/status`, 90_000),
    waitForHttp(`http://127.0.0.1:${utaPort}/__uta/health`, 90_000),
    waitForHttp(`http://127.0.0.1:${connectorPort}/__connector/health`, 90_000),
  ])
  initialStatus = await waitForRuntimeStatus(smokeEnvironment, (status) => (
    status.class === 'running'
      && status.provider?.kind === 'bun'
      && status.componentDetail?.alice?.state === 'ready'
      && status.componentDetail?.uta?.state === 'ready'
      && status.componentDetail?.connector?.state === 'ready'
  ))
  readyDurationMs = Math.round(performance.now() - runtimeStartedAt)
  const initialPids = runtimePids(initialStatus)
  if (new Set(initialPids).size !== 4) {
    throw new Error(`Guardian/Alice/UTA/Connector did not have four distinct PIDs: ${initialPids}`)
  }

  const connectorPid = initialStatus.componentDetail?.connector?.pid
  if (!connectorPid) throw new Error('Connector PID was missing from Runtime status')
  process.kill(connectorPid, 'SIGKILL')
  recoveredStatus = await waitForRuntimeStatus(smokeEnvironment, (status) => (
    status.class === 'running'
      && status.componentDetail?.alice?.pid === initialStatus?.componentDetail?.alice?.pid
      && status.componentDetail?.connector?.state === 'ready'
      && typeof status.componentDetail?.connector?.pid === 'number'
      && status.componentDetail.connector.pid !== connectorPid
  ), 30_000)

  const utaPid = recoveredStatus.componentDetail?.uta?.pid
  if (!utaPid) throw new Error('UTA PID was missing from Runtime status')
  process.kill(utaPid, 'SIGKILL')
  await waitForRuntimeStatus(smokeEnvironment, (status) => (
    status.class === 'running'
      && status.componentDetail?.alice?.state === 'ready'
      && status.componentDetail?.uta?.state === 'offline'
  ), 15_000)
  await waitForHttp(`http://127.0.0.1:${webPort}/api/auth/status`, 5_000)
  await writeFile(join(smokeHome, 'data/control/restart-uta.flag'), `${Date.now()}\n`)
  recoveredStatus = await waitForRuntimeStatus(smokeEnvironment, (status) => (
    status.class === 'running'
      && status.componentDetail?.alice?.state === 'ready'
      && status.componentDetail?.uta?.state === 'ready'
      && typeof status.componentDetail?.uta?.pid === 'number'
      && status.componentDetail.uta.pid !== utaPid
  ), 30_000)
} catch (error) {
  acceptanceError = error
} finally {
  runtime.kill('SIGTERM')
}

const exitCode = await runtime.exited
const stdout = await stdoutPromise
const stderr = await stderrPromise
if (acceptanceError) {
  throw new Error(
    `Bun multiprocess acceptance failed: ${String(acceptanceError)}\n--- stdout ---\n${stdout}\n--- stderr ---\n${stderr}`,
  )
}
if (exitCode !== 0) {
  throw new Error(`Bun multiprocess Runtime exited with ${exitCode}: ${stderr || stdout}`)
}
await waitForRuntimeStatus(smokeEnvironment, (status) => status.class === 'absent', 15_000)

const executable = await stat(executablePath)
const report = {
  schemaVersion: 1,
  status: 'pass',
  productVersion: product.version,
  bunVersion: Bun.version,
  platform: process.platform,
  arch: process.arch,
  executable: basename(executablePath),
  executableBytes: executable.size,
  buildDurationMs,
  readyDurationMs,
  processModel: {
    guardianPid: initialStatus?.owner?.pid,
    alicePid: initialStatus?.componentDetail?.alice?.pid,
    utaPid: initialStatus?.componentDetail?.uta?.pid,
    connectorPid: initialStatus?.componentDetail?.connector?.pid,
    connectorRecoveredPid: recoveredStatus?.componentDetail?.connector?.pid,
    utaRecoveredPid: recoveredStatus?.componentDetail?.uta?.pid,
  },
  isolation: {
    connectorRestartedWithoutAliceRestart: true,
    utaFailureKeptAliceReady: true,
    utaRestartedOnControlFlag: true,
    runtimeLockReleasedAfterSignal: true,
  },
  nodeOrBunOnPath: false,
}
await writeFile(join(outputRoot, 'report.json'), `${JSON.stringify(report, null, 2)}\n`)
console.log(`Bun multiprocess Runtime feasibility passed: ${executablePath}`)
console.log(JSON.stringify(report))

interface RuntimeStatus {
  class?: string
  provider?: { kind?: string }
  owner?: { pid?: number }
  componentDetail?: Record<string, { state?: string; pid?: number }>
}

function runtimePids(status: RuntimeStatus): number[] {
  const pids = [
    status.owner?.pid,
    status.componentDetail?.alice?.pid,
    status.componentDetail?.uta?.pid,
    status.componentDetail?.connector?.pid,
  ]
  if (pids.some((pid) => !Number.isInteger(pid) || (pid ?? 0) <= 0)) {
    throw new Error(`Runtime status omitted a component PID: ${JSON.stringify(status)}`)
  }
  return pids as number[]
}

async function waitForRuntimeStatus(
  env: Record<string, string>,
  accept: (status: RuntimeStatus) => boolean,
  timeoutMs = 30_000,
): Promise<RuntimeStatus> {
  const deadline = Date.now() + timeoutMs
  let last = ''
  while (Date.now() < deadline) {
    const probe = Bun.spawnSync([
      executablePath,
      'status',
      '--home', smokeHome,
      '--wait', '1',
      '--json',
    ], {
      cwd: outputRoot,
      env,
      stdout: 'pipe',
      stderr: 'pipe',
    })
    last = probe.stdout.toString() || probe.stderr.toString()
    if (probe.exitCode === 0) {
      const envelope = JSON.parse(last) as { result?: { status?: RuntimeStatus } }
      const status = envelope.result?.status
      if (status && accept(status)) return status
    }
    await Bun.sleep(100)
  }
  throw new Error(`Timed out waiting for Runtime status: ${last}`)
}

function runProbe(args: string[], env: Record<string, string>): { stdout: string } {
  const probe = Bun.spawnSync([executablePath, ...args], {
    cwd: outputRoot,
    env,
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const stdout = probe.stdout.toString()
  if (probe.exitCode !== 0) {
    throw new Error(`${basename(executablePath)} ${args.join(' ')} failed: ${probe.stderr.toString() || stdout}`)
  }
  return { stdout }
}

async function waitForHttp(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs
  let lastError: unknown = null
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url)
      if (response.ok) return
      lastError = new Error(`${url} returned ${response.status}`)
    } catch (error) {
      lastError = error
    }
    await Bun.sleep(100)
  }
  throw new Error(`Timed out waiting for ${url}: ${String(lastError)}`)
}

function minimalSmokeEnvironment(options: {
  home: string
  executable: string
  webPort: number
  mcpPort: number
  utaPort: number
  connectorPort: number
}): Record<string, string> {
  return {
    HOME: options.home,
    PATH: '',
    TMPDIR: process.env['TMPDIR'] ?? '/tmp',
    OPENALICE_HOME: options.home,
    OPENALICE_APP_HOME: repositoryRoot,
    OPENALICE_RUNTIME_PROVIDER: 'bun',
    OPENALICE_RUNTIME_EXECUTABLE: options.executable,
    OPENALICE_RUNTIME_CONTENT_IDENTITY: 'bun-feasibility',
    OPENALICE_TRADING_MODE: 'pro',
    OPENALICE_BIND_HOST: '127.0.0.1',
    OPENALICE_WEB_PORT: String(options.webPort),
    OPENALICE_MCP_PORT: String(options.mcpPort),
    OPENALICE_UTA_PORT: String(options.utaPort),
    OPENALICE_CONNECTOR_PORT: String(options.connectorPort),
    ELECTRON_RUN_AS_NODE: '1',
    ...(process.env['SystemRoot'] ? { SystemRoot: process.env['SystemRoot'] } : {}),
  }
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
    if (!address || typeof address === 'string') throw new Error('failed to allocate smoke port')
    ports.push(address.port)
    await new Promise<void>((resolveClose, reject) => {
      server.close((error) => error ? reject(error) : resolveClose())
    })
  }
  return ports
}
