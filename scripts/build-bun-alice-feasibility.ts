import { createServer } from 'node:net'
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { INTERNAL_BOOTSTRAP_ROLE } from '../src/workspaces/bootstrap-runtime.js'

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
const ptySmokeName = process.platform === 'win32' ? 'pty-smoke.exe' : 'pty-smoke'
const ptySmokePath = join(outputRoot, ptySmokeName)
const smokeHome = join(outputRoot, 'smoke-home')
const bootstrapWorkspace = join(outputRoot, 'bootstrap-workspace')

await rm(outputRoot, { recursive: true, force: true })
await mkdir(outputRoot, { recursive: true })
process.chdir(outputRoot)

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

const bootstrapProbe = Bun.spawn([
  executablePath,
  INTERNAL_BOOTSTRAP_ROLE,
  join(repositoryRoot, 'src/workspaces/templates/chat/bootstrap.mjs'),
  'bun-feasibility',
  bootstrapWorkspace,
], {
  cwd: outputRoot,
  env: {
    HOME: smokeHome,
    PATH: '',
    TMPDIR: process.env['TMPDIR'] ?? '/tmp',
    ELECTRON_RUN_AS_NODE: '1',
    AQ_TEMPLATE_ROOT: join(repositoryRoot, 'src/workspaces/templates/chat'),
    ...(process.env['LOCAL_GIT_DIRECTORY']
      ? { LOCAL_GIT_DIRECTORY: process.env['LOCAL_GIT_DIRECTORY'] }
      : {}),
    ...(process.env['GIT_EXEC_PATH']
      ? { GIT_EXEC_PATH: process.env['GIT_EXEC_PATH'] }
      : {}),
    ...(process.env['SystemRoot'] ? { SystemRoot: process.env['SystemRoot'] } : {}),
  },
  stdout: 'pipe',
  stderr: 'pipe',
})
const [bootstrapExitCode, bootstrapStdout, bootstrapStderr] = await Promise.all([
  bootstrapProbe.exited,
  new Response(bootstrapProbe.stdout).text(),
  new Response(bootstrapProbe.stderr).text(),
])
if (bootstrapExitCode !== 0) {
  throw new Error(
    `compiled Bun workspace bootstrap exited with ${bootstrapExitCode}: ${bootstrapStderr || bootstrapStdout}`,
  )
}
const [bootstrapHead, bootstrapReadme] = await Promise.all([
  readFile(join(bootstrapWorkspace, '.git/HEAD'), 'utf8'),
  readFile(join(bootstrapWorkspace, 'README.md'), 'utf8'),
])
if (!bootstrapHead.startsWith('ref: refs/heads/') || bootstrapReadme.trim().length === 0) {
  throw new Error('compiled Bun workspace bootstrap did not materialize the Chat template')
}

const ptyBuild = await Bun.build({
  entrypoints: [join(repositoryRoot, 'scripts/bun-native-pty-smoke.ts')],
  compile: {
    outfile: ptySmokePath,
    autoloadBunfig: false,
    autoloadDotenv: false,
  },
  minify: true,
})
if (!ptyBuild.success) {
  for (const log of ptyBuild.logs) console.error(log)
  throw new Error('Bun PTY feasibility build failed')
}

const ptyProbe = Bun.spawn([ptySmokePath], {
  cwd: outputRoot,
  env: {
    HOME: smokeHome,
    PATH: '',
    TMPDIR: process.env['TMPDIR'] ?? '/tmp',
    ...(process.env['SystemRoot'] ? { SystemRoot: process.env['SystemRoot'] } : {}),
  },
  stdout: 'pipe',
  stderr: 'pipe',
})
const [ptyExitCode, ptyStdout, ptyStderr] = await Promise.all([
  ptyProbe.exited,
  new Response(ptyProbe.stdout).text(),
  new Response(ptyProbe.stderr).text(),
])
if (ptyExitCode !== 0) {
  throw new Error(`compiled Bun PTY smoke exited with ${ptyExitCode}: ${ptyStderr || ptyStdout}`)
}
const ptyReport = JSON.parse(ptyStdout.trim()) as {
  status: string
  backend: string
  supportsFlowControl: boolean
  pids: number[]
  flowControl?: {
    pid: number
    bytesBeforePause: number
    bytesWhilePaused: number
    bytesAfterResume: number
    gracefulKillWhilePaused: boolean
  }
}
if (
  ptyReport.status !== 'pass'
  || ptyReport.backend !== 'bun-native'
  || !ptyReport.supportsFlowControl
  || !ptyReport.flowControl
  || ptyReport.flowControl.bytesWhilePaused !== ptyReport.flowControl.bytesBeforePause
  || ptyReport.flowControl.bytesAfterResume <= ptyReport.flowControl.bytesWhilePaused
  || !ptyReport.flowControl.gracefulKillWhilePaused
) {
  throw new Error(`compiled Bun PTY smoke returned an invalid report: ${ptyStdout}`)
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
  pty: ptyReport,
  workspaceBootstrap: {
    status: 'pass',
    template: 'chat',
    nodeOrBunOnPath: false,
  },
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
