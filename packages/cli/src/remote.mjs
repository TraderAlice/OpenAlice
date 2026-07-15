import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline/promises'

import { formatMissingRuntimeBuildTools } from './runtime-deps.mjs'
import { connectSsh } from './ssh-connect.mjs'

const DEFAULT_INSTALL_URL = 'https://raw.githubusercontent.com/TraderAlice/OpenAlice/dev/install'
const MAX_SSH_OUTPUT_BYTES = 1024 * 1024

export function parseRemoteArgs(argv) {
  const options = {
    destination: '',
    appDir: '',
    remoteHome: '',
    localPort: 0,
    remotePort: 47331,
    remotePortExplicit: false,
    sshPort: null,
    identityFile: null,
    openBrowser: true,
    waitMs: 120_000,
    assumeYes: false,
    planOnly: false,
    takeover: false,
  }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--') continue
    if (arg === '--app-dir') {
      options.appDir = requireAbsoluteRemotePath(requireValue(argv, ++index, arg), arg)
      continue
    }
    if (arg === '--home') {
      options.remoteHome = requireAbsoluteRemotePath(requireValue(argv, ++index, arg), arg)
      continue
    }
    if (arg === '--local-port') {
      options.localPort = parsePort(requireValue(argv, ++index, arg), arg, { allowAuto: true })
      continue
    }
    if (arg === '--remote-port') {
      options.remotePort = parsePort(requireValue(argv, ++index, arg), arg)
      options.remotePortExplicit = true
      continue
    }
    if (arg === '--ssh-port') {
      options.sshPort = parsePort(requireValue(argv, ++index, arg), arg)
      continue
    }
    if (arg === '--identity') {
      options.identityFile = requireValue(argv, ++index, arg)
      continue
    }
    if (arg === '--wait') {
      const seconds = Number(requireValue(argv, ++index, arg))
      if (!Number.isFinite(seconds) || seconds < 1 || seconds > 600) {
        throw new Error('--wait must be a number of seconds between 1 and 600')
      }
      options.waitMs = Math.round(seconds * 1_000)
      continue
    }
    if (arg === '--no-open') {
      options.openBrowser = false
      continue
    }
    if (arg === '--yes' || arg === '-y') {
      options.assumeYes = true
      continue
    }
    if (arg === '--plan') {
      options.planOnly = true
      continue
    }
    if (arg === '--takeover') {
      options.takeover = true
      continue
    }
    if (arg?.startsWith('-')) throw new Error(`Unknown option: ${arg}`)
    if (options.destination) throw new Error(`Unexpected argument: ${arg}`)
    validateSshDestination(arg)
    options.destination = arg
  }
  if (!options.destination) throw new Error('Remote SSH destination is required (for example: user@example.com)')
  return options
}

