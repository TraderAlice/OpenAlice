import { parseLocalStartArgs } from './local-start.mjs'
import {
  buildManagedPiEnv,
} from './launch-context.ts'
import { resolveStoredLaunchContext } from './supervisor-config.ts'
import {
  inspectRuntime,
  lifecycleError,
  openRuntime,
  startRuntime,
  stopRuntime,
} from './lifecycle.mjs'

export const LIFECYCLE_JSON_SCHEMA_VERSION = 1

export const ROOT_COMMANDS = Object.freeze([
  { name: 'version', description: 'Print the OpenAlice product and install version' },
  { name: 'tui', description: 'Open the local Supervisor TUI' },
  { name: 'up', description: 'Start a persistent local Runtime in the background' },
  { name: 'run', description: 'Run a local Runtime in the foreground' },
  { name: 'down', description: 'Stop the persistent local Runtime' },
  { name: 'status', description: 'Inspect the selected local Runtime' },
  { name: 'logs', description: 'Read a bounded redacted Runtime log tail' },
  { name: 'doctor', description: 'Run read-only Runtime diagnostics' },
  { name: 'open', description: 'Open the verified local Web UI' },
  { name: 'start', description: 'Compatibility foreground browser launcher' },
  { name: 'server', description: 'Compatibility Server lifecycle commands' },
  { name: 'ssh', description: 'Open a tunnel to an existing remote Runtime' },
  { name: 'remote', description: 'Plan, prepare, and connect to a remote Runtime' },
  { name: 'update', description: 'Check for or install a stable OpenAlice update' },
  { name: 'uninstall', description: 'Remove installer-owned CLI files and preserve data' },
  { name: 'completion', description: 'Generate shell completion' },
])

const LIFECYCLE_OPTIONS = Object.freeze({
  up: [
    '--instance', '--app-dir', '--home', '--port', '--log', '--wait', '--rebuild',
    '--skip-prepare', '--takeover', '--open', '--no-open', '--no-update-check', '--json',
  ],
  run: [
    '--instance', '--app-dir', '--home', '--port', '--wait', '--rebuild',
    '--skip-prepare', '--takeover', '--no-update-check',
  ],
  down: ['--instance', '--home', '--wait', '--json'],
  status: ['--instance', '--home', '--wait', '--json'],
  logs: ['--instance', '--home', '--lines', '--json'],
  doctor: ['--instance', '--home', '--wait', '--json'],
  open: ['--instance', '--home', '--wait'],
})

export function parseLifecycleArgs(action, argv) {
  if (action === 'up' || action === 'run') return parseStartArgs(action, argv)
  if (!['down', 'status', 'open'].includes(action)) {
    throw usageError(`Unknown lifecycle command: ${String(action)}`)
  }

  const options = {
    instance: null,
    homeRoot: null,
    json: false,
    waitMs: action === 'down' ? 15_000 : 2_000,
  }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--') continue
    if (arg === '--json') {
      if (action === 'open') throw usageError('openalice open does not support --json')
      options.json = true
      continue
    }
    if (arg === '--home') {
      options.homeRoot = requireValue(argv, ++index, arg)
      continue
    }
    if (arg === '--instance') {
      options.instance = requireValue(argv, ++index, arg)
      continue
    }
    if (arg === '--wait') {
      options.waitMs = parseWait(requireValue(argv, ++index, arg))
      continue
    }
    throw usageError(arg?.startsWith('-') ? `Unknown option: ${arg}` : `Unexpected argument: ${arg}`)
  }
  return options
}

