import { createHash } from 'node:crypto'
import {
  chmod,
  cp,
  lstat,
  mkdir,
  readFile,
  readdir,
  readlink,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { INTERNAL_BOOTSTRAP_ROLE } from '../src/workspaces/bootstrap-runtime.js'
import { bunReleaseContentIdentity } from './bun-release-content-identity.mjs'

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url))
const pinnedBunVersion = (await readFile(join(repositoryRoot, '.bun-version'), 'utf8')).trim()
if (Bun.version !== pinnedBunVersion) {
  throw new Error(`Bun ${pinnedBunVersion} is required, but ${Bun.version} is running`)
}
if (!['darwin', 'linux'].includes(process.platform)) {
  throw new Error(`Bun CLI releases are currently supported on macOS and Linux, not ${process.platform}`)
}

const product = JSON.parse(await readFile(join(repositoryRoot, 'package.json'), 'utf8')) as {
  version?: unknown
}
if (typeof product.version !== 'string' || product.version.length === 0) {
  throw new Error('package.json must contain a version')
}

const outputRoot = resolve(
  process.env['OPENALICE_BUN_OUTPUT_DIR']
    ?? join(repositoryRoot, 'dist/bun-release'),
)
const platformName = process.platform === 'darwin' ? 'darwin' : 'linux'
const releaseName = `openalice-cli-${product.version}-${platformName}-${process.arch}`
const releaseRoot = join(outputRoot, releaseName)
const executablePath = join(releaseRoot, 'bin', 'openalice')
const resourceRoot = join(releaseRoot, 'share', 'openalice')
const gitRoot = join(resourceRoot, 'runtime', 'git')
const archivePath = join(outputRoot, `${releaseName}.tar.gz`)
const smokeHome = join(outputRoot, 'smoke-home')
const releaseStartedAt = performance.now()

await rm(releaseRoot, { recursive: true, force: true })
await rm(smokeHome, { recursive: true, force: true })
await rm(archivePath, { force: true })
await mkdir(dirname(executablePath), { recursive: true })
await mkdir(resourceRoot, { recursive: true })

for (const required of [
  'ui/dist/index.html',
  'src/workspaces/templates/chat/bootstrap.mjs',
  'src/workspaces/cli/bin/pi-session-provider.ts',
  'node_modules/dugite/git/bin/git',
]) {
  await stat(join(repositoryRoot, required)).catch(() => {
    throw new Error(`required Bun release input is missing: ${required}`)
  })
}

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
  throw new Error('Bun CLI release build failed')
}
const buildDurationMs = Math.round(performance.now() - buildStartedAt)

await Promise.all([
  copyTree('ui/dist'),
  copyTree('default'),
  copyTree('src/workspaces/templates'),
  cp(join(repositoryRoot, 'package.json'), join(resourceRoot, 'package.json')),
  cp(join(repositoryRoot, 'LICENSE'), join(releaseRoot, 'LICENSE')),
  cp(join(repositoryRoot, 'THIRD_PARTY_NOTICES.md'), join(releaseRoot, 'THIRD_PARTY_NOTICES.md')),
])
await mkdir(join(releaseRoot, 'licenses'), { recursive: true })
await cp(join(repositoryRoot, 'node_modules/dugite/LICENSE'), join(releaseRoot, 'licenses/dugite-LICENSE'))
await materializeWorkspaceCli()
const gitReport = await buildPortableGit(
  join(repositoryRoot, 'node_modules/dugite/git'),
  gitRoot,
)

const files = await releaseFiles(releaseRoot, new Set(['release.json']))
const unsignedReleaseMetadata = {
  schemaVersion: 1,
  product: 'OpenAlice CLI',
  version: product.version,
  platform: platformName,
  arch: process.arch,
  bunVersion: Bun.version,
  executable: 'bin/openalice',
  resourceRoot: 'share/openalice',
  git: {
    root: 'share/openalice/runtime/git',
    source: 'dugite',
    sourceVersion: JSON.parse(
      await readFile(join(repositoryRoot, 'node_modules/dugite/package.json'), 'utf8'),
    ).version,
    ...gitReport,
  },
  files,
}
const contentIdentity = bunReleaseContentIdentity(unsignedReleaseMetadata)
const releaseMetadata = {
  ...unsignedReleaseMetadata,
  contentIdentity,
}
const releaseMetadataPath = join(releaseRoot, 'release.json')
await writeFile(releaseMetadataPath, `${JSON.stringify(releaseMetadata, null, 2)}\n`)
const releaseMetadataHash = await sha256File(releaseMetadataPath)
const assemblyDurationMs = Math.round(performance.now() - releaseStartedAt)

