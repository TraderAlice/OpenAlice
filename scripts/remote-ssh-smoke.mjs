#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process'
import { Writable } from 'node:stream'
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { writeAliceProjectProductStamp } from '../packages/cli/src/alice-project-product.ts'
import { planProjectTransfer } from '../packages/cli/src/project-transfer.ts'
import { sealProjectTransferJson } from '../packages/cli/src/project-transfer-secrets.ts'
import { writeProjectTransferStream } from '../packages/cli/src/project-transfer-stream.ts'

const repoRoot = fileURLToPath(new URL('..', import.meta.url))
const cliEntry = join(repoRoot, 'packages/cli/bin/openalice.ts')
const suffix = `${process.pid}-${Date.now().toString(36)}`
const image = `openalice-remote-smoke:${suffix}`
const args = process.argv.slice(2)
const keepImage = args.includes('--keep-image')
const keepContainer = args.includes('--keep-container')
const skipTui = args.includes('--skip-tui')
let imageBuilt = false
let container = ''
let scratch = ''

if (args.includes('--help') || args.includes('-h')) {
  console.log(`Usage: pnpm test:remote:docker [--keep-image] [--keep-container]

Builds a clean local SSH host, serves the real OpenAlice installer inside that
host, and exercises plan, install, detached Server start, browser tunnel,
disconnect persistence, reconnect, structured stop, and absent status. This is
the clean Linux acceptance gate used by the CLI installer workflow.

Options:
  --keep-image      Preserve the temporary Docker image
  --keep-container  Preserve the running fixture container (also keeps image)
  --skip-tui        Skip the dependency-backed interactive TUI journey
  -h, --help        Show this help
`)
  process.exit(0)
}

const unknownArgs = args.filter((arg) => ![
  '--keep-image',
  '--keep-container',
  '--skip-tui',
].includes(arg))
if (unknownArgs.length > 0) {
  console.error(`remote docker smoke: unknown option: ${unknownArgs[0]}`)
  process.exit(1)
}