export async function connectRemote(options, dependencies = {}) {
  const stdout = dependencies.stdout ?? process.stdout
  const env = dependencies.env ?? process.env
  const probe = dependencies.probeRemote ?? probeRemoteHost
  let remote = await probe(options, dependencies)
  let plan = createRemotePlan(options, remote, {
    installUrl: dependencies.installUrl ?? env['OPENALICE_REMOTE_INSTALL_URL'] ?? DEFAULT_INSTALL_URL,
    installVersion: dependencies.installVersion ?? env['OPENALICE_REMOTE_VERSION'] ?? 'dev',
    installBaseUrl: dependencies.installBaseUrl ?? env['OPENALICE_REMOTE_INSTALL_BASE_URL'] ?? '',
  })
  stdout.write(formatRemotePlan(plan))

  if (plan.blocker) throw new Error(plan.blocker)
  if (options.planOnly) {
    stdout.write('Plan complete. No remote files or processes were changed.\n')
    return 0
  }
  if (plan.mutations.length > 0 && !options.assumeYes) {
    const confirm = dependencies.confirmPlan ?? confirmRemotePlan
    if (!await confirm('Apply this remote plan?', dependencies)) {
      stdout.write('No changes made.\n')
      return 0
    }
  }

  const runRemote = dependencies.runRemote ?? runSshCommand
  if (plan.runInstaller) {
    const expectedRemainingMutations = remainingMutationsAfterInstall(plan)
    const installerPurpose = plan.installRuntimeDeps
      ? 'Preparing the OpenAlice CLI and source Runtime build tools'
      : 'Installing the OpenAlice CLI'
    stdout.write(`${installerPurpose} on ${options.destination} with the normal installer...\n`)
    await runRemote(options, buildRemoteInstallCommand(
      plan.installUrl,
      plan.installVersion,
      plan.installBaseUrl,
      plan.installRuntimeDeps,
    ), dependencies)
    remote = await probe(options, dependencies)
    if (!remote.cliPath || !remote.cliCompatible) {
      throw new Error('The remote OpenAlice CLI install completed, but a compatible CLI was not detected')
    }
    const refreshedPlan = createRemotePlan(options, remote, {
      installUrl: plan.installUrl,
      installVersion: plan.installVersion,
      installBaseUrl: plan.installBaseUrl,
    })
    const planChanged = JSON.stringify(refreshedPlan.mutations) !== JSON.stringify(expectedRemainingMutations)
    if (refreshedPlan.blocker || planChanged) {
      stdout.write('Remote facts changed after the CLI install. Review the refreshed plan:\n')
      stdout.write(formatRemotePlan(refreshedPlan))
    }
    if (refreshedPlan.blocker) throw new Error(refreshedPlan.blocker)
    if (planChanged && refreshedPlan.mutations.length > 0 && !options.assumeYes) {
      const confirm = dependencies.confirmPlan ?? confirmRemotePlan
      if (!await confirm('Apply the refreshed remote plan?', dependencies)) {
        stdout.write('The remote CLI is installed; no additional actions were applied.\n')
        return 0
      }
    }
    plan = refreshedPlan
  }

  if (plan.startServer) {
    stdout.write(`${options.takeover ? 'Replacing' : 'Starting'} the OpenAlice Server on ${options.destination}...\n`)
    await runRemote(options, buildRemoteServerStartCommand(options, remote.cliPath), dependencies)
    remote = await probe(options, dependencies)
  }
  if (remote.status?.class !== 'running' || remote.status?.owner?.surface !== 'cli-server') {
    throw new Error(`Remote OpenAlice Server is not ready after apply (${remote.status?.class ?? 'no status'})`)
  }
  const runtimePort = remoteRuntimePort(remote.status)
  if (runtimePort === null) {
    throw new Error('Remote OpenAlice Server reported an invalid non-loopback web endpoint')
  }
  if (options.remotePortExplicit && runtimePort !== options.remotePort) {
    throw new Error(`Remote OpenAlice Server is listening on ${runtimePort}, not the requested --remote-port ${options.remotePort}`)
  }

  stdout.write(`Remote OpenAlice Server is ready at ${remote.status.endpoints.web}\n`)
  const openTunnel = dependencies.connectTunnel ?? connectSsh
  return openTunnel({
    destination: options.destination,
    localPort: options.localPort,
    remotePort: runtimePort,
    sshPort: options.sshPort,
    identityFile: options.identityFile,
    openBrowser: options.openBrowser,
    waitMs: options.waitMs,
  }, dependencies)
}