export async function runLifecycleCommand(action, options, dependencies = {}) {
  const stdout = dependencies.stdout ?? process.stdout
  const stderr = dependencies.stderr ?? process.stderr
  try {
    const startAction = action === 'up' || action === 'run'
    const context = await (
      dependencies.resolveContext
      ?? ((flags) => resolveStoredLaunchContext(flags, {
        env: dependencies.env,
        cwd: dependencies.cwd,
        homeDir: dependencies.homeDir,
        platform: dependencies.platform,
        readConfig: dependencies.readSupervisorConfig,
        checkStoredHome: dependencies.checkStoredHome,
      }))
    )({
      instance: options.instance ?? undefined,
      home: options.homeRoot ?? undefined,
      ...(startAction && options._appDirSpecified
        ? { appDir: options.appDir ?? undefined }
        : {}),
      ...(startAction && options._portSpecified
        ? { port: options.port }
        : {}),
      ...(startAction && options._updateChecksSpecified
        ? { updateChecks: options.checkUpdates }
        : {}),
    })
    const {
      _appDirSpecified,
      _portSpecified,
      _updateChecksSpecified,
      ...publicOptions
    } = options
    const resolvedOptions = {
      ...publicOptions,
      homeRoot: context.home,
      ...(startAction
        ? {
            appDir: _appDirSpecified
              ? options.appDir
              : context.appDir,
            port: _portSpecified
              ? options.port
              : runtimeStartPort(context),
            checkUpdates: _updateChecksSpecified
              ? options.checkUpdates
              : context.updateChecks,
            runtimeProvider: context.runtimeProvider,
          }
        : {}),
    }
    const runtimeDependencies = {
      ...dependencies,
      env: buildManagedPiEnv(context, dependencies.env ?? process.env),
    }
    if (action === 'up' || action === 'run') {
      const humanOutput = !options.json
      const result = await (dependencies.startRuntime ?? startRuntime)(resolvedOptions, {
        ...runtimeDependencies,
        detached: action === 'up',
        progressOutput: humanOutput ? stdout : undefined,
        emit: humanOutput
          ? (event) => {
              if (event.type === 'ready') stdout.write(formatStartedRuntime(event.result))
            }
          : undefined,
      })
      let opened = null
      if (action === 'up' && options.openBrowser) {
        opened = await (dependencies.openRuntime ?? openRuntime)({
          homeRoot: result.homeRoot,
          waitMs: options.waitMs,
        }, runtimeDependencies)
      }
      if (options.json) {
        writeJson(stdout, successEnvelope(action, {
          runtime: result,
          ...(opened ? { opened: { url: opened.url } } : {}),
        }))
      } else if (result.outcome === 'already-running') {
        stdout.write(formatExistingRuntime(result.status))
      }
      if (!options.json && opened) stdout.write(`Opened OpenAlice Web UI: ${opened.url}\n`)
      return action === 'run' ? result.exitCode ?? 0 : 0
    }

    if (action === 'status') {
      const status = await (dependencies.inspectRuntime ?? inspectRuntime)(
        resolvedOptions,
        runtimeDependencies,
      )
      if (options.json) writeJson(stdout, successEnvelope(action, { status }))
      else stdout.write(formatLifecycleStatus(status))
      return 0
    }

    if (action === 'down') {
      const result = await (dependencies.stopRuntime ?? stopRuntime)(
        resolvedOptions,
        runtimeDependencies,
      )
      if (options.json) writeJson(stdout, successEnvelope(action, result))
      else if (result.stopped) stdout.write(`OpenAlice Runtime stopped (${result.status.home})\n`)
      else stdout.write(`OpenAlice Runtime is not running (${result.status.home})\n`)
      return 0
    }

    if (action === 'open') {
      const result = await (dependencies.openRuntime ?? openRuntime)(
        resolvedOptions,
        runtimeDependencies,
      )
      stdout.write(`Opened OpenAlice Web UI: ${result.url}\n`)
      return 0
    }

    throw usageError(`Unknown lifecycle command: ${String(action)}`)
  } catch (error) {
    if (options.json) {
      writeJson(stderr, errorEnvelope(action, error))
      return Number.isInteger(error?.exitCode) ? error.exitCode : 1
    }
    throw error
  }
}