const smokeStartedAt = performance.now()
const smoke = await smokeRelease({
  executablePath,
  resourceRoot,
  gitRoot,
  smokeHome,
  contentIdentity,
})
const smokeDurationMs = Math.round(performance.now() - smokeStartedAt)
const filesAfterSmoke = await releaseFiles(releaseRoot, new Set(['release.json']))
const beforeByPath = new Map(files.map((entry) => [entry.path, JSON.stringify(entry)]))
const afterByPath = new Map(filesAfterSmoke.map((entry) => [entry.path, JSON.stringify(entry)]))
const mutatedReleasePaths = [...new Set([...beforeByPath.keys(), ...afterByPath.keys()])]
  .filter((path) => beforeByPath.get(path) !== afterByPath.get(path))
  .sort()
if (await sha256File(releaseMetadataPath) !== releaseMetadataHash) {
  mutatedReleasePaths.push('release.json')
}
if (mutatedReleasePaths.length > 0) {
  throw new Error(
    `Bun release smoke mutated the immutable release tree: ${mutatedReleasePaths.join(', ')}`,
  )
}

const archiveStartedAt = performance.now()
const archive = Bun.spawnSync([
  'tar', '-czf', archivePath, '-C', outputRoot, releaseName,
], {
  cwd: outputRoot,
  stdout: 'pipe',
  stderr: 'pipe',
})
if (archive.exitCode !== 0) {
  throw new Error(`release archive failed: ${archive.stderr.toString()}`)
}
const archiveHash = await sha256File(archivePath)
await writeFile(`${archivePath}.sha256`, `${archiveHash}  ${basename(archivePath)}\n`)
const archiveDurationMs = Math.round(performance.now() - archiveStartedAt)

const report = {
  schemaVersion: 1,
  status: 'pass',
  version: product.version,
  bunVersion: Bun.version,
  platform: platformName,
  arch: process.arch,
  contentIdentity,
  buildDurationMs,
  artifactBuildDurationMs: assemblyDurationMs + archiveDurationMs,
  assemblyDurationMs,
  archiveDurationMs,
  smokeDurationMs,
  totalDurationMs: Math.round(performance.now() - releaseStartedAt),
  executableBytes: (await stat(executablePath)).size,
  releaseBytes: await directoryBytes(releaseRoot),
  archiveBytes: (await stat(archivePath)).size,
  archiveSha256: archiveHash,
  git: gitReport,
  smoke,
}
await writeFile(join(outputRoot, 'report.json'), `${JSON.stringify(report, null, 2)}\n`)
console.log(`Bun CLI release passed: ${archivePath}`)
console.log(JSON.stringify(report))

async function copyTree(relativePath: string): Promise<void> {
  await cp(
    join(repositoryRoot, relativePath),
    join(resourceRoot, relativePath),
    { recursive: true },
  )
}

async function materializeWorkspaceCli(): Promise<void> {
  const destination = join(resourceRoot, 'src/workspaces/cli/bin')
  await mkdir(destination, { recursive: true })
  await cp(
    join(repositoryRoot, 'src/workspaces/cli/bin/pi-session-provider.ts'),
    join(destination, 'pi-session-provider.ts'),
  )
  for (const binary of ['alice', 'alice-workspace', 'alice-uta', 'traderhub']) {
    const launcher = `#!/bin/sh
set -eu
: "\${OPENALICE_RUNTIME_EXECUTABLE:?OpenAlice Runtime executable is not configured}"
exec "$OPENALICE_RUNTIME_EXECUTABLE" --workspace-cli ${binary} "$@"
`
    const path = join(destination, binary)
    await writeFile(path, launcher, { mode: 0o755 })
    await chmod(path, 0o755)
  }
}