export function createRemotePlan(options, remote, install = {}) {
  const installUrl = install.installUrl ?? DEFAULT_INSTALL_URL
  const installVersion = install.installVersion ?? 'dev'
  const installBaseUrl = install.installBaseUrl ?? ''
  const mutations = []
  let blocker = ''
  let installCli = false
  let installRuntimeDeps = false
  let startServer = false
  let remotePort = options.remotePort

  if (!['linux', 'darwin'].includes(remote.platform?.os)) {
    blocker = `Unsupported remote platform: ${remote.platform?.label ?? 'unknown'}. Stage 2 supports Linux and macOS hosts.`
  } else if (!remote.nodeVersion) {
    blocker = 'The remote host does not have Node.js 20 or newer; install Node.js before applying this plan.'
  } else if (!nodeVersionSupported(remote.nodeVersion)) {
    blocker = `The remote host reports ${remote.nodeVersion}; OpenAlice requires Node.js 20 or newer.`
  } else if (options.appDir && remote.sourceCheckoutPresent === false) {
    blocker = `No OpenAlice source checkout was found at ${options.appDir}. Clone it first or pass the correct --app-dir.`
  }

  if (!remote.cliPath || !remote.cliCompatible) {
    installCli = true
  }

  const status = remote.status
  const detectedRuntimePort = remoteRuntimePort(status)
  if (!blocker && status?.class === 'running' && status?.owner?.surface === 'cli-server') {
    if (detectedRuntimePort === null) {
      blocker = 'The remote CLI Server reported an invalid non-loopback web endpoint.'
    } else if (options.remotePortExplicit && detectedRuntimePort !== options.remotePort) {
      blocker = `The remote CLI Server is listening on ${detectedRuntimePort}; omit --remote-port to reuse it or pass ${detectedRuntimePort}.`
    } else {
      remotePort = detectedRuntimePort
    }
  }
  if (!blocker && status?.class === 'owned_elsewhere') {
    if (options.takeover) {
      if (!options.appDir) blocker = '--app-dir <absolute-remote-path> is required to replace the current owner.'
      else {
        startServer = true
        mutations.push(`take over ${status.owner?.surface ?? 'existing'} Runtime and start CLI Server`)
      }
    } else {
      blocker = `Remote ${status.owner?.surface ?? 'Runtime'} already owns ${status.home}. Re-run with --takeover only if replacement is intentional.`
    }
  } else if (!blocker && ['incompatible', 'unhealthy', 'stopping'].includes(status?.class)) {
    if (!options.takeover) {
      blocker = `Remote Runtime is ${status.class}; inspect it or pass --takeover only if replacement is intentional.`
    } else if (!options.appDir) {
      blocker = '--app-dir <absolute-remote-path> is required for takeover.'
    } else {
      startServer = true
      mutations.push('replace incompatible or unhealthy Runtime with CLI Server')
    }
  } else if (!blocker && status?.class !== 'running') {
    if (!options.appDir) blocker = '--app-dir <absolute-remote-path> is required while the source-backed Server is absent.'
    else {
      startServer = true
      mutations.push('start remote OpenAlice Server')
    }
  }

  const runtimeBuildToolsMissing = remote.runtimeBuildToolsMissing ?? []
  if (!blocker && startServer && remote.sourceArtifactsReady !== true && runtimeBuildToolsMissing.length > 0) {
    if (remote.platform?.os === 'linux') {
      installRuntimeDeps = true
    } else {
      blocker = `The remote source Runtime is missing ${formatMissingRuntimeBuildTools(runtimeBuildToolsMissing)}. Run "xcode-select --install" in a local macOS session before reconnecting.`
    }
  }
  if (installRuntimeDeps) mutations.unshift('install source Runtime build tools')
  if (installCli) mutations.unshift(remote.cliPath ? 'update remote OpenAlice CLI' : 'install remote OpenAlice CLI')
  const runInstaller = installCli || installRuntimeDeps
  if (runInstaller && !remote.hasCurl && !blocker) {
    blocker = 'The remote host does not have curl, which the normal OpenAlice installer requires.'
  }

  return {
    target: options.destination,
    platform: remote.platform?.label ?? 'unknown',
    nodeVersion: remote.nodeVersion ?? 'missing',
    cliPath: remote.cliPath ?? 'missing',
    cliVersion: remote.cliVersion ?? 'unknown',
    cliCompatible: remote.cliCompatible === true,
    runtimeClass: status?.class ?? 'unknown',
    runtimeOwner: status?.owner?.surface ?? 'none',
    appDir: options.appDir || 'not selected',
    remoteHome: options.remoteHome || '~/.openalice (remote default)',
    remotePort,
    localPort: options.localPort || 'auto',
    installCli,
    installRuntimeDeps,
    runInstaller,
    startServer,
    sourceCheckoutPresent: remote.sourceCheckoutPresent ?? null,
    sourceArtifactsReady: remote.sourceArtifactsReady ?? null,
    runtimeBuildToolsMissing,
    installUrl,
    installVersion,
    installBaseUrl,
    mutations,
    blocker,
  }
}

