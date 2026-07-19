import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, posix } from 'node:path'
import { createInterface } from 'node:readline/promises'

import {
  DEFAULT_INSTALL_SOURCE,
  formatInstallSelector,
  installedContentIdentity,
  installSourcesMatch,
  parseInstallSource,
  readInstallSource,
  requireInstallSource,
} from './install-source.mjs'
import { formatMissingRuntimeBuildTools } from './runtime-deps.mjs'
import { connectSsh } from './ssh-connect.mjs'

const MINIMUM_NODE_VERSION = '22.19.0'
const MANAGED_PI_VERSION = '0.80.6'
const MAX_SSH_OUTPUT_BYTES = 1024 * 1024
const REMOTE_STATE_VERSION = 1
const MAX_REMEMBERED_TARGETS = 32
const DEFAULT_REPOSITORY_URL = 'https://github.com/TraderAlice/OpenAlice.git'
const TRANSIENT_SSH_PATTERNS = [
  /can't verify your ssh key right now/i,
  /temporary service issue/i,
  /connection (?:reset|timed out|closed)/i,
  /kex_exchange_identification/i,
  /ssh_exchange_identification/i,
  /operation timed out/i,
]

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
    mode: 'connect',
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
    if (arg === '--status' || arg === '--stop') {
      const mode = arg.slice(2)
      if (options.mode !== 'connect' && options.mode !== mode) {
        throw new Error('--status and --stop cannot be used together')
      }
      options.mode = mode
      continue
    }
    if (arg?.startsWith('-')) throw new Error(`Unknown option: ${arg}`)
    if (options.destination) throw new Error(`Unexpected argument: ${arg}`)
    validateSshDestination(arg)
    options.destination = arg
  }
  if (!options.destination) throw new Error('Remote SSH destination is required (for example: user@example.com)')
  if (options.mode !== 'connect' && (options.planOnly || options.takeover)) {
    throw new Error(`--${options.mode} cannot be combined with --plan or --takeover`)
  }
  return options
}