async function buildPortableGit(source: string, destination: string): Promise<{
  version: string
  files: number
  symlinks: number
  bytes: number
}> {
  await mkdir(join(destination, 'bin'), { recursive: true })
  await mkdir(join(destination, 'libexec/git-core'), { recursive: true })
  await cp(join(source, 'bin/git'), join(destination, 'bin/git'))
  await cp(join(source, 'etc'), join(destination, 'etc'), { recursive: true })
  await cp(join(source, 'share/git-core'), join(destination, 'share/git-core'), { recursive: true })
  if (await exists(join(source, 'ssl'))) {
    await cp(join(source, 'ssl'), join(destination, 'ssl'), { recursive: true })
  }

  const sourceCore = join(source, 'libexec/git-core')
  const destinationCore = join(destination, 'libexec/git-core')
  const canonicalByHash = new Map<string, string>()
  canonicalByHash.set(await sha256File(join(destination, 'bin/git')), join(destination, 'bin/git'))
  await symlink(join('..', '..', 'bin', 'git'), join(destinationCore, 'git'))
  let symlinks = 1
  for (const entry of await readdir(sourceCore, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (entry.name === 'mergetools') {
        await cp(join(sourceCore, entry.name), join(destinationCore, entry.name), { recursive: true })
      }
      continue
    }
    if (!entry.name.startsWith('git-')) continue
    if (entry.name === 'git-lfs' || entry.name.startsWith('git-credential-manager')) continue
    const sourceFile = join(sourceCore, entry.name)
    const destinationFile = join(destinationCore, entry.name)
    if (entry.isSymbolicLink()) {
      const target = await readlink(sourceFile)
      const resolvedTarget = resolve(sourceCore, target)
      if (resolvedTarget !== sourceCore && !resolvedTarget.startsWith(`${sourceCore}/`)) {
        throw new Error(`release-owned Git contains an escaping symlink: ${entry.name} -> ${target}`)
      }
      await symlink(target, destinationFile)
      symlinks += 1
      continue
    }
    if (!entry.isFile()) continue
    const hash = await sha256File(sourceFile)
    const canonical = canonicalByHash.get(hash)
    if (canonical) {
      await symlink(relative(dirname(destinationFile), canonical), destinationFile)
      symlinks += 1
    } else {
      await cp(sourceFile, destinationFile)
      canonicalByHash.set(hash, destinationFile)
    }
  }
  // Git's local and SSH transports ask a shell to resolve these server-side
  // programs by name. GIT_EXEC_PATH covers Git's own subcommand dispatch but
  // does not replace the conventional bin entries on Linux.
  for (const program of ['git-upload-pack', 'git-receive-pack', 'git-shell']) {
    await symlink(join('..', 'libexec', 'git-core', program), join(destination, 'bin', program))
    symlinks += 1
  }
  const entries = await releaseFiles(destination)
  const bytes = await directoryBytes(destination)
  if (bytes > 80 * 1024 * 1024) {
    throw new Error(`release-owned Git is unexpectedly large: ${bytes} bytes`)
  }
  const version = Bun.spawnSync([join(destination, 'bin/git'), '--version'], {
    env: {
      PATH: join(destination, 'bin'),
      GIT_EXEC_PATH: join(destination, 'libexec/git-core'),
    },
    stdout: 'pipe',
    stderr: 'pipe',
  })
  if (version.exitCode !== 0) throw new Error(`release-owned Git failed: ${version.stderr.toString()}`)
  return {
    version: version.stdout.toString().trim(),
    files: entries.filter((entry) => entry.type === 'file').length,
    symlinks,
    bytes,
  }
}