export function formatRemotePlan(plan) {
  const actions = plan.mutations.length > 0
    ? [...plan.mutations, 'open local SSH tunnel']
    : ['reuse compatible remote CLI Server', 'open local SSH tunnel']
  const buildTools = plan.sourceCheckoutPresent === false
    ? 'Not inspected (source missing)'
    : plan.sourceArtifactsReady === true
    ? 'Not needed (built artifacts present)'
    : plan.runtimeBuildToolsMissing.length > 0
      ? `Missing: ${formatMissingRuntimeBuildTools(plan.runtimeBuildToolsMissing)}`
      : plan.appDir === 'not selected'
        ? 'Not inspected'
        : 'Ready'
  return `\nOpenAlice Remote\n\nRemote plan\n  Target         ${plan.target}\n  Platform       ${plan.platform}\n  Node.js        ${plan.nodeVersion}\n  CLI            ${plan.cliPath} (${plan.cliVersion}${plan.cliCompatible ? ', compatible' : ', install/update required'})\n  Runtime        ${plan.runtimeClass} (${plan.runtimeOwner})\n  Source         ${plan.appDir}\n  Build tools    ${buildTools}\n  Home           ${plan.remoteHome}\n  Tunnel         127.0.0.1:${plan.localPort} -> remote 127.0.0.1:${plan.remotePort}\n  Actions        ${actions.join('; ')}\n${plan.runInstaller ? `  Installer      ${plan.installUrl} (${plan.installVersion})\n` : ''}${plan.blocker ? `\nBlocked: ${plan.blocker}\n` : '\nNothing has changed yet.\n'}\n`
}

export async function probeRemoteHost(options, dependencies = {}) {
  const runRemote = dependencies.runRemote ?? runSshCommand
  const platformRaw = await runRemote(options, 'uname -s; uname -m', dependencies)
  const [kernel = '', architecture = ''] = platformRaw.trim().split(/\r?\n/)
  const platform = normalizeRemotePlatform(kernel, architecture)
  const nodeVersion = (await runRemote(options, 'command -v node >/dev/null 2>&1 && node --version || true', dependencies)).trim() || null
  const hasCurl = (await runRemote(options, 'command -v curl >/dev/null 2>&1 && printf yes || true', dependencies)).trim() === 'yes'
  let sourceCheckoutPresent = null
  let sourceArtifactsReady = null
  let runtimeBuildToolsMissing = []
  if (options.appDir) {
    sourceCheckoutPresent = (await runRemote(options, buildRemoteCheckoutProbeCommand(options.appDir), dependencies)).trim() === 'present'
    if (sourceCheckoutPresent) {
      sourceArtifactsReady = (await runRemote(options, buildRemoteArtifactsProbeCommand(options.appDir), dependencies)).trim() === 'ready'
    }
    if (sourceCheckoutPresent && !sourceArtifactsReady) {
      runtimeBuildToolsMissing = (await runRemote(options, buildRemoteBuildToolsProbeCommand(), dependencies))
        .trim()
        .split(/\r?\n/)
        .filter((value) => ['git', 'python3', 'make', 'cxx'].includes(value))
    }
  }
  const cliPath = normalizeRemoteCliPath((await runRemote(options, 'command -v openalice 2>/dev/null || { [ ! -x "$HOME/.openalice/bin/openalice" ] || printf "%s\\n" "$HOME/.openalice/bin/openalice"; }', dependencies)).trim())
  if (!cliPath) {
    return { platform, nodeVersion, hasCurl, sourceCheckoutPresent, sourceArtifactsReady, runtimeBuildToolsMissing, cliPath: null, cliVersion: null, cliCompatible: false, status: null }
  }

  let cliVersion = null
  let status = null
  let cliCompatible = false
  try {
    cliVersion = (await runRemote(options, `${shellQuote(cliPath)} --version`, dependencies)).trim()
    const statusOutput = await runRemote(options, buildRemoteStatusCommand(options, cliPath), dependencies)
    status = parseRemoteStatus(statusOutput)
    cliCompatible = status.protocol === 1
  } catch {
    cliCompatible = false
  }
  return { platform, nodeVersion, hasCurl, sourceCheckoutPresent, sourceArtifactsReady, runtimeBuildToolsMissing, cliPath, cliVersion, cliCompatible, status }
}

export function buildRemoteCheckoutProbeCommand(appDir) {
  const manifest = shellQuote(`${appDir.replace(/\/$/, '')}/package.json`)
  return `test -f ${manifest} && grep -Eq '"name"[[:space:]]*:[[:space:]]*"open-alice"' ${manifest} && printf present || true`
}