export async function connectRemote(options, dependencies = {}) {
  const stdout = dependencies.stdout ?? process.stdout
  const env = dependencies.env ?? process.env
  const localInstall = await resolveLocalInstallIdentity(dependencies, env)
  const repositoryUrl = dependencies.repositoryUrl ?? env['OPENALICE_REMOTE_TEST_REPOSITORY_URL'] ?? DEFAULT_REPOSITORY_URL
  const rememberedLocalPort = options.localPort === 0
    ? await readRememberedRemotePort(options, { ...dependencies, env })
    : null
  const connectionOptions = {
    ...options,
    ...(rememberedLocalPort === null ? {} : { preferredLocalPort: rememberedLocalPort }),
    managedSourceKey: managedSourceKey(localInstall.installSource),
    managedInstallSource: localInstall.installSource,
    repositoryUrl,
  }
  const probe = dependencies.probeRemote ?? probeRemoteHost
  let remote = await probe(connectionOptions, dependencies)
  if (options.mode === 'status') {
    stdout.write(formatManagedRemoteStatus(options.destination, remote))
    return remote.status?.class === 'running' ? 0 : 1
  }
  if (options.mode === 'stop') {
    return stopManagedRemote(connectionOptions, remote, { ...dependencies, probe, stdout })
  }
  let plan = createRemotePlan(connectionOptions, remote, {
    installSource: localInstall.installSource,
    contentIdentity: localInstall.contentIdentity,
    installBaseUrl: dependencies.installBaseUrl ?? env['OPENALICE_REMOTE_TEST_INSTALL_BASE_URL'] ?? '',
    repositoryUrl,
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
      ? 'Preparing OpenAlice, managed Pi, and source Runtime build tools'
      : 'Installing OpenAlice and managed Pi'
    stdout.write(`${installerPurpose} on ${options.destination} with the normal installer...\n`)
    let installerError = null
    try {
      const output = await runRemote(connectionOptions, buildRemoteInstallCommand(
        plan.installSource,
        plan.installBaseUrl,
        plan.installRuntimeDeps,
      ), dependencies)
      writeRemoteActionOutput(stdout, output)
    } catch (error) {
      installerError = error
      stdout.write('The SSH action ended unexpectedly; checking whether the remote install completed...\n')
    }
    try {
      remote = await probe(connectionOptions, dependencies)
    } catch (probeError) {
      throw installerError ?? probeError
    }
    const matchingRemoteCli = remote.cliCompatible
      && installSourcesMatch(remote.installSource, plan.installSource)
      && contentIdentitiesMatch(plan.contentIdentity, remote.cliContentIdentity)
    if (installerError && matchingRemoteCli && remote.piCompatible && (!plan.installRuntimeDeps || (remote.runtimeBuildToolsMissing ?? []).length === 0)) {
      stdout.write('The remote install completed before the disconnect; continuing from detected state.\n')
    } else if (installerError) {
      throw installerError
    }
    if (!remote.cliPath || !matchingRemoteCli) {
      throw new Error('The remote OpenAlice CLI install completed, but it does not match the invoking local CLI')
    }
    if (!remote.piCompatible) {
      throw new Error(`The remote install completed, but managed Pi ${MANAGED_PI_VERSION} was not detected`)
    }
    const refreshedPlan = createRemotePlan(connectionOptions, remote, {
      installSource: plan.installSource,
      contentIdentity: plan.contentIdentity,
      installBaseUrl: plan.installBaseUrl,
      repositoryUrl: plan.repositoryUrl,
      forceRestartForManagedPi: plan.restartServer,
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

  if (plan.cloneSource) {
    const expectedRemainingMutations = remainingMutationsAfterClone(plan)
    stdout.write(`Preparing the managed OpenAlice source on ${options.destination}...\n`)
    let cloneError = null
    try {
      const output = await runRemote(connectionOptions, buildRemoteCloneCommand(
        plan.serverAppDir,
        plan.installSource,
        plan.repositoryUrl,
      ), dependencies)
      writeRemoteActionOutput(stdout, output)
    } catch (error) {
      cloneError = error
      stdout.write('The SSH action ended unexpectedly; checking whether source preparation completed...\n')
    }
    try {
      remote = await probe(connectionOptions, dependencies)
    } catch (probeError) {
      throw cloneError ?? probeError
    }
    if (cloneError && remote.sourceCheckoutState === 'present') {
      stdout.write('The source checkout completed before the disconnect; continuing from detected state.\n')
    } else if (cloneError) {
      throw cloneError
    }
    if (remote.sourceCheckoutState !== 'present') {
      throw new Error(`OpenAlice source preparation did not create a valid checkout at ${plan.serverAppDir}`)
    }
    const refreshedPlan = createRemotePlan(connectionOptions, remote, {
      installSource: plan.installSource,
      contentIdentity: plan.contentIdentity,
      installBaseUrl: plan.installBaseUrl,
      repositoryUrl: plan.repositoryUrl,
      forceRestartForManagedPi: plan.restartServer,
    })
    const planChanged = JSON.stringify(refreshedPlan.mutations) !== JSON.stringify(expectedRemainingMutations)
    if (refreshedPlan.blocker || planChanged) {
      stdout.write('Remote facts changed after source preparation. Review the refreshed plan:\n')
      stdout.write(formatRemotePlan(refreshedPlan))
    }
    if (refreshedPlan.blocker) throw new Error(refreshedPlan.blocker)
    if (planChanged && refreshedPlan.mutations.length > 0 && !options.assumeYes) {
      const confirm = dependencies.confirmPlan ?? confirmRemotePlan
      if (!await confirm('Apply the refreshed remote plan?', dependencies)) {
        stdout.write('The remote source is ready; no additional actions were applied.\n')
        return 0
      }
    }
    plan = refreshedPlan
  }

  if (plan.restartServer) {
    stdout.write(`Restarting the remote OpenAlice Server so it inherits managed Pi ${MANAGED_PI_VERSION}...\n`)
    let stopError = null
    try {
      const output = await runRemote(connectionOptions, buildRemoteServerStopCommand(connectionOptions, remote.cliPath), dependencies)
      writeRemoteActionOutput(stdout, output)
    } catch (error) {
      stopError = error
      stdout.write('The SSH action ended unexpectedly; checking whether the remote Server stopped...\n')
    }
    try {
      remote = await probe(connectionOptions, dependencies)
    } catch (probeError) {
      throw stopError ?? probeError
    }
    if (stopError && remote.status?.class === 'absent') {
      stdout.write('The remote Server stopped before the disconnect; continuing from detected state.\n')
    } else if (stopError) {
      throw stopError
    }
    if (remote.status?.class !== 'absent') {
      throw new Error(`Remote OpenAlice Server did not stop cleanly before restart (${remote.status?.class ?? 'no status'})`)
    }
  }

  if (plan.updateSource) {
    stdout.write(`Updating the managed OpenAlice source on ${options.destination}...\n`)
    let updateError = null
    try {
      const output = await runRemote(connectionOptions, buildRemoteSourceUpdateCommand(
        plan.serverAppDir,
        plan.installSource,
        plan.repositoryUrl,
      ), dependencies)
      writeRemoteActionOutput(stdout, output)
    } catch (error) {
      updateError = error
      stdout.write('The connection ended unexpectedly; checking whether the source update completed...\n')
    }
    try {
      remote = await probe(connectionOptions, dependencies)
    } catch (probeError) {
      throw updateError ?? probeError
    }
    if (updateError && remote.sourceUpdateAvailable === false) {
      stdout.write('The managed source update completed before the disconnect; continuing from detected state.\n')
    } else if (updateError) {
      throw updateError
    }
    if (remote.sourceCheckoutState !== 'present' || remote.sourceUpdateAvailable === true) {
      throw new Error(`Managed OpenAlice source did not update cleanly at ${plan.serverAppDir}`)
    }
  }

  if (plan.startServer) {
    stdout.write(`${options.takeover ? 'Replacing' : plan.restartServer ? 'Starting the refreshed' : 'Starting'} OpenAlice Server on ${options.destination}...\n`)
    let startError = null
    try {
      const output = await runRemote(connectionOptions, buildRemoteServerStartCommand({
        ...connectionOptions,
        appDir: plan.serverAppDir,
        rebuild: plan.rebuildSource,
      }, remote.cliPath), dependencies)
      writeRemoteActionOutput(stdout, output)
    } catch (error) {
      startError = error
      stdout.write('The SSH action ended unexpectedly; checking whether the remote Server became ready...\n')
    }
    try {
      remote = await probe(connectionOptions, dependencies)
    } catch (probeError) {
      throw startError ?? probeError
    }
    if (startError && remote.status?.class === 'running' && remote.status?.owner?.surface === 'cli-server') {
      stdout.write('The remote Server became ready before the disconnect; continuing from detected state.\n')
    } else if (startError) {
      throw startError
    }
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
    preferredLocalPort: rememberedLocalPort,
    remotePort: runtimePort,
    sshPort: options.sshPort,
    identityFile: options.identityFile,
    openBrowser: options.openBrowser,
    waitMs: options.waitMs,
    onReady: async ({ localPort }) => {
      try {
        await rememberRemotePort(options, localPort, { ...dependencies, env })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        stdout.write(`OpenAlice could not remember this tunnel port (${message}).\n`)
      }
    },
  }, dependencies)
}

async function stopManagedRemote(options, initialRemote, dependencies) {
  const stdout = dependencies.stdout
  const runRemote = dependencies.runRemote ?? runSshCommand
  const probe = dependencies.probe
  if (!initialRemote.cliPath) {
    throw new Error(`No managed OpenAlice CLI was found on ${options.destination}; there is no CLI Server to stop`)
  }
  if (initialRemote.status?.class === 'absent') {
    stdout.write(`OpenAlice Server is already stopped on ${options.destination}.\n`)
    return 0
  }
  if (initialRemote.status?.class !== 'running' || initialRemote.status?.owner?.surface !== 'cli-server') {
    throw new Error(`Remote Runtime is ${initialRemote.status?.class ?? 'unknown'} and is not a controllable CLI Server`)
  }

  stdout.write(`Stopping OpenAlice Server on ${options.destination}...\n`)
  let stopError = null
  try {
    const output = await runRemote(options, buildRemoteServerStopCommand(options, initialRemote.cliPath), dependencies)
    writeRemoteActionOutput(stdout, output)
  } catch (error) {
    stopError = error
    stdout.write('The connection ended unexpectedly; checking whether the remote Server stopped...\n')
  }
  let remote
  try {
    remote = await probe(options, dependencies)
  } catch (probeError) {
    throw stopError ?? probeError
  }
  if (remote.status?.class !== 'absent') throw stopError ?? new Error(`Remote OpenAlice Server did not stop cleanly (${remote.status?.class ?? 'unknown'})`)
  if (stopError) stdout.write('The remote Server stopped before the disconnect; continuing from detected state.\n')
  stdout.write(`OpenAlice Server is stopped on ${options.destination}.\n`)
  return 0
}

function formatManagedRemoteStatus(destination, remote) {
  const status = remote.status
  const lines = [
    '',
    'OpenAlice Remote',
    '',
    `Target:  ${destination}`,
    `CLI:     ${remote.cliPath ? `${remote.cliVersion ?? 'unknown'} at ${remote.cliPath}` : 'not installed'}`,
    `Runtime: ${status?.class ?? 'unknown'}${status?.owner?.surface ? ` (${status.owner.surface})` : ''}`,
  ]
  if (status?.home) lines.push(`Home:    ${status.home}`)
  if (status?.owner?.launchRoot) lines.push(`Source:  ${status.owner.launchRoot}`)
  if (status?.endpoints?.web) lines.push(`Web:     ${status.endpoints.web}`)
  return `${lines.join('\n')}\n\n`
}

export function createRemotePlan(options, remote, install = {}) {
  const installSource = requireInstallSource(install.installSource ?? DEFAULT_INSTALL_SOURCE)
  const contentIdentity = normalizeContentIdentity(install.contentIdentity)
  const installBaseUrl = install.installBaseUrl ?? ''
  const repositoryUrl = install.repositoryUrl ?? DEFAULT_REPOSITORY_URL
  const forceRestartForManagedPi = install.forceRestartForManagedPi === true
  const mutations = []
  let blocker = ''
  let installCli = false
  let installManagedPi = false
  let installRuntimeDeps = false
  let cloneSource = false
  let updateSource = false
  let rebuildSource = false
  let startServer = false
  let restartServer = false
  let serverAppDir = options.appDir || remote.managedAppDir || ''
  let remotePort = options.remotePort

  if (!['linux', 'darwin'].includes(remote.platform?.os)) {
    blocker = `Unsupported remote platform: ${remote.platform?.label ?? 'unknown'}. Stage 2 supports Linux and macOS hosts.`
  } else if (!remote.nodeVersion) {
    blocker = `The remote host does not have Node.js ${MINIMUM_NODE_VERSION} or newer; install Node.js 22 LTS before applying this plan.`
  } else if (!nodeVersionSupported(remote.nodeVersion)) {
    blocker = `The remote host reports ${remote.nodeVersion}; OpenAlice and managed Pi require Node.js ${MINIMUM_NODE_VERSION} or newer.`
  } else if (options.appDir && remote.sourceCheckoutState === 'invalid') {
    blocker = `${options.appDir} exists but is not an OpenAlice source checkout. Choose another --app-dir or move the existing path.`
  }

  const cliMatchesLocal = remote.installSource != null
    && installSourcesMatch(remote.installSource, installSource)
    && contentIdentitiesMatch(contentIdentity, remote.cliContentIdentity)
  if (!remote.cliPath || !remote.cliCompatible || !cliMatchesLocal) {
    installCli = true
  }
  if (!remote.piCompatible) {
    installManagedPi = true
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
      if (installManagedPi || forceRestartForManagedPi) {
        serverAppDir = options.appDir || status.owner?.launchRoot || serverAppDir
        if (!serverAppDir) {
          blocker = `OpenAlice could not recover the running Server's source location for the managed Pi ${MANAGED_PI_VERSION} restart.`
        } else {
          restartServer = true
          startServer = true
          mutations.push(`restart remote OpenAlice Server with managed Pi ${MANAGED_PI_VERSION}`)
        }
      }
    }
  }
  if (!blocker && status?.class === 'owned_elsewhere') {
    if (options.takeover) {
      if (!serverAppDir) blocker = 'OpenAlice could not select a source checkout for takeover.'
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
    } else if (!serverAppDir) {
      blocker = 'OpenAlice could not select a source checkout for takeover.'
    } else {
      startServer = true
      mutations.push('replace incompatible or unhealthy Runtime with CLI Server')
    }
  } else if (!blocker && status?.class !== 'running') {
    if (!serverAppDir) blocker = 'OpenAlice could not select a managed source checkout on the remote host.'
    else {
      startServer = true
      mutations.push('start remote OpenAlice Server')
    }
  }

  if (!blocker && !options.appDir && remote.sourceCheckoutState === 'present' && remote.sourceUpdateAvailable === true) {
    if (remote.sourceDirty) {
      blocker = `${serverAppDir} has tracked local changes, so OpenAlice will not update the managed checkout. Preserve the changes with a separate checkout and pass --app-dir.`
    } else {
      updateSource = true
      rebuildSource = true
      mutations.unshift(`update managed OpenAlice source (${formatInstallSelector(installSource)})`)
      if (status?.class === 'running' && status?.owner?.surface === 'cli-server' && !restartServer) {
        restartServer = true
        startServer = true
        mutations.push('restart remote OpenAlice Server with updated source')
      }
    }
  }

  if (!blocker && startServer) {
    if (remote.sourceCheckoutState === 'invalid') {
      blocker = `${serverAppDir} exists but is not an OpenAlice source checkout. Choose another --app-dir or move the existing path.`
    } else if (remote.sourceCheckoutState === 'absent') {
      cloneSource = true
      mutations.unshift(`clone OpenAlice source (${formatInstallSelector(installSource)})`)
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
  if (installManagedPi) mutations.unshift(`install managed Pi ${MANAGED_PI_VERSION}`)
  if (installCli) mutations.unshift(remote.cliPath ? 'update remote OpenAlice CLI' : 'install remote OpenAlice CLI')
  const runInstaller = installCli || installManagedPi || installRuntimeDeps
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
    cliContentIdentity: remote.cliContentIdentity ?? null,
    cliMatchesLocal,
    piPath: remote.piPath ?? 'missing',
    piVersion: remote.piVersion ?? 'unknown',
    piCompatible: remote.piCompatible === true,
    runtimeClass: status?.class ?? 'unknown',
    runtimeOwner: status?.owner?.surface ?? 'none',
    appDir: serverAppDir || 'not selected',
    serverAppDir,
    remoteHome: options.remoteHome || '~/.openalice (remote default)',
    sourceMode: options.appDir ? 'user-selected' : 'managed',
    sourceCheckoutState: remote.sourceCheckoutState ?? null,
    remotePort,
    localPort: options.localPort || (options.preferredLocalPort ? `${options.preferredLocalPort} (remembered)` : 'auto'),
    installCli,
    installManagedPi,
    installRuntimeDeps,
    cloneSource,
    updateSource,
    rebuildSource,
    runInstaller,
    startServer,
    restartServer,
    sourceCheckoutPresent: remote.sourceCheckoutPresent ?? null,
    sourceUpdateAvailable: remote.sourceUpdateAvailable ?? null,
    sourceDirty: remote.sourceDirty ?? null,
    sourceArtifactsReady: remote.sourceArtifactsReady ?? null,
    runtimeBuildToolsMissing,
    installSource,
    contentIdentity,
    installBaseUrl,
    repositoryUrl,
    mutations,
    blocker,
  }
}

export function formatRemotePlan(plan) {
  const actions = plan.mutations.length > 0
    ? [...plan.mutations, 'open local SSH tunnel']
    : ['reuse compatible remote CLI Server', 'open local SSH tunnel']
  const buildTools = plan.sourceArtifactsReady === true
    ? 'Not needed (built artifacts present)'
    : plan.runtimeBuildToolsMissing.length > 0
      ? `Missing: ${formatMissingRuntimeBuildTools(plan.runtimeBuildToolsMissing)}`
      : plan.appDir === 'not selected'
        ? 'Not inspected'
        : 'Ready'
  const cliState = plan.cliCompatible && plan.cliMatchesLocal
    ? ', compatible and matches local CLI'
    : ', install/update required'
  const sourceState = plan.cloneSource
    ? ', will clone'
    : plan.updateSource
      ? ', update available'
      : plan.sourceCheckoutState === 'present' ? ', ready' : ''
  return `\nOpenAlice Remote\n\nRemote plan\n  Target         ${plan.target}\n  Platform       ${plan.platform}\n  Node.js        ${plan.nodeVersion}\n  CLI            ${plan.cliPath} (${plan.cliVersion}${cliState})\n  Agent          ${plan.piPath} (Pi ${plan.piVersion}${plan.piCompatible ? ', compatible' : `, install ${MANAGED_PI_VERSION} required`})\n  Runtime        ${plan.runtimeClass} (${plan.runtimeOwner})\n  Source         ${plan.appDir} (${plan.sourceMode}${sourceState})\n  Build tools    ${buildTools}\n  Home           ${plan.remoteHome}\n  Tunnel         127.0.0.1:${plan.localPort} -> remote 127.0.0.1:${plan.remotePort}\n  Actions        ${actions.join('; ')}\n${plan.runInstaller ? `  Installer      ${plan.installSource.installerUrl} (CLI ${plan.installSource.cliVersion}, ${formatInstallSelector(plan.installSource)}, selected by local CLI)\n` : ''}${plan.blocker ? `\nBlocked: ${plan.blocker}\n` : '\nNothing has changed yet.\n'}\n`
}

async function resolveLocalInstallIdentity(dependencies, env) {
  const contentIdentity = normalizeContentIdentity(dependencies.contentIdentity ?? installedContentIdentity())
  if (dependencies.installSource) {
    return { installSource: requireInstallSource(dependencies.installSource), contentIdentity }
  }
  const testUrl = env['OPENALICE_REMOTE_TEST_INSTALL_URL'] ?? ''
  const testKind = env['OPENALICE_REMOTE_TEST_INSTALL_SELECTOR_KIND'] ?? ''
  const testValue = env['OPENALICE_REMOTE_TEST_INSTALL_SELECTOR_VALUE'] ?? ''
  if (testUrl || testKind || testValue) {
    if (!testUrl || !testKind || !testValue) {
      throw new Error('The remote installer test override requires URL, selector kind, and selector value')
    }
    const testSource = parseInstallSource({
      schemaVersion: 1,
      repository: 'TraderAlice/OpenAlice',
      cliVersion: DEFAULT_INSTALL_SOURCE.cliVersion,
      selector: { kind: testKind, value: testValue },
      installerUrl: testUrl,
    })
    if (!testSource) throw new Error('The remote installer test override is invalid')
    return { installSource: testSource, contentIdentity }
  }
  return { installSource: await readInstallSource(), contentIdentity }
}

export async function probeRemoteHost(options, dependencies = {}) {
  const runRemote = dependencies.runRemote ?? runSshCommand
  if (options.mode === 'status' || options.mode === 'stop') {
    return probeRemoteControl(options, { ...dependencies, runRemote })
  }
  const platformRaw = await runRemote(options, 'uname -s; uname -m', dependencies)
  const [kernel = '', architecture = ''] = platformRaw.trim().split(/\r?\n/)
  const platform = normalizeRemotePlatform(kernel, architecture)
  const shellHome = normalizeRemoteHome((await runRemote(options, 'printf "%s\\n" "$HOME"', dependencies)).trim())
  const managedRoot = options.remoteHome || `${shellHome}/.openalice`
  const managedAppDir = `${managedRoot}/sources/${options.managedSourceKey ?? 'branch-master'}/OpenAlice`
  const sourceAppDir = options.appDir || managedAppDir
  const nodeVersion = (await runRemote(options, 'command -v node >/dev/null 2>&1 && node --version || true', dependencies)).trim() || null
  const hasCurl = (await runRemote(options, 'command -v curl >/dev/null 2>&1 && printf yes || true', dependencies)).trim() === 'yes'
  const piPath = normalizeRemoteExecutablePath((await runRemote(options, 'command -v pi 2>/dev/null || { [ ! -x "$HOME/.openalice/bin/pi" ] || printf "%s\\n" "$HOME/.openalice/bin/pi"; }', dependencies)).trim(), 'pi')
  let piVersion = null
  if (piPath) {
    try {
      piVersion = (await runRemote(options, `${shellQuote(piPath)} --version`, dependencies)).trim() || null
    } catch {
      piVersion = null
    }
  }
  const piCompatible = piVersion === MANAGED_PI_VERSION
  let sourceCheckoutState = null
  let sourceCheckoutPresent = null
  let sourceArtifactsReady = null
  let sourceUpdateAvailable = null
  let sourceDirty = null
  let runtimeBuildToolsMissing = []
  if (sourceAppDir) {
    sourceCheckoutState = (await runRemote(options, buildRemoteCheckoutProbeCommand(sourceAppDir), dependencies)).trim() || 'absent'
    sourceCheckoutPresent = sourceCheckoutState === 'present'
    if (sourceCheckoutPresent) {
      sourceArtifactsReady = (await runRemote(options, buildRemoteArtifactsProbeCommand(sourceAppDir), dependencies)).trim() === 'ready'
    }
    if (sourceCheckoutState === 'absent' || (sourceCheckoutPresent && !sourceArtifactsReady)) {
      runtimeBuildToolsMissing = (await runRemote(options, buildRemoteBuildToolsProbeCommand(), dependencies))
        .trim()
        .split(/\r?\n/)
        .filter((value) => ['git', 'python3', 'make', 'cxx'].includes(value))
    }
    if (
      sourceCheckoutPresent
      && !options.appDir
      && options.managedInstallSource?.selector?.kind === 'branch'
    ) {
      const updateProbe = await runRemote(options, buildRemoteSourceUpdateProbeCommand(
        sourceAppDir,
        options.managedInstallSource,
        options.repositoryUrl ?? DEFAULT_REPOSITORY_URL,
      ), dependencies)
      const updateFacts = parseSourceUpdateProbe(updateProbe)
      sourceUpdateAvailable = updateFacts.updateAvailable
      sourceDirty = updateFacts.dirty
    }
  }
  const cliPath = normalizeRemoteCliPath((await runRemote(options, 'command -v openalice 2>/dev/null || { [ ! -x "$HOME/.openalice/bin/openalice" ] || printf "%s\\n" "$HOME/.openalice/bin/openalice"; }', dependencies)).trim())
  if (!cliPath) {
    return { platform, shellHome, managedAppDir, nodeVersion, hasCurl, sourceCheckoutState, sourceCheckoutPresent, sourceArtifactsReady, sourceUpdateAvailable, sourceDirty, runtimeBuildToolsMissing, piPath, piVersion, piCompatible, cliPath: null, cliVersion: null, cliContentIdentity: null, installSource: null, cliCompatible: false, status: null }
  }

  let cliVersion = null
  let remoteInstallSource = null
  let cliContentIdentity = null
  let status = null
  let cliCompatible = false
  try {
    cliVersion = (await runRemote(options, `${shellQuote(cliPath)} --version`, dependencies)).trim()
    try {
      const versionInfo = parseRemoteVersionInfo(await runRemote(options, `${shellQuote(cliPath)} version --json`, dependencies))
      if (versionInfo.version === cliVersion) {
        remoteInstallSource = versionInfo.installSource
        cliContentIdentity = versionInfo.contentIdentity
      }
    } catch {
      remoteInstallSource = null
    }
    const statusOutput = await runRemote(options, buildRemoteStatusCommand(options, cliPath), dependencies)
    status = parseRemoteStatus(statusOutput)
    cliCompatible = status.protocol === 1
  } catch {
    cliCompatible = false
  }
  return { platform, shellHome, managedAppDir, nodeVersion, hasCurl, sourceCheckoutState, sourceCheckoutPresent, sourceArtifactsReady, sourceUpdateAvailable, sourceDirty, runtimeBuildToolsMissing, piPath, piVersion, piCompatible, cliPath, cliVersion, cliContentIdentity, installSource: remoteInstallSource, cliCompatible, status }
}

async function probeRemoteControl(options, dependencies) {
  const output = await dependencies.runRemote(
    options,
    buildRemoteControlProbeCommand(options),
    dependencies,
  )
  const fields = new Map(
    output
      .split(/\r?\n/)
      .map((line) => {
        const separator = line.indexOf('=')
        return separator < 0 ? null : [line.slice(0, separator), line.slice(separator + 1)]
      })
      .filter(Boolean),
  )
  const cliPath = normalizeRemoteCliPath(fields.get('cli') ?? '')
  if (!cliPath) {
    return {
      cliPath: null,
      cliVersion: null,
      cliContentIdentity: null,
      installSource: null,
      cliCompatible: false,
      status: null,
    }
  }

  const cliVersion = fields.get('version') ?? null
  const versionInfo = parseRemoteVersionInfo(fields.get('identity') ?? '')
  const status = parseRemoteStatus(fields.get('status') ?? '')
  return {
    cliPath,
    cliVersion,
    cliContentIdentity: versionInfo.version === cliVersion ? versionInfo.contentIdentity : null,
    installSource: versionInfo.version === cliVersion ? versionInfo.installSource : null,
    cliCompatible: status.protocol === 1,
    status,
  }
}

export function buildRemoteControlProbeCommand(options) {
  const statusHome = options.remoteHome ? ` --home ${shellQuote(options.remoteHome)}` : ''
  return `cli=$(command -v openalice 2>/dev/null || { [ ! -x "$HOME/.openalice/bin/openalice" ] || printf '%s\\n' "$HOME/.openalice/bin/openalice"; })
printf 'cli=%s\\n' "$cli"
if test -n "$cli"; then
  printf 'version='; "$cli" --version
  printf 'identity='; "$cli" version --json
  printf 'status='; "$cli" server status --json${statusHome}
fi`
}

export function buildRemoteCheckoutProbeCommand(appDir) {
  const root = shellQuote(appDir.replace(/\/$/, ''))
  return `root=${root}\nif test ! -e "$root" && test ! -L "$root"; then\n  printf absent\nelif test -f "$root/package.json" && grep -Eq '"name"[[:space:]]*:[[:space:]]*"open-alice"' "$root/package.json"; then\n  printf present\nelse\n  printf invalid\nfi`
}

export function buildRemoteCloneCommand(appDir, installSource, repositoryUrl = DEFAULT_REPOSITORY_URL) {
  const source = requireInstallSource(installSource)
  const root = shellQuote(appDir)
  const parent = shellQuote(posix.dirname(appDir))
  const repository = shellQuote(repositoryUrl)
  const ref = shellQuote(source.selector.value)
  const cloneArgs = source.selector.kind === 'branch'
    ? `--branch ${ref} --single-branch ${repository}`
    : repository
  const checkout = source.selector.kind === 'version'
    ? `\ngit -C "$tmp" checkout --detach ${ref}`
    : ''
  return `set -eu\nroot=${root}\nparent=${parent}\ntest ! -e "$root" && test ! -L "$root" || { printf '%s\\n' "Source path already exists: $root" >&2; exit 1; }\nmkdir -p "$parent"\ntmp="$root.openalice-clone.$$"\ntrap 'rm -rf "$tmp"' EXIT HUP INT TERM\ngit clone ${cloneArgs} "$tmp"${checkout}\nmv "$tmp" "$root"\ntrap - EXIT HUP INT TERM\nprintf 'OpenAlice source is ready at %s\\n' "$root"`
}

export function buildRemoteSourceUpdateProbeCommand(appDir, installSource, repositoryUrl = DEFAULT_REPOSITORY_URL) {
  const source = requireInstallSource(installSource)
  if (source.selector.kind !== 'branch') throw new Error('Only managed branch checkouts can be updated')
  const root = shellQuote(appDir)
  const repository = shellQuote(repositoryUrl)
  const remoteRef = shellQuote(`refs/heads/${source.selector.value}`)
  return `root=${root}\nhead=$(git -C "$root" rev-parse HEAD 2>/dev/null || true)\nupstream=$(git ls-remote ${repository} ${remoteRef} 2>/dev/null | awk 'NR == 1 { print $1; exit }')\nif test -z "$head"; then dirty=unknown\nelif test -n "$(git -C "$root" status --porcelain --untracked-files=no 2>/dev/null)"; then dirty=yes\nelse dirty=no\nfi\nprintf 'head=%s\\nupstream=%s\\ndirty=%s\\n' "$head" "$upstream" "$dirty"`
}

export function buildRemoteSourceUpdateCommand(appDir, installSource, repositoryUrl = DEFAULT_REPOSITORY_URL) {
  const source = requireInstallSource(installSource)
  if (source.selector.kind !== 'branch') throw new Error('Only managed branch checkouts can be updated')
  const root = shellQuote(appDir)
  const repository = shellQuote(repositoryUrl)
  const remoteRef = shellQuote(`refs/heads/${source.selector.value}`)
  return `set -eu\nroot=${root}\ntest -z "$(git -C "$root" status --porcelain --untracked-files=no)" || { printf '%s\\n' 'Managed source has tracked local changes; refusing update.' >&2; exit 1; }\ngit -C "$root" fetch --prune ${repository} ${remoteRef}\ngit -C "$root" merge --ff-only FETCH_HEAD\nprintf 'Managed OpenAlice source is now at %s\\n' "$(git -C "$root" rev-parse --short HEAD)"`
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
  if (options.rebuild) args.push('--rebuild')
  if (options.takeover) args.push('--takeover')
  return `OPENALICE_PREPARE_OUTPUT=compact TURBO_TELEMETRY_DISABLED=1 DO_NOT_TRACK=1 ${args.join(' ')}`
}

export function buildRemoteServerStopCommand(options, cliPath) {
  const args = [shellQuote(cliPath), 'server', 'stop', '--wait', String(Math.ceil(options.waitMs / 1_000))]
  if (options.remoteHome) args.push('--home', shellQuote(options.remoteHome))
  return args.join(' ')
}

export function buildRemoteInstallCommand(installSource, installBaseUrl = '', withRuntimeDeps = false) {
  const source = requireInstallSource(installSource)
  const url = shellQuote(source.installerUrl)
  const selectorFlag = source.selector.kind === 'branch' ? '--branch' : '--version'
  const selectorValue = shellQuote(source.selector.value)
  const installEnv = [
    `OPENALICE_INSTALL_URL=${url}`,
    'OPENALICE_INSTALL_CONTEXT=remote',
    installBaseUrl ? `OPENALICE_INSTALL_BASE_URL=${shellQuote(installBaseUrl)}` : '',
  ].filter(Boolean).join(' ')
  const runtimeDepsFlag = withRuntimeDeps ? ' --with-runtime-deps' : ''
  return `set -eu\ntmp=$(mktemp "${'${TMPDIR:-/tmp}'}/openalice-install.XXXXXX")\ntrap 'rm -f "$tmp"' EXIT HUP INT TERM\ncurl -fsSL ${url} -o "$tmp"\n${installEnv} bash "$tmp" --yes --no-modify-path ${selectorFlag} ${selectorValue}${runtimeDepsFlag}`
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

export async function runSshCommand(options, remoteCommand, dependencies = {}) {
  const sleep = dependencies.sleep ?? ((ms) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms)))
  const stdout = dependencies.stdout ?? process.stdout
  const stderrOutput = dependencies.stderr ?? process.stderr
  let lastError
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await runSshCommandOnce(options, remoteCommand, dependencies)
    } catch (error) {
      lastError = error
      if (attempt >= 3 || !isTransientSshError(error)) {
        if (error?.stderr) stderrOutput.write(error.stderr)
        throw error
      }
      const delayMs = attempt * 750
      stdout.write(`Connection interrupted; retrying (${attempt} of 2)...\n`)
      await sleep(delayMs)
    }
  }
  throw lastError
}