async function smokeRelease(options: {
  executablePath: string
  resourceRoot: string
  gitRoot: string
  smokeHome: string
  contentIdentity: string
}): Promise<Record<string, unknown>> {
  await mkdir(options.smokeHome, { recursive: true })
  const gitEnv = {
    HOME: options.smokeHome,
    PATH: join(options.gitRoot, 'bin'),
    LOCAL_GIT_DIRECTORY: options.gitRoot,
    GIT_EXEC_PATH: join(options.gitRoot, 'libexec/git-core'),
    GIT_TEMPLATE_DIR: join(options.gitRoot, 'share/git-core/templates'),
    GIT_CONFIG_SYSTEM: join(options.gitRoot, 'etc/gitconfig'),
    TMPDIR: process.env['TMPDIR'] ?? '/tmp',
  }
  const git = join(options.gitRoot, 'bin/git')
  const sourceRepository = join(options.smokeHome, 'git-source')
  const clonedRepository = join(options.smokeHome, 'git-clone')
  run([git, 'init', sourceRepository], gitEnv)
  run([git, '-C', sourceRepository, 'config', 'user.email', 'smoke@openalice.local'], gitEnv)
  run([git, '-C', sourceRepository, 'config', 'user.name', 'OpenAlice Smoke'], gitEnv)
  await writeFile(join(sourceRepository, 'README.md'), 'release-owned git\n')
  run([git, '-C', sourceRepository, 'add', 'README.md'], gitEnv)
  run([git, '-C', sourceRepository, 'commit', '-m', 'initial'], gitEnv)
  const sourceCommit = run([git, '-C', sourceRepository, 'rev-parse', 'HEAD'], gitEnv).trim()
  run([git, 'clone', sourceRepository, clonedRepository], gitEnv)
  if ((await readFile(join(clonedRepository, 'README.md'), 'utf8')).trim() !== 'release-owned git') {
    throw new Error('release-owned Git clone did not preserve repository content')
  }
  if (process.env['OPENALICE_BUN_NETWORK_GIT'] === '1') {
    run([git, 'ls-remote', 'https://github.com/git/git.git', 'HEAD'], gitEnv)
  }

  const templateRoot = join(options.resourceRoot, 'src/workspaces/templates')
  await Promise.all([
    stat(join(options.resourceRoot, 'default/skills')),
    stat(join(options.resourceRoot, 'src/workspaces/cli/bin/pi-session-provider.ts')),
  ])
  for (const template of ['chat', 'auto-quant-v2', 'auto-prediction']) {
    const workspace = join(options.smokeHome, `workspace-${template}`)
    run([
      options.executablePath,
      INTERNAL_BOOTSTRAP_ROLE,
      join(templateRoot, template, 'bootstrap.mjs'),
      `bun-release-${template}`,
      workspace,
    ], {
      ...gitEnv,
      AQ_TEMPLATE_ROOT: join(templateRoot, template),
      OPENALICE_APP_HOME: options.resourceRoot,
      OPENALICE_TEMPLATE_SOURCE_REPOSITORY: sourceRepository,
      OPENALICE_TEMPLATE_SOURCE_VERSION: 'HEAD',
      OPENALICE_TEMPLATE_SOURCE_COMMIT: sourceCommit,
      ...(template === 'auto-quant-v2' ? { AQ_TEMPLATE_DIR: sourceRepository } : {}),
      ...(template === 'auto-prediction' ? { AUTO_PREDICTION_TEMPLATE_DIR: sourceRepository } : {}),
    })
    if (!(await readFile(join(workspace, '.git/HEAD'), 'utf8')).startsWith('ref: refs/heads/')) {
      throw new Error(`${template} bootstrap did not create a Git repository`)
    }
  }

  const helperServer = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch(request) {
      const url = new URL(request.url)
      if (url.pathname === '/cli/ws-release/workspace/manifest') {
        return Response.json({
          groups: { issue: { list: { tool: 'workspace_issue_list', schema: { type: 'object', properties: {} } } } },
          groupDescriptions: { issue: 'Issue coordination' },
        })
      }
      if (url.pathname === '/cli/ws-release/workspace/invoke' && request.method === 'POST') {
        return Response.json({ content: [{ type: 'text', text: 'BUN_WORKSPACE_CLI_OK' }] })
      }
      return Response.json({ error: 'not found' }, { status: 404 })
    },
  })
  try {
    const helper = await runAsync([
      join(options.resourceRoot, 'src/workspaces/cli/bin/alice-workspace'),
    ], {
      ...gitEnv,
      OPENALICE_RUNTIME_EXECUTABLE: options.executablePath,
      OPENALICE_TOOL_URL: `http://127.0.0.1:${helperServer.port}/cli`,
      AQ_WS_ID: 'ws-release',
    })
    if (!helper.includes('issue')) throw new Error('Bun Workspace CLI did not render its real manifest')
    const invocation = await runAsync([
      join(options.resourceRoot, 'src/workspaces/cli/bin/alice-workspace'),
      'issue', 'list',
    ], {
      ...gitEnv,
      OPENALICE_RUNTIME_EXECUTABLE: options.executablePath,
      OPENALICE_TOOL_URL: `http://127.0.0.1:${helperServer.port}/cli`,
      AQ_WS_ID: 'ws-release',
    })
    if (invocation.trim() !== 'BUN_WORKSPACE_CLI_OK') {
      throw new Error(`Bun Workspace CLI invocation returned unexpected output: ${invocation}`)
    }
  } finally {
    helperServer.stop(true)
  }

  const [webPort, mcpPort, utaPort, connectorPort] = await allocatePorts(4)
  const runtimeHome = join(options.smokeHome, 'runtime-home')
  const userHome = join(options.smokeHome, 'user-home')
  const externalAgentRoot = join(options.smokeHome, 'external-agent')
  const externalAgentBin = join(externalAgentRoot, 'bin')
  const nativePiRoot = join(externalAgentRoot, 'native-pi-state')
  const externalOpenCode = join(externalAgentBin, 'opencode')
  const openReceipt = join(options.smokeHome, 'browser-open.txt')
  const opener = join(externalAgentBin, process.platform === 'darwin' ? 'open' : 'xdg-open')
  const stty = await exists('/bin/stty') ? '/bin/stty' : '/usr/bin/stty'
  const nativeOpenCodeTuiConfig = '{"theme":"system"}\n'
  await Promise.all([
    mkdir(externalAgentBin, { recursive: true }),
    mkdir(join(userHome, '.config', 'opencode'), { recursive: true }),
  ])
  await writeFile(join(userHome, '.config', 'opencode', 'tui.json'), nativeOpenCodeTuiConfig)
  await writeFile(externalOpenCode, `#!/bin/sh
if [ "${'$'}{1-}" = "session" ] && [ "${'$'}{2-}" = "list" ]; then
  printf '[]\\n'
  exit 0
fi
printf 'OPENALICE_EXTERNAL_OPENCODE_OK\\n'
printf 'CWD=%s\\n' "${'$'}PWD"
printf 'MANAGED_PI_PATH=%s\\n' "${'$'}{OPENALICE_MANAGED_PI_PATH-unset}"
printf 'MANAGED_PI_NODE_PATH=%s\\n' "${'$'}{OPENALICE_MANAGED_PI_NODE_PATH-unset}"
printf 'PI_CODING_AGENT_DIR=%s\\n' "${'$'}{PI_CODING_AGENT_DIR-unset}"
printf 'PI_CODING_AGENT_SESSION_DIR=%s\\n' "${'$'}{PI_CODING_AGENT_SESSION_DIR-unset}"
printf 'PID=%s\\n' "${'$'}${'$'}"
while IFS= read -r line; do
  printf 'INPUT=%s SIZE=%s\\n' "${'$'}line" "${'$'}(${stty} size)"
done
`)
  await writeFile(opener, `#!/bin/sh
printf '%s\\n' "${'$'}1" > "${'$'}OPENALICE_SMOKE_OPEN_RECEIPT"
`)
  await Promise.all([chmod(externalOpenCode, 0o755), chmod(opener, 0o755)])
  const runtimeEnv = {
    HOME: userHome,
    PATH: externalAgentBin,
    TMPDIR: process.env['TMPDIR'] ?? '/tmp',
    OPENALICE_HOME: runtimeHome,
    OPENALICE_TRADING_MODE: 'lite',
    OPENALICE_DISABLE_AUTH: '1',
    OPENALICE_BIND_HOST: '127.0.0.1',
    OPENALICE_WEB_PORT: String(webPort),
    OPENALICE_MCP_PORT: String(mcpPort),
    OPENALICE_UTA_PORT: String(utaPort),
    OPENALICE_CONNECTOR_PORT: String(connectorPort),
    OPENALICE_SMOKE_OPEN_RECEIPT: openReceipt,
    OPENALICE_MANAGED_PI_PATH: '/stale/desktop/pi/cli.js',
    OPENALICE_MANAGED_PI_NODE_PATH: '/stale/desktop/node',
    PI_CODING_AGENT_DIR: nativePiRoot,
    PI_CODING_AGENT_SESSION_DIR: join(nativePiRoot, 'sessions'),
    OPENALICE_TEMPLATE_SOURCE_REPOSITORY: sourceRepository,
    OPENALICE_TEMPLATE_SOURCE_VERSION: 'HEAD',
    OPENALICE_TEMPLATE_SOURCE_COMMIT: sourceCommit,
  }
  const runtimeStartedAt = performance.now()
  const runtime = Bun.spawn([
    options.executablePath,
    'run',
    '--home', runtimeHome,
    '--port', String(webPort),
    '--wait', '90',
    '--no-update-check',
  ], {
    cwd: options.smokeHome,
    env: runtimeEnv,
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const stdoutPromise = new Response(runtime.stdout).text()
  const stderrPromise = new Response(runtime.stderr).text()
  let runtimeError: unknown = null
  let realOpenCodeReport: { path: string; version: string; ptyBytes: number } | null = null
  let browserOpenUrl: string | null = null
  let agentPtyReport: {
    sessions: number
    distinctPids: boolean
    resize: boolean
    input: boolean
    stopIsolation: boolean
  } | null = null
  let coldStartReadyMs = 0
  let idleMemoryBytes: {
    sampleCount: number
    sampleIntervalMs: number
    guardian: number
    alice: number
    total: number
  } | null = null
  try {
    const root = await waitForHttp(`http://127.0.0.1:${webPort}/`, 90_000)
    if (!root.includes('<div id="root">')) throw new Error('installed release did not serve the real Web UI')
    const status = await waitForReleaseRuntimeStatus(
      options.executablePath,
      runtimeHome,
      runtimeEnv,
    )
    if (
      status.result?.status?.class !== 'running'
      || status.result.status.componentDetail?.alice?.state !== 'ready'
      || status.result.status.provider?.kind !== 'bun'
      || status.result.status.provider.contentIdentity !== options.contentIdentity
    ) {
      throw new Error(`installed release status lost Bun provenance: ${JSON.stringify(status)}`)
    }
    coldStartReadyMs = Math.round(performance.now() - runtimeStartedAt)
    const guardianPid = status.result.status.owner?.pid
    const alicePid = status.result.status.componentDetail?.alice?.pid
    if (!guardianPid || !alicePid || guardianPid === alicePid) {
      throw new Error(`installed release status omitted distinct Guardian/Alice PIDs: ${JSON.stringify(status)}`)
    }
    await Bun.sleep(1_000)
    const guardian = await medianResidentSetBytes(guardianPid)
    const alice = await medianResidentSetBytes(alicePid)
    idleMemoryBytes = {
      sampleCount: 3,
      sampleIntervalMs: 500,
      guardian,
      alice,
      total: guardian + alice,
    }
    const baseUrl = `http://127.0.0.1:${webPort}`
    const openOutput = run([
      options.executablePath,
      'open', '--home', runtimeHome, '--wait', '3',
    ], runtimeEnv)
    browserOpenUrl = (await waitForFileText(openReceipt, 5_000)).trim()
    if (browserOpenUrl !== baseUrl || !openOutput.includes(`Opened OpenAlice Web UI: ${baseUrl}`)) {
      throw new Error(`compiled CLI did not open its verified Web endpoint: ${openOutput} / ${browserOpenUrl}`)
    }
    const inventory = await fetchJson(`${baseUrl}/api/workspaces/agents`) as {
      agents?: Array<{ id?: string; installed?: boolean }>
    }
    if (!inventory.agents?.some((agent) => agent.id === 'opencode' && agent.installed === true)) {
      throw new Error(`installed release did not discover the external OpenCode executable: ${JSON.stringify(inventory)}`)
    }
    const created = await fetchJson(`${baseUrl}/api/workspaces`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tag: 'bun-external-opencode', template: 'chat' }),
    }, 201) as { workspace?: { id?: string; dir?: string } }
    const workspaceId = created.workspace?.id
    const workspaceDir = created.workspace?.dir
    if (!workspaceId || !workspaceDir) {
      throw new Error(`installed release Workspace response was incomplete: ${JSON.stringify(created)}`)
    }
    const spawnExternalAgent = () => fetchJson(`${baseUrl}/api/workspaces/${workspaceId}/sessions/spawn`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ agent: 'opencode' }),
    }, 201) as Promise<{ sessionId?: string; pid?: number }>
    const spawned = await spawnExternalAgent()
    const spawnedTwo = await spawnExternalAgent()
    if (
      !spawned.sessionId || !spawned.pid
      || !spawnedTwo.sessionId || !spawnedTwo.pid
      || spawned.sessionId === spawnedTwo.sessionId
      || spawned.pid === spawnedTwo.pid
    ) {
      throw new Error(`installed release did not create two independent Agent PTYs: ${JSON.stringify([spawned, spawnedTwo])}`)
    }
    const marker = 'OPENALICE_EXTERNAL_OPENCODE_OK'
    const [terminal, terminalTwo] = await Promise.all([
      readPtyUntil(baseUrl, spawned.sessionId, {
        client: 'bun-release-external-agent-smoke-one',
        description: 'first Agent input after resize',
        timeoutMs: 30_000,
        onOpen: (socket) => {
          socket.send(JSON.stringify({ type: 'resize', cols: 91, rows: 31 }))
          socket.send(new TextEncoder().encode('alpha\n'))
        },
        complete: (output) => output.includes(marker) && output.includes('INPUT=alpha SIZE=31 91'),
      }),
      readPtyUntil(baseUrl, spawnedTwo.sessionId, {
        client: 'bun-release-external-agent-smoke-two',
        description: 'second Agent input after resize',
        timeoutMs: 30_000,
        onOpen: (socket) => {
          socket.send(JSON.stringify({ type: 'resize', cols: 103, rows: 37 }))
          socket.send(new TextEncoder().encode('beta\n'))
        },
        complete: (output) => output.includes(marker) && output.includes('INPUT=beta SIZE=37 103'),
      }),
    ])
    for (const expected of [
      `CWD=${workspaceDir}`,
      'MANAGED_PI_PATH=unset',
      'MANAGED_PI_NODE_PATH=unset',
      `PI_CODING_AGENT_DIR=${nativePiRoot}`,
      `PI_CODING_AGENT_SESSION_DIR=${join(nativePiRoot, 'sessions')}`,
    ]) {
      if (!terminal.includes(expected)) {
        throw new Error(`external OpenCode process did not preserve the CLI ownership boundary (${expected}):\n${terminal}`)
      }
    }
    if (terminal.includes('INPUT=beta') || terminalTwo.includes('INPUT=alpha')) {
      throw new Error('independent Agent PTYs received each other\'s input')
    }
    await fetchJson(`${baseUrl}/api/workspaces/${workspaceId}/sessions/${spawned.sessionId}`, {
      method: 'DELETE',
    })
    const survivingTerminal = await readPtyUntil(baseUrl, spawnedTwo.sessionId, {
      client: 'bun-release-external-agent-smoke-survivor',
      description: 'surviving Agent input after peer stop',
      timeoutMs: 30_000,
      onOpen: (socket) => socket.send(new TextEncoder().encode('still-alive\n')),
      complete: (output) => output.includes('INPUT=still-alive'),
    })
    agentPtyReport = {
      sessions: 2,
      distinctPids: true,
      resize: true,
      input: true,
      stopIsolation: survivingTerminal.includes('INPUT=still-alive'),
    }
    const realOpenCodePath = process.env['OPENALICE_BUN_REAL_OPENCODE_PATH']?.trim()
    if (realOpenCodePath) {
      const realVersion = run([realOpenCodePath, '--version'], {
        HOME: userHome,
        PATH: dirname(realOpenCodePath),
        OPENCODE_DISABLE_MODELS_FETCH: '1',
        OPENCODE_DISABLE_AUTOUPDATE: '1',
        OPENCODE_DISABLE_LSP_DOWNLOAD: '1',
      }).trim()
      await rm(externalOpenCode)
      await symlink(realOpenCodePath, externalOpenCode)
      const realCreated = await fetchJson(`${baseUrl}/api/workspaces`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tag: 'bun-real-opencode', template: 'chat' }),
      }, 201) as { workspace?: { id?: string } }
      const realWorkspaceId = realCreated.workspace?.id
      if (!realWorkspaceId) {
        throw new Error(`installed release real OpenCode Workspace response was incomplete: ${JSON.stringify(realCreated)}`)
      }
      const realSpawned = await fetchJson(`${baseUrl}/api/workspaces/${realWorkspaceId}/sessions/spawn`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ agent: 'opencode' }),
      }, 201) as { sessionId?: string }
      if (!realSpawned.sessionId) {
        throw new Error(`installed release real OpenCode spawn omitted sessionId: ${JSON.stringify(realSpawned)}`)
      }
      const realTerminal = await readPtyUntil(baseUrl, realSpawned.sessionId, {
        client: 'bun-release-real-agent-smoke',
        description: '64 bytes of TUI output',
        timeoutMs: 30_000,
        complete: (output) => Buffer.byteLength(output) >= 64,
      })
      const retainedConfig = await readFile(join(userHome, '.config', 'opencode', 'tui.json'), 'utf8')
      if (retainedConfig !== nativeOpenCodeTuiConfig) {
        throw new Error('real external OpenCode launch changed the user-owned native TUI config')
      }
      realOpenCodeReport = {
        path: realOpenCodePath,
        version: realVersion,
        ptyBytes: Buffer.byteLength(realTerminal),
      }
    }
    // Let the foreground presenter observe the same ready status before the
    // smoke sends its ownership signal; otherwise the signal guard correctly
    // classifies this as an interrupted startup even though Alice is serving.
    await Bun.sleep(500)
  } catch (error) {
    runtimeError = error
  } finally {
    runtime.kill('SIGTERM')
  }
  const exitCode = await runtime.exited
  const stdout = await stdoutPromise
  const stderr = await stderrPromise
  if (runtimeError || exitCode !== 0) {
    throw new Error(`installed release Runtime failed: ${String(runtimeError)}\n${stdout}\n${stderr}`)
  }
  const workspaceSessionLog = await readFile(
    join(runtimeHome, 'logs', 'workspace-sessions.log'),
    'utf8',
  ).catch(() => '')
  if (!workspaceSessionLog.includes('"msg":"workspace.session_spawned"')) {
    throw new Error('installed release did not persist Workspace session logs under the selected Project Home')
  }
  return {
    nodeOrBunOnPath: false,
    gitInitCommitClone: true,
    networkGit: process.env['OPENALICE_BUN_NETWORK_GIT'] === '1',
    templates: ['chat', 'auto-quant-v2', 'auto-prediction'],
    workspaceCli: 'alice-workspace',
    workspaceCliInvoke: true,
    externalAgentRuntime: 'opencode',
    externalAgentRuntimeProcess: true,
    externalAgentRuntimeManagedPi: false,
    browserOpenUrl,
    agentPtys: agentPtyReport,
    workspaceSessionLog: 'logs/workspace-sessions.log',
    realExternalAgentRuntime: realOpenCodeReport,
    defaultResources: true,
    materializedPiAdapter: true,
    uiStatus: 200,
    contentIdentity: options.contentIdentity,
    coldStartReadyMs,
    idleMemoryBytes,
  }
}