export function buildRemoteArtifactsProbeCommand(appDir) {
  const root = shellQuote(appDir)
  return `root=${root}\ntest -f "$root/dist/main.js" \\\n  && test -f "$root/ui/dist/index.html" \\\n  && test -f "$root/services/uta/dist/uta.js" \\\n  && test -f "$root/services/connector/dist/connector.cjs" \\\n  && test -f "$root/packages/guardian-runtime/dist/index.js" \\\n  && test -d "$root/node_modules" \\\n  && printf ready || true`
}

export function buildRemoteBuildToolsProbeCommand() {
  return `command -v git >/dev/null 2>&1 || printf 'git\\n'\ncommand -v python3 >/dev/null 2>&1 || printf 'python3\\n'\ncommand -v make >/dev/null 2>&1 || printf 'make\\n'\n{ command -v c++ >/dev/null 2>&1 || command -v g++ >/dev/null 2>&1 || command -v clang++ >/dev/null 2>&1; } || printf 'cxx\\n'`
}

export function buildRemoteStatusCommand(options, cliPath) {
  const args = [shellQuote(cliPath), 'server', 'status', '--json']
  if (options.remoteHome) args.push('--home', shellQuote(options.remoteHome))
  return args.join(' ')
}

export function buildRemoteServerStartCommand(options, cliPath) {
  if (!options.appDir) throw new Error('--app-dir is required to start the remote Server')
  const args = [
    shellQuote(cliPath),
    'server', 'start',
    '--app-dir', shellQuote(options.appDir),
    '--port', String(options.remotePort),
    '--wait', String(Math.ceil(options.waitMs / 1_000)),
  ]
  if (options.remoteHome) args.push('--home', shellQuote(options.remoteHome))
  if (options.takeover) args.push('--takeover')
  return args.join(' ')
}

export function buildRemoteInstallCommand(installUrl, installVersion, installBaseUrl = '', withRuntimeDeps = false) {
  const url = shellQuote(installUrl)
  const version = shellQuote(installVersion)
  const installEnv = installBaseUrl ? `OPENALICE_INSTALL_BASE_URL=${shellQuote(installBaseUrl)} ` : ''
  const runtimeDepsFlag = withRuntimeDeps ? ' --with-runtime-deps' : ''
  return `set -eu\ntmp=$(mktemp "${'${TMPDIR:-/tmp}'}/openalice-install.XXXXXX")\ntrap 'rm -f "$tmp"' EXIT HUP INT TERM\ncurl -fsSL ${url} -o "$tmp"\n${installEnv}bash "$tmp" --yes --no-modify-path --version ${version}${runtimeDepsFlag}`
}

export function buildRemoteSshArgs(options, remoteCommand) {
  const args = [
    '-T',
    '-o', 'ServerAliveInterval=30',
    '-o', 'ServerAliveCountMax=3',
  ]
  if (options.sshPort !== null) args.push('-p', String(options.sshPort))
  if (options.identityFile !== null) args.push('-i', options.identityFile)
  args.push(options.destination, remoteCommand)
  return args
}

export function runSshCommand(options, remoteCommand, dependencies = {}) {
  const spawnProcess = dependencies.spawnProcess ?? spawn
  const child = spawnProcess('ssh', buildRemoteSshArgs(options, remoteCommand), {
    stdio: ['inherit', 'pipe', 'inherit'],
    windowsHide: true,
  })
  child.stdout.setEncoding('utf8')
  let stdout = ''
  return new Promise((resolvePromise, rejectPromise) => {
    let settled = false
    const finish = (error, value) => {
      if (settled) return
      settled = true
      if (error) rejectPromise(error)
      else resolvePromise(value)
    }
    child.stdout.on('data', (chunk) => {
      if (settled) return
      stdout += chunk
      if (Buffer.byteLength(stdout, 'utf8') > MAX_SSH_OUTPUT_BYTES) {
        child.kill('SIGTERM')
        finish(new Error('Remote SSH command produced too much output'))
      }
    })
    child.once('error', (error) => finish(error))
    child.once('exit', (code, signal) => {
      if (code === 0) finish(null, stdout)
      else finish(new Error(`Remote SSH command failed (code=${String(code)}, signal=${String(signal)})`))
    })
  })
}