function runSshCommandOnce(options, remoteCommand, dependencies = {}) {
  const spawnProcess = dependencies.spawnProcess ?? spawn
  const child = spawnProcess('ssh', buildRemoteSshArgs(options, remoteCommand), {
    stdio: ['inherit', 'pipe', 'pipe'],
    windowsHide: true,
  })
  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')
  let stdout = ''
  let stderr = ''
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
    child.stderr.on('data', (chunk) => {
      if (settled) return
      stderr += chunk
      if (Buffer.byteLength(stderr, 'utf8') > MAX_SSH_OUTPUT_BYTES) {
        child.kill('SIGTERM')
        finish(createSshCommandError('Remote SSH command produced too much error output', stdout, stderr))
      }
    })
    child.once('error', (error) => finish(error))
    child.once('exit', (code, signal) => {
      if (code === 0) finish(null, stdout)
      else finish(createSshCommandError(
        `Remote SSH command failed (code=${String(code)}, signal=${String(signal)})`,
        stdout,
        stderr,
      ))
    })
  })
}

export async function readRememberedRemotePort(options, dependencies = {}) {
  const statePath = remoteStatePath(dependencies.env ?? process.env, dependencies.homeDir)
  try {
    const state = JSON.parse(await (dependencies.readFileImpl ?? readFile)(statePath, 'utf8'))
    if (state?.version !== REMOTE_STATE_VERSION || !state.targets || typeof state.targets !== 'object') return null
    const port = state.targets[remoteTargetKey(options)]?.localPort
    return Number.isInteger(port) && port >= 1 && port <= 65_535 ? port : null
  } catch {
    return null
  }
}