async function medianResidentSetBytes(pid: number): Promise<number> {
  const samples: number[] = []
  for (let index = 0; index < 3; index += 1) {
    const probe = Bun.spawnSync(['/bin/ps', '-o', 'rss=', '-p', String(pid)], {
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const residentKiB = Number.parseInt(probe.stdout.toString().trim(), 10)
    if (probe.exitCode !== 0 || !Number.isFinite(residentKiB) || residentKiB <= 0) {
      throw new Error(`failed to measure resident memory for PID ${pid}: ${probe.stderr.toString()}`)
    }
    samples.push(residentKiB * 1024)
    if (index < 2) await Bun.sleep(500)
  }
  samples.sort((left, right) => left - right)
  return samples[1]
}

interface ReleaseRuntimeStatusEnvelope {
  result?: {
    status?: {
      class?: string
      provider?: { kind?: string; contentIdentity?: string }
      owner?: { pid?: number }
      componentDetail?: Record<string, { state?: string; pid?: number }>
    }
  }
}

async function waitForReleaseRuntimeStatus(
  executable: string,
  runtimeHome: string,
  env: Record<string, string>,
  timeoutMs = 15_000,
): Promise<ReleaseRuntimeStatusEnvelope> {
  const deadline = Date.now() + timeoutMs
  let last: ReleaseRuntimeStatusEnvelope | null = null
  while (Date.now() < deadline) {
    last = JSON.parse(run([
      executable,
      'status', '--home', runtimeHome, '--wait', '1', '--json',
    ], env)) as ReleaseRuntimeStatusEnvelope
    if (
      last.result?.status?.class === 'running'
      && last.result.status.componentDetail?.alice?.state === 'ready'
    ) {
      return last
    }
    await Bun.sleep(100)
  }
  throw new Error(`installed release did not become ready: ${JSON.stringify(last)}`)
}

async function fetchJson(
  url: string,
  init?: RequestInit,
  expectedStatus = 200,
): Promise<unknown> {
  const response = await fetch(url, init)
  const text = await response.text()
  if (response.status !== expectedStatus) {
    throw new Error(`${init?.method ?? 'GET'} ${url} returned ${response.status}: ${text}`)
  }
  try {
    return JSON.parse(text)
  } catch {
    throw new Error(`${init?.method ?? 'GET'} ${url} returned invalid JSON: ${text}`)
  }
}

function readPtyUntil(
  baseUrl: string,
  sessionId: string,
  options: {
    client: string
    description: string
    timeoutMs: number
    complete: (output: string) => boolean
    settleDelayMs?: number
    onOpen?: (socket: WebSocket) => void
  },
): Promise<string> {
  const wsUrl = new URL('/api/workspaces/pty', baseUrl)
  wsUrl.protocol = 'ws:'
  wsUrl.searchParams.set('session', sessionId)
  wsUrl.searchParams.set('cols', '120')
  wsUrl.searchParams.set('rows', '32')
  wsUrl.searchParams.set('client', options.client)
  wsUrl.searchParams.set('kind', 'smoke')
  wsUrl.searchParams.set('takeover', '1')

  return new Promise((resolvePromise, rejectPromise) => {
    const socket = new WebSocket(wsUrl)
    socket.binaryType = 'arraybuffer'
    let output = ''
    let settled = false
    const finish = (error?: Error) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      socket.close()
      if (error) rejectPromise(error)
      else resolvePromise(output)
    }
    const timeout = setTimeout(() => {
      finish(new Error(`external Agent Runtime PTY timed out waiting for ${options.description}:\n${output.slice(-4_000)}`))
    }, options.timeoutMs)
    socket.addEventListener('open', () => options.onOpen?.(socket))
    socket.addEventListener('message', (event) => {
      const chunk = typeof event.data === 'string'
        ? event.data
        : event.data instanceof ArrayBuffer
          ? Buffer.from(event.data).toString('utf8')
          : String(event.data)
      output += chunk
      if (!options.complete(output)) return
      if (options.settleDelayMs) setTimeout(() => finish(), options.settleDelayMs)
      else finish()
    })
    socket.addEventListener('error', () => finish(new Error('external Agent Runtime PTY WebSocket failed')))
    socket.addEventListener('close', () => {
      if (!settled) finish(new Error(`external Agent Runtime PTY closed before ${options.description}:\n${output}`))
    })
  })
}

async function waitForFileText(path: string, timeoutMs: number): Promise<string> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      return await readFile(path, 'utf8')
    } catch {
      await Bun.sleep(25)
    }
  }
  throw new Error(`timed out waiting for file: ${path}`)
}