export async function confirmRemotePlan(message, dependencies = {}) {
  const input = dependencies.stdin ?? process.stdin
  const output = dependencies.stdout ?? process.stdout
  if (!input.isTTY || !output.isTTY) {
    throw new Error('No interactive terminal is available. Review with --plan, then re-run with --yes to approve the remote plan.')
  }
  const readline = createInterface({ input, output })
  try {
    const answer = (await readline.question(`${message} [y/N] `)).trim().toLowerCase()
    return answer === 'y' || answer === 'yes'
  } finally {
    readline.close()
  }
}

export function formatRemoteHelp() {
  return `Usage:
  openalice remote <user@host> [options]

Plans and, after explicit consent, prepares a source-backed OpenAlice Server on
the SSH host. It then opens the normal loopback browser tunnel. Disconnecting
closes only the tunnel; the remote Server keeps running.

Options:
  --app-dir <path>        Absolute OpenAlice checkout path on the remote host
  --home <path>           Absolute remote OPENALICE_HOME (default: ~/.openalice)
  --local-port <port|auto> Local tunnel port (default: auto)
  --remote-port <port>    Remote OpenAlice web port (default: 47331)
  --ssh-port <port>       SSH server port
  --identity <path>       Local SSH identity file
  --wait <seconds>        Server/tunnel readiness timeout, 1-600 (default: 120)
  --plan                  Print the read-only plan and exit
  -y, --yes               Approve install/update/start actions non-interactively
  --takeover              Explicitly replace the recorded remote Guardian owner
  --no-open               Print the local URL without opening a browser
  -h, --help              Show this help

--yes never implies --takeover. Stage 2 supports Linux and macOS SSH hosts.
`
}

function parseRemoteStatus(output) {
  const line = output.trim().split(/\r?\n/).filter(Boolean).at(-1)
  const status = JSON.parse(line ?? '')
  if (!status || typeof status !== 'object' || typeof status.class !== 'string') {
    throw new Error('Remote openalice server status returned an invalid payload')
  }
  return status
}

function normalizeRemotePlatform(kernel, architecture) {
  const os = kernel === 'Linux' ? 'linux' : kernel === 'Darwin' ? 'darwin' : 'unsupported'
  return { os, architecture, label: `${kernel || 'unknown'} ${architecture || 'unknown'}` }
}

function normalizeRemoteCliPath(path) {
  if (!path) return null
  if (!path.startsWith('/') || /[\u0000-\u001f\u007f]/.test(path)) {
    throw new Error('Remote openalice command resolved to an unsupported path')
  }
  return path
}

function nodeVersionSupported(version) {
  const match = /^v?(\d+)(?:\.|$)/.exec(version)
  return match !== null && Number(match[1]) >= 20
}

function remoteRuntimePort(status) {
  if (status?.class !== 'running' || status?.owner?.surface !== 'cli-server') return null
  try {
    const endpoint = new URL(status.endpoints?.web)
    if (endpoint.protocol !== 'http:' || endpoint.hostname !== '127.0.0.1' || !endpoint.port) return null
    return parsePort(endpoint.port, 'remote Runtime web endpoint')
  } catch {
    return null
  }
}

function remainingMutationsAfterInstall(plan) {
  return plan.mutations.filter((mutation) => (
    !/^(install|update) remote OpenAlice CLI$/.test(mutation)
    && mutation !== 'install source Runtime build tools'
  ))
}

function validateSshDestination(destination) {
  if (!destination || /\s|[\u0000-\u001f\u007f]/.test(destination) || destination.startsWith('-')) {
    throw new Error('SSH destination contains unsupported characters')
  }
}

function requireAbsoluteRemotePath(path, flag) {
  if (!path.startsWith('/') || /[\u0000-\u001f\u007f]/.test(path)) {
    throw new Error(`${flag} must be an absolute path on the remote Linux or macOS host`)
  }
  return path
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`
}

function requireValue(argv, index, flag) {
  const value = argv[index]
  if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value`)
  return value
}

function parsePort(raw, flag, options = {}) {
  if (options.allowAuto && raw === 'auto') return 0
  const value = Number(raw)
  if (!Number.isInteger(value) || value < 1 || value > 65_535) {
    throw new Error(`${flag} must be an integer between 1 and 65535${options.allowAuto ? ', or auto' : ''}`)
  }
  return value
}