export async function rememberRemotePort(options, localPort, dependencies = {}) {
  if (!Number.isInteger(localPort) || localPort < 1 || localPort > 65_535) return
  const statePath = remoteStatePath(dependencies.env ?? process.env, dependencies.homeDir)
  const readFileImpl = dependencies.readFileImpl ?? readFile
  let state = { version: REMOTE_STATE_VERSION, targets: {} }
  try {
    const existing = JSON.parse(await readFileImpl(statePath, 'utf8'))
    if (existing?.version === REMOTE_STATE_VERSION && existing.targets && typeof existing.targets === 'object') {
      state = existing
    }
  } catch {
    // Missing or malformed local state should never block a remote connection.
  }
  state.targets[remoteTargetKey(options)] = { localPort, updatedAt: new Date().toISOString() }
  const entries = Object.entries(state.targets)
    .sort(([, left], [, right]) => String(right?.updatedAt ?? '').localeCompare(String(left?.updatedAt ?? '')))
    .slice(0, MAX_REMEMBERED_TARGETS)
  state.targets = Object.fromEntries(entries)
  const mkdirImpl = dependencies.mkdirImpl ?? mkdir
  const writeFileImpl = dependencies.writeFileImpl ?? writeFile
  const renameImpl = dependencies.renameImpl ?? rename
  await mkdirImpl(dirname(statePath), { recursive: true })
  const temporaryPath = `${statePath}.${process.pid}.${Date.now()}.tmp`
  await writeFileImpl(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 })
  await renameImpl(temporaryPath, statePath)
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