export function formatLifecycleHelp(action) {
  if (action === 'up') {
    return `Usage:
  openalice up [path] [options]

Starts the installed OpenAlice Runtime in the background, waits for Guardian
control and Alice HTTP readiness, then returns. The Runtime survives this shell.
A source checkout is used only when selected by configuration or --app-dir.

Options:
  --instance <name>  Select a named complete-home instance
  --app-dir <path>   Advanced: override the installed Runtime with a source checkout
  --home <path>      User-state root (default: OPENALICE_HOME or ~/.openalice)
  --port <port>      Pin the local Web port (default: automatic from 47331)
  --log <path>       Runtime log (default: <home>/logs/server.log)
  --rebuild          Reinstall dependencies and rebuild server artifacts
  --skip-prepare     Fail instead of installing/building missing artifacts
  --takeover         Replace the recorded Guardian owner tree
  --wait <seconds>   Readiness timeout, 1-600 (default: 120)
  --open             Open the verified Web UI after readiness
  --no-update-check  Skip the bounded stable-release update check
  --json             Print a versioned machine-readable result
  -h, --help         Show this help
`
  }
  if (action === 'run') {
    return `Usage:
  openalice run [path] [options]

Runs the installed OpenAlice Runtime in the foreground without opening a
browser. Ctrl+C stops the self-owned Guardian process tree.

Options:
  --instance <name>  Select a named complete-home instance
  --app-dir <path>   Advanced: override the installed Runtime with a source checkout
  --home <path>      User-state root (default: OPENALICE_HOME or ~/.openalice)
  --port <port>      Pin the local Web port (default: automatic from 47331)
  --rebuild          Reinstall dependencies and rebuild server artifacts
  --skip-prepare     Fail instead of installing/building missing artifacts
  --takeover         Replace the recorded Guardian owner tree
  --wait <seconds>   Readiness timeout, 1-600 (default: 120)
  --no-update-check  Skip the bounded stable-release update check
  -h, --help         Show this help
`
  }
  if (action === 'status') {
    return formatControlHelp('status', 'Inspects the selected local OpenAlice Runtime.', 2, true)
  }
  if (action === 'down') {
    return formatControlHelp('down', 'Asks the self-owned Guardian to stop and waits for release.', 15, true)
  }
  if (action === 'open') {
    return formatControlHelp('open', 'Opens an already-running, verified local OpenAlice Web UI.', 2, false)
  }
  throw usageError(`Unknown lifecycle command: ${String(action)}`)
}

export function formatRootHelp() {
  const commands = ROOT_COMMANDS
    .map(({ name, description }) => `  ${name.padEnd(12)}${description}`)
    .join('\n')
  return `OpenAlice CLI

Usage:
  openalice
  openalice <command> [options]

Commands:
${commands}

The default without a command opens the Supervisor TUI. Use "openalice run"
for a foreground Runtime or "openalice up" for a persistent background Runtime.

Run "openalice <command> --help" for command details.
`
}

export function formatShellCompletion(shell) {
  const commandNames = ROOT_COMMANDS.map(({ name }) => name)
  const commandWords = commandNames.join(' ')
  if (shell === 'bash') {
    return `_openalice_completion() {
  local current command
  current="\${COMP_WORDS[COMP_CWORD]}"
  command="\${COMP_WORDS[1]}"
  if [[ "$COMP_CWORD" -eq 1 ]]; then
    COMPREPLY=( $(compgen -W "${commandWords}" -- "$current") )
    return
  fi
  case "$command" in
${bashCompletionCases()}
  esac
}
complete -F _openalice_completion openalice
`
  }
  if (shell === 'zsh') {
    return `#compdef openalice
local -a commands
commands=(
${ROOT_COMMANDS.map(({ name, description }) => `  '${name}:${description.replaceAll("'", "'\\''")}'`).join('\n')}
)
if (( CURRENT == 2 )); then
  _describe 'command' commands
  return
fi
case "$words[2]" in
${zshCompletionCases()}
esac
`
  }
  if (shell === 'fish') {
    return `${ROOT_COMMANDS
      .map(({ name, description }) => `complete -c openalice -n '__fish_use_subcommand' -a ${shellQuote(name)} -d ${shellQuote(description)}`)
      .join('\n')}
${fishCompletionOptions()}
`
  }
  if (shell === 'powershell') {
    const entries = ROOT_COMMANDS
      .map(({ name, description }) => `@{ Name = '${powershellQuote(name)}'; Description = '${powershellQuote(description)}' }`)
      .join(',\n      ')
    return `Register-ArgumentCompleter -Native -CommandName openalice -ScriptBlock {
  param($wordToComplete, $commandAst, $cursorPosition)
  $commands = @(
      ${entries}
  )
  if ($commandAst.CommandElements.Count -le 2) {
    $commands |
      Where-Object { $_.Name -like "$wordToComplete*" } |
      ForEach-Object {
        [System.Management.Automation.CompletionResult]::new(
          $_.Name, $_.Name, 'ParameterValue', $_.Description
        )
      }
  }
}
`
  }
  throw usageError(`Unsupported shell: ${String(shell)}. Expected bash, zsh, fish, or powershell.`)
}