try {
  scratch = await mkdtemp(join(tmpdir(), 'openalice-remote-smoke-'))
  const keyPath = join(scratch, 'id_ed25519')
  run('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-f', keyPath])

  console.log(`[remote-ssh-smoke] building ${image}`)
  run('docker', [
    'build',
    '--file', 'scripts/remote-smoke/Dockerfile',
    '--tag', image,
    '.',
  ], { cwd: repoRoot, inherit: true })
  imageBuilt = true

  container = run('docker', [
    'run', '--detach', '--rm',
    '--publish', '127.0.0.1::22',
    '--mount', `type=bind,src=${keyPath}.pub,dst=/tmp/authorized_keys,readonly`,
    image,
  ]).trim()
  const portOutput = run('docker', ['port', container, '22/tcp']).trim()
  const sshPort = Number(portOutput.slice(portOutput.lastIndexOf(':') + 1))
  if (!Number.isInteger(sshPort) || sshPort < 1) throw new Error(`Could not parse SSH port from ${portOutput}`)

  const localHome = join(scratch, 'local-home')
  const sshDir = join(localHome, '.ssh')
  await mkdir(sshDir, { recursive: true })
  await writeFile(join(sshDir, 'config'), `Host openalice-remote-smoke
  HostName 127.0.0.1
  User smoke
  Port ${sshPort}
  IdentityFile ${keyPath}
  IdentitiesOnly yes
  StrictHostKeyChecking no
  UserKnownHostsFile ${join(sshDir, 'known_hosts')}
  LogLevel ERROR
`)
  await chmod(sshDir, 0o700)
  await chmod(join(sshDir, 'config'), 0o600)
  const fixtureBin = join(scratch, 'bin')
  await mkdir(fixtureBin, { recursive: true })
  const sshWrapper = join(fixtureBin, 'ssh')
  const systemSsh = run('which', ['ssh']).trim()
  await writeFile(sshWrapper, `#!/bin/sh\nexec ${shellQuote(systemSsh)} -F "$OPENALICE_REMOTE_SMOKE_SSH_CONFIG" "$@"\n`)
  await chmod(sshWrapper, 0o700)

  const remoteTarget = 'openalice-remote-smoke'
  let smokeEnv = {
    ...process.env,
    HOME: localHome,
    PATH: `${fixtureBin}:${process.env.PATH ?? ''}`,
    OPENALICE_REMOTE_SMOKE_SSH_CONFIG: join(sshDir, 'config'),
    OPENALICE_REMOTE_TEST_INSTALL_BASE_URL: 'http://127.0.0.1:18080',
  }
  await waitForSsh(remoteTarget, smokeEnv)
  smokeEnv = {
    ...smokeEnv,
    ...await prepareLocalDevIdentityFixture(container, scratch),
  }

  console.log('[remote-ssh-smoke] checking read-only missing-host plan')
  const initialPlan = run(process.execPath, [
    cliEntry, 'remote', remoteTarget,
    '--plan', '--no-open',
  ], { cwd: repoRoot, env: smokeEnv })
  requireText(initialPlan, 'install remote OpenAlice CLI')
  requireText(initialPlan, 'start remote OpenAlice Server')
  requireText(initialPlan, 'installed-native')
  run('ssh', [remoteTarget, 'test ! -x "$HOME/.openalice/bin/openalice"'], { env: smokeEnv })

  console.log('[remote-ssh-smoke] applying install/start and opening first tunnel')
  const firstTunnelUrl = await attachAndProbe(remoteTarget, smokeEnv, [
    '--yes', '--no-open', '--wait', '30',
  ])
  const running = remoteJson(remoteTarget, smokeEnv, '"$HOME/.openalice/bin/openalice" server status --json')
  if (running.class !== 'running' || running.owner?.surface !== 'cli-server') {
    throw new Error(`Remote Server did not survive tunnel disconnect: ${JSON.stringify(running)}`)
  }
  run('ssh', [remoteTarget, 'test ! -e "$HOME/.openalice/bin/pi"'], { env: smokeEnv })
  const launchRoot = running.owner?.launchRoot
  if (typeof launchRoot !== 'string' || !launchRoot.includes('/.openalice/cli/releases/')) {
    throw new Error(`Remote Server did not use an installed Runtime: ${JSON.stringify(launchRoot)}`)
  }
  if (running.provider?.kind !== 'bun') {
    throw new Error(`Remote Server did not report the Bun provider: ${JSON.stringify(running.provider)}`)
  }

  console.log('[remote-ssh-smoke] registering the host and reading aggregate AliceProject inventory')
  run('ssh', [remoteTarget,
    '"$HOME/.openalice/bin/openalice" create alice-project --name research --home /home/smoke/.openalice-research --product nano --yes',
  ], { env: smokeEnv })
  run(process.execPath, [
    cliEntry, 'machine', 'add', 'smoke-cloud', '--target', remoteTarget,
    '--name', 'Smoke Cloud', '--yes',
  ], { cwd: repoRoot, env: smokeEnv })
  const fleet = JSON.parse(run(process.execPath, [
    cliEntry, 'machine', 'inspect', 'smoke-cloud', '--json',
  ], { cwd: repoRoot, env: smokeEnv }))
  if (fleet.machine?.connection !== 'online') {
    throw new Error(`Registered Machine did not become online: ${JSON.stringify(fleet)}`)
  }
  const inventoryProjects = fleet.machine?.projects ?? []
  if (inventoryProjects.length !== 2
    || !inventoryProjects.some((project) => project.key === 'default' && project.runtime?.class === 'running')
    || !inventoryProjects.some((project) => project.key === 'research' && project.product === 'nano')) {
    throw new Error(`Aggregate Machine inventory did not include both AliceProjects: ${JSON.stringify(fleet)}`)
  }

  console.log('[remote-ssh-smoke] checking reuse plan and reconnecting')
  const reusePlan = run(process.execPath, [
    cliEntry, 'remote', remoteTarget, '--plan', '--no-open',
  ], { cwd: repoRoot, env: smokeEnv })
  requireText(reusePlan, 'reuse compatible remote CLI Server')
  const reconnectedTunnelUrl = await attachAndProbe(remoteTarget, smokeEnv, ['--no-open', '--wait', '30'])
  if (reconnectedTunnelUrl !== firstTunnelUrl) {
    throw new Error(`Reconnect changed the remembered browser origin (${firstTunnelUrl} -> ${reconnectedTunnelUrl})`)
  }

  console.log('[remote-ssh-smoke] stopping the remote Server through its control endpoint')
  const statusOutput = run(process.execPath, [cliEntry, 'remote', remoteTarget, '--status'], { cwd: repoRoot, env: smokeEnv })
  requireText(statusOutput, 'Runtime: running (cli-server)')
  const stopOutput = run(process.execPath, [cliEntry, 'remote', remoteTarget, '--stop', '--wait', '15'], { cwd: repoRoot, env: smokeEnv })
  requireText(stopOutput, 'OpenAlice Server is stopped')
  const absent = remoteJson(remoteTarget, smokeEnv, '"$HOME/.openalice/bin/openalice" server status --json')
  if (absent.class !== 'absent') throw new Error(`Remote Server did not stop cleanly: ${JSON.stringify(absent)}`)

  console.log('[remote-ssh-smoke] planning and applying an AliceProject transfer')
  const transferSource = join(localHome, '.openalice')
  const transferWorkspace = await prepareTransferSource(transferSource)
  const interruptedPlan = await planProjectTransfer({
    source: {
      id: 'alice-project-remote-smoke-source',
      key: 'default',
      displayName: 'Remote Smoke Source',
      home: transferSource,
      port: 47331,
      portAutomatic: true,
      isDefault: true,
    },
    destinationMachineKey: 'smoke-cloud',
    destinationProjectKey: 'interrupted',
    destinationDisplayName: 'Interrupted Retry',
    destinationHome: '/home/smoke/.openalice-interrupted',
    scheduledIssues: 'keep-blocked',
    randomId: () => 'remote-smoke-interrupted',
  })
  const interruptedStream = await serializeTransfer(interruptedPlan)
  const receiveCommand = '"$HOME/.openalice/bin/openalice" project transfer-receive'
  const interrupted = sshWithInput(
    remoteTarget,
    smokeEnv,
    receiveCommand,
    interruptedStream.subarray(0, interruptedStream.byteLength - 100),
  )
  if (interrupted.status === 0) throw new Error('Truncated transfer unexpectedly succeeded')
  run('ssh', [remoteTarget, [
    'set -eu',
    'test ! -e /home/smoke/.openalice-interrupted',
    'test -f /home/smoke/.openalice-transfer-remote-smoke-interrupted.staging/.openalice-transfer-transaction.json',
    'grep -Eq \'"state"[[:space:]]*:[[:space:]]*"failed"\' /home/smoke/.openalice-transfer-remote-smoke-interrupted.staging/.openalice-transfer-transaction.json',
  ].join('; ')], { env: smokeEnv })
  const retried = sshWithInput(remoteTarget, smokeEnv, receiveCommand, interruptedStream)
  if (retried.status !== 0) throw new Error(`Interrupted transfer retry failed (${retried.status})`)
  const retryReceipt = JSON.parse(retried.stdout.trim())
  if (retryReceipt.transferId !== interruptedPlan.transferId || retryReceipt.sessionsImported !== 0) {
    throw new Error(`Interrupted transfer returned the wrong receipt: ${retried.stdout}`)
  }
  run('ssh', [remoteTarget, [
    'set -eu',
    'test -f /home/smoke/.openalice-interrupted/workspaces/workspaces/ws-transfer/research.txt',
    'test ! -e /home/smoke/.openalice-transfer-remote-smoke-interrupted.staging',
  ].join('; ')], { env: smokeEnv })
  if (skipTui) {
    console.log('[remote-ssh-smoke] skipping dependency-backed TUI journey')
  } else {
    console.log('[remote-ssh-smoke] walking the real TUI transfer wizard (default No, then success)')
    await driveTransferTui(smokeEnv, {
      projectKey: 'tui-migrated',
      destinationHome: '/home/smoke/.openalice-tui-migrated',
      approve: false,
    })
    console.log('[remote-ssh-smoke] TUI default-No journey completed')
    run('ssh', [remoteTarget, 'test ! -e /home/smoke/.openalice-tui-migrated'], { env: smokeEnv })
    await driveTransferTui(smokeEnv, {
      projectKey: 'tui-migrated',
      destinationHome: '/home/smoke/.openalice-tui-migrated',
      approve: true,
    })
    console.log('[remote-ssh-smoke] TUI approved journey completed')
    const tuiRegistry = remoteJson(remoteTarget, smokeEnv, '"$HOME/.openalice/bin/openalice" project list --json')
    const tuiProject = tuiRegistry.projects?.find((project) => project.key === 'tui-migrated')
    if (tuiProject?.home !== '/home/smoke/.openalice-tui-migrated') {
      throw new Error(`TUI registered the wrong destination: ${JSON.stringify(tuiRegistry)}`)
    }
    run('ssh', [remoteTarget, [
      'set -eu',
      'test -f /home/smoke/.openalice-tui-migrated/workspaces/workspaces/ws-transfer/research.txt',
      'test ! -e /home/smoke/.openalice-tui-migrated/workspaces/state/resume-identities.json',
    ].join('; ')], { env: smokeEnv })
  }
  const transferArgs = [
    cliEntry, 'project', 'transfer',
    '--from', 'default',
    '--to-machine', 'smoke-cloud',
    '--to-project', 'migrated',
    '--to-home', '/home/smoke/.openalice-migrated',
    '--session-owner-policy', 'keep-blocked',
  ]
  const transferPlan = run(process.execPath, [...transferArgs, '--plan'], { cwd: repoRoot, env: smokeEnv })
  requireText(transferPlan, 'Nothing has changed yet.')
  requireText(transferPlan, 'Sessions     0 imported')
  run('ssh', [remoteTarget, 'test ! -e /home/smoke/.openalice-migrated'], { env: smokeEnv })
  const transferOutput = run(process.execPath, [...transferArgs, '--yes'], { cwd: repoRoot, env: smokeEnv })
  requireText(transferOutput, 'AliceProject transfer complete')
  requireText(transferOutput, 'Sessions imported: 0')
  run('ssh', [remoteTarget, [
    'set -eu',
    'test -f /home/smoke/.openalice-migrated/workspaces/workspaces/ws-transfer/research.txt',
    'test -f /home/smoke/.openalice-migrated/workspaces/workspaces/ws-transfer/.alice/sessions/tracked.json',
    'test ! -e /home/smoke/.openalice-migrated/workspaces/workspaces/ws-transfer/.alice/sessions/untracked.json',
    'test ! -e /home/smoke/.openalice-migrated/workspaces/state/resume-identities.json',
    'test ! -e /home/smoke/.openalice-migrated/data/config/ports.json',
    'test ! -e /home/smoke/.openalice-migrated/data/config/auth.json',
    'grep -Fq synthetic-ai-transfer-secret /home/smoke/.openalice-migrated/data/config/ai-provider-manager.json',
  ].join('; ')], { env: smokeEnv })
  const remoteSealingKey = run('ssh', [remoteTarget, 'cat /home/smoke/.openalice-migrated/sealing.key'], { env: smokeEnv }).trim()
  const localSealingKey = (await import('node:fs/promises')).readFile(join(transferSource, 'sealing.key'), 'utf8')
  if (remoteSealingKey === (await localSealingKey).trim()) throw new Error('Transfer copied the source sealing key')
  const migratedRegistry = remoteJson(remoteTarget, smokeEnv, '"$HOME/.openalice/bin/openalice" project list --json')
  if (migratedRegistry.defaultProject !== 'research'
    || !migratedRegistry.projects?.some((project) => project.key === 'migrated')) {
    throw new Error(`Transferred AliceProject was not registered without changing the remote default: ${JSON.stringify(migratedRegistry)}`)
  }
  run('ssh', [remoteTarget,
    'grep -Fq /home/smoke/.openalice-migrated/workspaces/workspaces/ws-transfer /home/smoke/.openalice-migrated/workspaces/workspaces.json',
  ], { env: smokeEnv })
  const sourceResearch = await (await import('node:fs/promises')).readFile(join(transferWorkspace, 'research.txt'), 'utf8')
  if (sourceResearch !== 'portable transfer research\n') throw new Error('Transfer changed the source Workspace')
  run('ssh', [remoteTarget,
    '"$HOME/.openalice/bin/openalice" up --project migrated --wait 30 >/tmp/migrated-up.log',
  ], { env: smokeEnv })
  const migratedStatus = remoteJson(remoteTarget, smokeEnv,
    '"$HOME/.openalice/bin/openalice" status --project migrated --json')
  const migratedRuntimeClass = migratedStatus.result?.status?.class
    ?? migratedStatus.runtime?.class
    ?? migratedStatus.class
  if (migratedRuntimeClass !== 'running') {
    throw new Error(`Transferred AliceProject did not start: ${JSON.stringify(migratedStatus)}`)
  }
  run('ssh', [remoteTarget,
    '"$HOME/.openalice/bin/openalice" down --project migrated --wait 15 >/tmp/migrated-down.log',
  ], { env: smokeEnv })

  console.log('[remote-ssh-smoke] passed')
} catch (error) {
  console.error(`[remote-ssh-smoke] failed: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
} finally {
  if (keepContainer && container) {
    console.log(`[remote-ssh-smoke] kept container ${container}`)
  } else if (container) {
    run('docker', ['rm', '--force', container], { allowFailure: true, inherit: true })
  }
  if ((keepImage || keepContainer) && imageBuilt) {
    console.log(`[remote-ssh-smoke] kept image ${image}`)
  } else if (imageBuilt) {
    run('docker', ['image', 'rm', '--force', image], { allowFailure: true, inherit: true })
  }
  if (scratch) await rm(scratch, { recursive: true, force: true })
}

async function prepareTransferSource(home) {
  await writeAliceProjectProductStamp(home, 'trader')
  await writeFile(join(home, 'data', 'config', 'ai-provider-manager.json'), `${JSON.stringify({
    profiles: { default: { backend: 'native' } },
    credentials: {
      'openai-1': { vendor: 'openai', authType: 'api-key', apiKey: 'synthetic-ai-transfer-secret' },
    },
  }, null, 2)}\n`)
  await writeFile(join(home, 'data', 'config', 'market-data.json'), `${JSON.stringify({
    providerKeys: { fmp: 'synthetic-provider-transfer-secret' },
  }, null, 2)}\n`)
  await sealProjectTransferJson(home, join('data', 'config', 'accounts.json'), [
    { id: 'paper', presetId: 'alpaca-paper', presetConfig: { apiKey: 'synthetic-broker-transfer-secret' } },
  ])
  await sealProjectTransferJson(home, join('data', 'config', 'connectors.json'), {
    version: 1,
    adapters: { telegram: { enabled: true, settings: { token: 'synthetic-connector-transfer-secret' } } },
  })
  await writeFile(join(home, 'data', 'config', 'ports.json'), '{"web":49999}\n')
  await writeFile(join(home, 'data', 'config', 'auth.json'), '{"tokenHash":"machine-local"}\n')
  const workspace = join(home, 'workspaces', 'workspaces', 'ws-transfer')
  await mkdir(join(workspace, '.alice', 'sessions'), { recursive: true })
  await mkdir(join(workspace, '.alice', 'issues'), { recursive: true })
  await writeFile(join(workspace, 'research.txt'), 'portable transfer research\n')
  await writeFile(join(workspace, '.alice', 'sessions', 'tracked.json'), '{"resumeId":"tracked-inert"}\n')
  run('git', ['init', '--initial-branch=main'], { cwd: workspace })
  run('git', ['config', 'user.email', 'smoke@openalice.local'], { cwd: workspace })
  run('git', ['config', 'user.name', 'OpenAlice Smoke'], { cwd: workspace })
  run('git', ['add', 'research.txt', '.alice/sessions/tracked.json'], { cwd: workspace })
  run('git', ['commit', '-m', 'transfer fixture'], { cwd: workspace })
  await writeFile(join(workspace, '.alice', 'sessions', 'untracked.json'), '{"resumeId":"untracked-runtime"}\n')
  await writeFile(join(workspace, '.alice', 'issues', 'scheduled-owner.md'), [
    '---',
    'title: Keep ownership explicit',
    'assignee: "@resume-source-owner"',
    'when: { kind: every, every: 1h }',
    '---',
    'Continue research.',
    '',
  ].join('\n'))
  await mkdir(join(home, 'workspaces', 'state'), { recursive: true })
  await writeFile(join(home, 'workspaces', 'workspaces.json'), `${JSON.stringify({
    version: 1,
    workspaces: [{ id: 'ws-transfer', tag: 'Transfer', dir: workspace, createdAt: '2026-08-23T00:00:00Z' }],
  }, null, 2)}\n`)
  await writeFile(join(home, 'workspaces', 'state', 'workspace-catalog.json'), `${JSON.stringify({
    version: 1,
    workspaces: [{
      id: 'ws-transfer',
      tag: 'Transfer',
      activeDir: workspace,
      createdAt: '2026-08-23T00:00:00Z',
      lifecycle: 'active',
      updatedAt: '2026-08-23T00:00:00Z',
    }],
  }, null, 2)}\n`)
  await writeFile(join(home, 'workspaces', 'state', 'resume-identities.json'), '{"version":1,"records":{}}\n')
  return workspace
}

async function prepareLocalDevIdentityFixture(containerId, scratchRoot) {
  const remoteArch = normalizeSmokeArchitecture(
    run('docker', ['exec', containerId, 'uname', '-m']).trim(),
  )
  const remoteArchive = `/fixture/www/cli/dev/openalice-cli-dev-linux-${remoteArch}.tar.gz`
  const remoteSha256 = run('docker', [
    'exec', containerId, 'sh', '-c',
    `awk 'NR == 1 { print $1 }' ${shellQuote(`${remoteArchive}.sha256`)}`,
  ]).trim()
  const metadata = JSON.parse(run('docker', [
    'exec', containerId, 'sh', '-c',
    `archive=${shellQuote(remoteArchive)}; root="$(tar -tzf "$archive" | sed -n '1{s#/.*##;p}')"; tar -xOzf "$archive" "$root/release.json"`,
  ]))
  if (
    !/^[a-f0-9]{64}$/.test(remoteSha256)
    || metadata?.platform !== 'linux'
    || metadata?.arch !== remoteArch
    || !/^[a-f0-9]{16}$/.test(metadata?.contentIdentity ?? '')
    || typeof metadata?.version !== 'string'
  ) {
    throw new Error('Remote smoke artifact did not expose valid dev identity metadata')
  }

  const localPlatform = process.platform
  const localArch = process.arch
  if (!['darwin', 'linux'].includes(localPlatform) || !['arm64', 'x64'].includes(localArch)) {
    throw new Error(`Remote smoke does not support local target ${localPlatform}-${localArch}`)
  }
  const remoteTarget = {
    platform: 'linux',
    arch: remoteArch,
    archive: `openalice-cli-dev-linux-${remoteArch}.tar.gz`,
    sha256: remoteSha256,
    contentIdentity: metadata.contentIdentity,
  }
  const targetMatrix = [
    ['darwin', 'arm64'],
    ['darwin', 'x64'],
    ['linux', 'arm64'],
    ['linux', 'x64'],
  ]
  const targets = targetMatrix.map(([platform, arch], index) => {
    if (platform === remoteTarget.platform && arch === remoteTarget.arch) return remoteTarget
    const marker = (index + 4).toString(16)
    return {
      platform,
      arch,
      archive: `openalice-cli-dev-${platform}-${arch}.tar.gz`,
      sha256: marker.repeat(64),
      contentIdentity: marker.repeat(16),
    }
  })
  const localTarget = targets.find((target) => (
    target.platform === localPlatform && target.arch === localArch
  ))
  if (!localTarget) throw new Error(`Remote smoke did not synthesize local target ${localPlatform}-${localArch}`)
  const manifest = {
    schemaVersion: 1,
    channel: 'dev',
    repository: 'TraderAlice/OpenAlice',
    version: metadata.version,
    commit: run('git', ['rev-parse', 'HEAD'], { cwd: repoRoot }).trim(),
    installer: {
      url: 'http://127.0.0.1:18080/install',
      versionedUrl: 'http://127.0.0.1:18080/install',
      sha256: '3'.repeat(64),
    },
    targets,
  }
  const installSourcePath = join(scratchRoot, 'local-dev-install-source.json')
  await writeFile(installSourcePath, `${JSON.stringify({
    schemaVersion: 3,
    repository: 'TraderAlice/OpenAlice',
    cliVersion: metadata.version,
    selector: { kind: 'branch', value: 'dev' },
    installerUrl: 'http://127.0.0.1:18080/install',
    updateChannel: 'development',
    method: 'direct',
    artifact: {
      platform: localTarget.platform,
      arch: localTarget.arch,
      sha256: localTarget.sha256,
    },
    installedAt: '2026-08-31T00:00:00.000Z',
  }, null, 2)}\n`)
  return {
    OPENALICE_INSTALL_SOURCE: installSourcePath,
    OPENALICE_CONTENT_IDENTITY: localTarget.contentIdentity,
    OPENALICE_REMOTE_TEST_DEV_MANIFEST_URL: `data:application/json;base64,${Buffer.from(JSON.stringify(manifest)).toString('base64')}`,
  }
}

function normalizeSmokeArchitecture(value) {
  if (value === 'aarch64' || value === 'arm64') return 'arm64'
  if (value === 'x86_64' || value === 'amd64') return 'x64'
  throw new Error(`Remote smoke does not support Docker architecture ${value}`)
}

async function waitForSsh(target, env) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const result = spawnSync('ssh', [target, 'true'], { env, stdio: 'ignore' })
    if (result.status === 0) return
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100))
  }
  throw new Error('SSH fixture did not become ready')
}

async function attachAndProbe(target, env, remoteArgs) {
  const child = spawn(process.execPath, [cliEntry, 'remote', target, ...remoteArgs], {
    cwd: repoRoot,
    env,
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  child.stdout.setEncoding('utf8')
  let output = ''
  let resolveUrl
  let rejectUrl
  const urlReady = new Promise((resolvePromise, rejectPromise) => {
    resolveUrl = resolvePromise
    rejectUrl = rejectPromise
  })
  child.stdout.on('data', (chunk) => {
    process.stdout.write(chunk)
    output += chunk
    const match = /Local OpenAlice UI: (http:\/\/127\.0\.0\.1:\d+)/.exec(output)
    if (match) resolveUrl(match[1])
  })
  child.once('error', rejectUrl)
  child.once('exit', (code, signal) => {
    if (!/Local OpenAlice UI:/.test(output)) {
      rejectUrl(new Error(`remote CLI exited before tunnel readiness (code=${String(code)}, signal=${String(signal)})`))
    }
  })

  const timeout = setTimeout(() => rejectUrl(new Error('Timed out waiting for the local tunnel URL')), 60_000)
  let url
  try {
    url = await urlReady
  } finally {
    clearTimeout(timeout)
  }
  const response = await fetch(`${url}/api/auth/status`, { signal: AbortSignal.timeout(5_000) })
  const body = await response.json()
  if (!response.ok || body.authed !== true || body.tokenConfigured !== true || body.passthrough !== 'localhost') {
    child.kill('SIGTERM')
    throw new Error(`Tunnel returned the wrong Runtime response: ${JSON.stringify(body)}`)
  }
  child.kill('SIGTERM')
  const exit = await waitForExit(child, 10_000)
  if (exit.code !== 0) throw new Error(`remote CLI did not close cleanly after tunnel disconnect (${JSON.stringify(exit)})`)
  return url
}

function waitForExit(child, timeoutMs) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve({ code: child.exitCode ?? 0, signal: child.signalCode })
  }
  return new Promise((resolvePromise, rejectPromise) => {
    const timeout = setTimeout(() => {
      child.kill('SIGKILL')
      rejectPromise(new Error('Timed out waiting for remote CLI to close'))
    }, timeoutMs)
    child.once('exit', (code, signal) => {
      clearTimeout(timeout)
      resolvePromise({ code: code ?? 0, signal })
    })
  })
}

function remoteJson(target, env, command) {
  const output = run('ssh', [target, command], { env })
  return JSON.parse(output.trim().split(/\r?\n/).filter(Boolean).at(-1))
}

function requireText(output, expected) {
  if (!output.includes(expected)) throw new Error(`Expected output to contain ${JSON.stringify(expected)}\n${output}`)
}

async function serializeTransfer(plan) {
  const chunks = []
  const output = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(Buffer.from(chunk))
      callback()
    },
  })
  await writeProjectTransferStream({ plan, output })
  return Buffer.concat(chunks)
}

function sshWithInput(target, env, command, input) {
  const result = spawnSync('ssh', [target, command], {
    cwd: repoRoot,
    env,
    input,
    encoding: 'utf8',
    maxBuffer: 2 * 1024 * 1024,
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  if (result.error) throw result.error
  return {
    status: result.status,
    stdout: typeof result.stdout === 'string' ? result.stdout : '',
  }
}

async function driveTransferTui(env, options) {
  const pty = await import('node-pty')
  const child = pty.spawn(process.execPath, [cliEntry], {
    cols: 110,
    rows: 32,
    cwd: repoRoot,
    env,
  })
  let output = ''
  let stage = 0
  const writeValue = (value) => child.write(`\u0001\u000b${value}\r`)
  return new Promise((resolvePromise, reject) => {
    const timeout = setTimeout(() => {
      child.kill()
      reject(new Error(`TUI transfer wizard timed out at stage ${stage}:\n${stripAnsi(output).slice(-4_000)}`))
    }, 90_000)
    child.onData((data) => {
      output += data
      const visible = stripAnsi(output)
      if (stage === 0 && visible.includes('m Transfer') && /Smoke Cloud\s+\d+/u.test(visible)) { stage = 1; child.write('m') }
      else if (stage === 1 && visible.includes('destination Machine')) { stage = 2; child.write('\r') }
      else if (stage === 2 && visible.includes('Destination AliceProject key')) { stage = 3; writeValue(options.projectKey) }
      else if (stage === 3 && visible.includes('Destination complete Home')) { stage = 4; writeValue(options.destinationHome) }
      else if (stage === 4 && visible.includes('Credentials')) { stage = 5; child.write('\r') }
      else if (stage === 5 && visible.includes('Exact-Session scheduled Issue owners')) { stage = 6; child.write('\r') }
      else if (stage === 6 && visible.includes('Review AliceProject transfer')) {
        stage = 7
        child.write(options.approve ? 'y' : 'n')
      } else if (stage === 7 && !options.approve && visible.includes('Transfer cancelled')) {
        stage = 8; child.write('q')
      } else if (stage === 7 && options.approve && visible.includes('AliceProject transfer complete')) {
        stage = 8; child.write('\r'); setTimeout(() => child.write('q'), 50)
      }
    })
    child.onExit(({ exitCode }) => {
      clearTimeout(timeout)
      if (exitCode === 0 && stage === 8) resolvePromise()
      else reject(new Error(`TUI transfer wizard exited ${exitCode} at stage ${stage}:\n${stripAnsi(output).slice(-4_000)}`))
    })
  })
}

function stripAnsi(value) {
  return value.replaceAll(/\u001b(?:\[[0-?]*[ -/]*[@-~]|\][^\u0007]*(?:\u0007|\u001b\\))/gu, '')
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'"'"'`)}'`
}

function run(command, commandArgs, options = {}) {
  const result = spawnSync(command, commandArgs, {
    cwd: options.cwd ?? repoRoot,
    env: options.env ?? process.env,
    encoding: 'utf8',
    stdio: options.inherit ? 'inherit' : ['ignore', 'pipe', 'inherit'],
  })
  if (result.error) throw result.error
  if (result.status !== 0 && !options.allowFailure) {
    throw new Error(`${command} ${commandArgs[0] ?? ''} failed (${result.status ?? result.signal ?? 'unknown'})`)
  }
  return typeof result.stdout === 'string' ? result.stdout : ''
}