When --app-dir is omitted, OpenAlice selects a private managed checkout under
the remote OPENALICE_HOME and clones it when needed. Pass an absolute checkout
path to keep source ownership manual.

Options:
  --app-dir <path>        Existing or new checkout path (default: managed)
  --home <path>           Absolute remote OPENALICE_HOME (default: ~/.openalice)
  --local-port <port|auto> Local tunnel port (default: auto)
  --remote-port <port>    Remote OpenAlice web port (default: 47331)
  --ssh-port <port>       SSH server port
  --identity <path>       Local SSH identity file
  --wait <seconds>        Server/tunnel readiness timeout, 1-600 (default: 120)
  --status                Inspect the managed remote Server and exit
  --stop                  Gracefully stop the managed remote Server and exit
  --plan                  Print the read-only plan and exit
  -y, --yes               Approve install/update/start actions non-interactively
  --takeover              Explicitly replace the recorded remote Guardian owner
  --no-open               Print the local URL without opening a browser
  -h, --help              Show this help

--yes never implies --takeover. Stage 2 supports Linux and macOS SSH hosts.
Remote CLI installation always uses the invoking local CLI's recorded installer
source; this command has no independent branch or version selector.
`
}

function parseRemoteVersionInfo(output) {
  const line = output.trim().split(/\r?\n/).filter(Boolean).at(-1)
  const value = JSON.parse(line ?? '')
  const installSource = parseInstallSource(value?.installSource)
  if (typeof value?.version !== 'string' || !installSource || value.version !== installSource.cliVersion) {
    throw new Error('Remote openalice version returned an invalid payload')
  }
  return {
    version: value.version,
    installSource,
    contentIdentity: normalizeContentIdentity(value.contentIdentity),
  }
}

function parseRemoteStatus(output) {
  const line = output.trim().split(/\r?\n/).filter(Boolean).at(-1)
  const status = JSON.parse(line ?? '')
  if (!status || typeof status !== 'object' || typeof status.class !== 'string') {
    throw new Error('Remote openalice server status returned an invalid payload')
  }
  return status
}

function parseSourceUpdateProbe(output) {
  const head = /^head=([a-f0-9]{40,64})$/m.exec(output)?.[1] ?? null
  const upstream = /^upstream=([a-f0-9]{40,64})$/m.exec(output)?.[1] ?? null
  const dirtyValue = /^dirty=(yes|no|unknown)$/m.exec(output)?.[1] ?? 'unknown'
  return {
    updateAvailable: head && upstream ? head !== upstream : null,
    dirty: dirtyValue === 'yes' ? true : dirtyValue === 'no' ? false : null,
  }
}

function normalizeRemotePlatform(kernel, architecture) {
  const os = kernel === 'Linux' ? 'linux' : kernel === 'Darwin' ? 'darwin' : 'unsupported'
  return { os, architecture, label: `${kernel || 'unknown'} ${architecture || 'unknown'}` }
}

function normalizeRemoteCliPath(path) {
  return normalizeRemoteExecutablePath(path, 'openalice')
}

function normalizeRemoteExecutablePath(path, command) {
  if (!path) return null
  if (!path.startsWith('/') || /[\u0000-\u001f\u007f]/.test(path)) {
    throw new Error(`Remote ${command} command resolved to an unsupported path`)
  }
  return path
}

function normalizeRemoteHome(path) {
  if (!path || !path.startsWith('/') || /[\u0000-\u001f\u007f]/.test(path)) {
    throw new Error('Remote HOME resolved to an unsupported path')
  }
  return path.replace(/\/$/, '')
}

function nodeVersionSupported(version) {
  const match = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?/.exec(version)
  if (!match) return false
  const current = [Number(match[1]), Number(match[2] ?? 0), Number(match[3] ?? 0)]
  const minimum = MINIMUM_NODE_VERSION.split('.').map(Number)
  for (let index = 0; index < 3; index += 1) {
    if (current[index] > minimum[index]) return true
    if (current[index] < minimum[index]) return false
  }
  return true
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
    && !mutation.startsWith('install managed Pi ')
    && mutation !== 'install source Runtime build tools'
  ))
}

function remainingMutationsAfterClone(plan) {
  return plan.mutations.filter((mutation) => !mutation.startsWith('clone OpenAlice source ('))
}

function writeRemoteActionOutput(stdout, output) {
  const text = String(output ?? '').trim()
  if (text) stdout.write(`${text}\n`)
}

function createSshCommandError(message, stdout, stderr) {
  const error = new Error(message)
  error.stdout = stdout
  error.stderr = stderr
  return error
}

function isTransientSshError(error) {
  const details = [error?.message, error?.stderr].filter(Boolean).join('\n')
  return TRANSIENT_SSH_PATTERNS.some((pattern) => pattern.test(details))
}

function contentIdentitiesMatch(localIdentity, remoteIdentity) {
  return localIdentity === null || localIdentity === normalizeContentIdentity(remoteIdentity)
}

function normalizeContentIdentity(value) {
  return typeof value === 'string' && /^[a-f0-9]{16}$/.test(value) ? value : null
}

function managedSourceKey(source) {
  const normalized = requireInstallSource(source)
  const readable = `${normalized.selector.kind}-${normalized.selector.value}`
    .replaceAll(/[^A-Za-z0-9._-]+/g, '-')
    .replaceAll(/^-+|-+$/g, '')
    .slice(0, 48) || 'source'
  const digest = createHash('sha256')
    .update(`${normalized.selector.kind}:${normalized.selector.value}`)
    .digest('hex')
    .slice(0, 8)
  return `${readable}-${digest}`
}

function remoteStatePath(env, homeDir) {
  return env['OPENALICE_REMOTE_STATE_FILE']
    || join(homeDir ?? homedir(), '.openalice', 'state', 'remote-targets.json')
}

function remoteTargetKey(options) {
  return createHash('sha256')
    .update(JSON.stringify([
      options.destination,
      options.sshPort ?? 22,
      options.remoteHome || '~/.openalice',
    ]))
    .digest('hex')
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