function parseStartArgs(action, argv) {
  let instance = null
  let json = false
  let openRequested = false
  let noOpenRequested = false
  let logFile = null
  let portSpecified = false
  let updateChecksSpecified = false
  const startArgv = []
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--instance') {
      if (instance !== null) throw usageError('--instance may only be provided once')
      instance = requireValue(argv, ++index, arg)
      continue
    }
    if (arg === '--json') {
      if (action === 'run') throw usageError('openalice run does not support --json')
      json = true
      continue
    }
    if (arg === '--open') {
      if (action === 'run') throw usageError('openalice run does not support --open')
      openRequested = true
      continue
    }
    if (arg === '--no-open') noOpenRequested = true
    if (arg === '--port') portSpecified = true
    if (arg === '--no-update-check') updateChecksSpecified = true
    if (arg === '--log') {
      if (action === 'run') throw usageError('openalice run does not support --log')
      if (logFile !== null) throw usageError('--log may only be provided once')
      logFile = requireValue(argv, ++index, arg)
      continue
    }
    startArgv.push(arg)
  }
  if (openRequested && noOpenRequested) throw usageError('Use only one of --open or --no-open')
  let parsed
  try {
    parsed = parseLocalStartArgs(startArgv)
  } catch (error) {
    throw usageError(error instanceof Error ? error.message : String(error))
  }
  return {
    ...parsed,
    _appDirSpecified: parsed.appDir !== null,
    _portSpecified: portSpecified,
    _updateChecksSpecified: updateChecksSpecified,
    instance,
    openBrowser: action === 'up' && openRequested,
    json,
    logFile,
  }
}

function runtimeStartPort(context) {
  return context.provenance.port.source === 'default'
    ? undefined
    : context.port
}

function formatStartedRuntime(result) {
  const lines = [
    `OpenAlice source: ${result.appDir}`,
    `OpenAlice home: ${result.homeRoot}`,
    `OpenAlice Runtime: ${result.status.endpoints.web}`,
  ]
  if (result.logPath) {
    lines.push(`OpenAlice Runtime log: ${result.logPath}`)
    lines.push('The Runtime will keep running after this command exits. Use "openalice down" to stop it.')
  } else {
    lines.push('The Runtime stays active until this command exits. Press Ctrl+C to stop it.')
  }
  return `${lines.join('\n')}\n`
}

function formatExistingRuntime(status) {
  const lines = [`OpenAlice Runtime is already running at ${status.endpoints.web ?? 'an unknown endpoint'}`]
  lines.push(`Home: ${status.home}`)
  if (status.owner) lines.push(`Owner: ${status.owner.surface} (pid ${status.owner.pid})`)
  return `${lines.join('\n')}\n`
}

