import { parseLocalStartArgs } from './local-start.mjs'
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
  { name: 'up', description: 'Start a persistent local Runtime in the background' },
  { name: 'run', description: 'Run a local Runtime in the foreground' },
  { name: 'down', description: 'Stop the persistent local Runtime' },
  { name: 'status', description: 'Inspect the selected local Runtime' },
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
    '--app-dir', '--home', '--port', '--log', '--wait', '--rebuild',
    '--skip-prepare', '--takeover', '--open', '--no-open', '--no-update-check', '--json',
  ],
  run: [
    '--app-dir', '--home', '--port', '--wait', '--rebuild',
    '--skip-prepare', '--takeover', '--no-update-check',
  ],
  down: ['--home', '--wait', '--json'],
  status: ['--home', '--wait', '--json'],
  open: ['--home', '--wait'],
})

export function parseLifecycleArgs(action, argv) {
  if (action === 'up' || action === 'run') return parseStartArgs(action, argv)
  if (!['down', 'status', 'open'].includes(action)) {
    throw usageError(`Unknown lifecycle command: ${String(action)}`)
  }

  const options = {
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
    if (action === 'up' || action === 'run') {
      const humanOutput = !options.json
      const result = await (dependencies.startRuntime ?? startRuntime)(options, {
        ...dependencies,
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
        }, dependencies)
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
      const status = await (dependencies.inspectRuntime ?? inspectRuntime)(options, dependencies)
      if (options.json) writeJson(stdout, successEnvelope(action, { status }))
      else stdout.write(formatLifecycleStatus(status))
      return 0
    }

    if (action === 'down') {
      const result = await (dependencies.stopRuntime ?? stopRuntime)(options, dependencies)
      if (options.json) writeJson(stdout, successEnvelope(action, result))
      else if (result.stopped) stdout.write(`OpenAlice Runtime stopped (${result.status.home})\n`)
      else stdout.write(`OpenAlice Runtime is not running (${result.status.home})\n`)
      return 0
    }

    if (action === 'open') {
      const result = await (dependencies.openRuntime ?? openRuntime)(options, dependencies)
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

Starts a persistent background Runtime from an OpenAlice source checkout, waits
for Guardian control and Alice HTTP readiness, then returns. The Runtime
survives this shell.

Options:
  --app-dir <path>   OpenAlice checkout (default: current directory or parent)
  --home <path>      User-state root (default: OPENALICE_HOME or ~/.openalice)
  --port <port>      Local Web port (default: 47331)
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

Runs a source-backed OpenAlice Runtime in the foreground without opening a
browser. Ctrl+C stops the self-owned Guardian process tree.

Options:
  --app-dir <path>   OpenAlice checkout (default: current directory or parent)
  --home <path>      User-state root (default: OPENALICE_HOME or ~/.openalice)
  --port <port>      Local Web port (default: 47331)
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

The current default without a command remains the compatibility foreground
browser launcher. Use "openalice up" for a persistent background Runtime.

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
  let json = false
  let openRequested = false
  let noOpenRequested = false
  let logFile = null
  const startArgv = []
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
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
    openBrowser: action === 'up' && openRequested,
    json,
    logFile,
  }
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
  if (status.runtimeVersion) lines.push(`Version: ${status.runtimeVersion}`)
  if (status.owner) lines.push(`Owner: ${status.owner.surface} (pid ${status.owner.pid})`)
  if (status.endpoints?.web) lines.push(`Web: ${status.endpoints.web}`)
  for (const name of ['alice', 'uta', 'connector']) {
    if (status.components?.[name]) lines.push(`${displayComponent(name)}: ${status.components[name]}`)
  }
  if (status.owner?.launchRoot) lines.push(`Runtime source: ${status.owner.launchRoot}`)
  if (status.detail) lines.push(`Detail: ${status.detail}`)
  return `${lines.join('\n')}\n`
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