function run(command: string[], env: Record<string, string>): string {
  const result = Bun.spawnSync(command, {
    env,
    stdout: 'pipe',
    stderr: 'pipe',
  })
  if (result.exitCode !== 0) {
    throw new Error(`${command.join(' ')} failed (${result.exitCode}): ${result.stderr.toString() || result.stdout.toString()}`)
  }
  return result.stdout.toString()
}

async function runAsync(command: string[], env: Record<string, string>): Promise<string> {
  const child = Bun.spawn(command, {
    env,
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ])
  if (exitCode !== 0) {
    throw new Error(`${command.join(' ')} failed (${exitCode}): ${stderr || stdout}`)
  }
  return stdout
}

async function waitForHttp(url: string, timeoutMs: number): Promise<string> {
  const deadline = Date.now() + timeoutMs
  let lastError: unknown = null
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url)
      const body = await response.text()
      if (response.ok) return body
      lastError = new Error(`${url} returned ${response.status}`)
    } catch (error) {
      lastError = error
    }
    await Bun.sleep(100)
  }
  throw new Error(`Timed out waiting for ${url}: ${String(lastError)}`)
}

async function releaseFiles(root: string, excluded = new Set<string>()): Promise<Array<{
  path: string
  type: 'file' | 'symlink'
  bytes: number
  sha256: string
  mode?: number
  target?: string
}>> {
  const output: Array<{
    path: string
    type: 'file' | 'symlink'
    bytes: number
    sha256: string
    mode?: number
    target?: string
  }> = []
  async function walk(current: string): Promise<void> {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const absolute = join(current, entry.name)
      const path = relative(root, absolute)
      if (excluded.has(path)) continue
      if (entry.isDirectory()) {
        await walk(absolute)
      } else if (entry.isSymbolicLink()) {
        const target = await readlink(absolute)
        output.push({
          path,
          type: 'symlink',
          bytes: Buffer.byteLength(target),
          sha256: sha256(target),
          target,
        })
      } else if (entry.isFile()) {
        const info = await lstat(absolute)
        output.push({
          path,
          type: 'file',
          bytes: info.size,
          mode: info.mode & 0o777,
          sha256: await sha256File(absolute),
        })
      }
    }
  }
  await walk(root)
  return output.sort((left, right) => left.path.localeCompare(right.path))
}

async function directoryBytes(root: string): Promise<number> {
  return (await releaseFiles(root)).reduce((sum, entry) => sum + entry.bytes, 0)
}

async function sha256File(path: string): Promise<string> {
  return sha256(await readFile(path))
}

function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex')
}

async function exists(path: string): Promise<boolean> {
  return stat(path).then(() => true, () => false)
}

async function allocatePorts(count: number): Promise<number[]> {
  const ports: number[] = []
  for (let index = 0; index < count; index += 1) {
    const server = Bun.listen({ hostname: '127.0.0.1', port: 0, socket: { data() {} } })
    ports.push(server.port)
    server.stop(true)
  }
  return ports
}