function formatLifecycleStatus(status) {
  const lines = [`OpenAlice Runtime: ${status.class}`, `Home: ${status.home}`]
  if (status.productVersion || status.runtimeVersion) {
    lines.push(`Version: ${status.productVersion ?? status.runtimeVersion}`)
  }
  if (status.owner) lines.push(`Owner: ${status.owner.surface} (pid ${status.owner.pid})`)
  if (status.endpoints?.web) lines.push(`Web: ${status.endpoints.web}`)
  if (status.provider?.kind) {
    const identity = status.provider.contentIdentity ? ` (${status.provider.contentIdentity})` : ''
    lines.push(`Provider: ${status.provider.kind}${identity}`)
  }
  if (Number.isInteger(status.uptimeSeconds)) lines.push(`Uptime: ${formatUptime(status.uptimeSeconds)}`)
  for (const name of ['alice', 'uta', 'connector']) {
    if (status.components?.[name]) lines.push(`${displayComponent(name)}: ${status.components[name]}`)
  }
  if (status.pendingActivation?.productVersion) {
    lines.push(`Pending activation: ${status.pendingActivation.productVersion}${status.pendingActivation.restartRequired ? ' (restart required)' : ''}`)
  }
  if (status.owner?.launchRoot) lines.push(`Runtime source: ${status.owner.launchRoot}`)
  if (status.detail) lines.push(`Detail: ${status.detail}`)
  return `${lines.join('\n')}\n`
}

function formatUptime(seconds) {
  const days = Math.floor(seconds / 86_400)
  const hours = Math.floor((seconds % 86_400) / 3_600)
  const minutes = Math.floor((seconds % 3_600) / 60)
  if (days > 0) return `${days}d ${hours}h`
  if (hours > 0) return `${hours}h ${minutes}m`
  if (minutes > 0) return `${minutes}m`
  return `${seconds}s`
}

function displayComponent(name) {
  if (name === 'alice') return 'Alice'
  if (name === 'uta') return 'UTA'
  return 'Connector'
}

function successEnvelope(command, result) {
  return {
    schemaVersion: LIFECYCLE_JSON_SCHEMA_VERSION,
    command,
    ok: true,
    result,
  }
}

function errorEnvelope(command, error) {
  return {
    schemaVersion: LIFECYCLE_JSON_SCHEMA_VERSION,
    command,
    ok: false,
    error: {
      code: typeof error?.code === 'string' ? error.code : 'EOPENALICE',
      message: error instanceof Error ? error.message : String(error),
    },
  }
}

function writeJson(output, value) {
  output.write(`${JSON.stringify(value)}\n`)
}

function usageError(message) {
  return lifecycleError('EUSAGE', message, 2)
}

function requireValue(argv, index, flag) {
  const value = argv[index]
  if (!value || value.startsWith('--')) throw usageError(`${flag} requires a value`)
  return value
}

function parseWait(raw) {
  const seconds = Number(raw)
  if (!Number.isFinite(seconds) || seconds < 1 || seconds > 600) {
    throw usageError('--wait must be a number of seconds between 1 and 600')
  }
  return Math.round(seconds * 1_000)
}

function formatControlHelp(action, description, defaultWaitSeconds, json) {
  return `Usage:
  openalice ${action} [options]

${description}

Options:
  --instance <name>  Select a named complete-home instance
  --home <path>      User-state root (default: OPENALICE_HOME or ~/.openalice)
  --wait <seconds>   Control timeout, 1-600 (default: ${defaultWaitSeconds})
${json ? '  --json             Print a versioned machine-readable result\n' : ''}  -h, --help         Show this help
`
}

function bashCompletionCases() {
  return Object.entries(LIFECYCLE_OPTIONS)
    .map(([command, options]) => `    ${command}) COMPREPLY=( $(compgen -W "${options.join(' ')}" -- "$current") ) ;;`)
    .join('\n')
}

function zshCompletionCases() {
  return Object.entries(LIFECYCLE_OPTIONS)
    .map(([command, options]) => `  ${command}) _values 'option' ${options.map(shellQuote).join(' ')} ;;`)
    .join('\n')
}

function fishCompletionOptions() {
  return Object.entries(LIFECYCLE_OPTIONS)
    .flatMap(([command, options]) => options.map((option) => {
      const name = option.slice(2)
      return `complete -c openalice -n '__fish_seen_subcommand_from ${command}' -l ${name}`
    }))
    .join('\n')
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`
}

function powershellQuote(value) {
  return String(value).replaceAll("'", "''")
}
