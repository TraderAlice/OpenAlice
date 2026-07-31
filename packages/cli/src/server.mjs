import { parseLocalStartArgs } from './local-start.mjs'
import {
  inspectRuntime,
  startRuntime,
  stopRuntime,
} from './lifecycle.mjs'
import { formatRuntimeStatus } from './server-control.mjs'

export function parseServerArgs(action, argv) {
  if (action === 'run' || action === 'start') {
    const { argv: startArgv, value: logFile } = takeValueOption(argv, '--log')
    const options = parseLocalStartArgs(startArgv)
    return { ...options, openBrowser: false, logFile }
  }
  if (action !== 'status' && action !== 'stop') {
    throw new Error(`Unknown server command: ${String(action)}`)
  }

  const options = {
    homeRoot: null,
    json: false,
    port: 47331,
    waitMs: action === 'stop' ? 15_000 : 2_000,
  }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--') continue
    if (arg === '--json') {
      options.json = true
      continue
    }
    if (arg === '--home') {
      options.homeRoot = requireValue(argv, ++index, arg)
      continue
    }
    if (arg === '--port') {
      options.port = parsePort(requireValue(argv, ++index, arg), arg)
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
    throw new Error(arg?.startsWith('-') ? `Unknown option: ${arg}` : `Unexpected argument: ${arg}`)
  }
  return options
}

export async function runServerCommand(action, options, dependencies = {}) {
  if (action === 'run') return startRuntimeServer(options, { ...dependencies, detached: false })
  if (action === 'start') return startRuntimeServer(options, { ...dependencies, detached: true })
  if (action === 'status') return showServerStatus(options, dependencies)
  if (action === 'stop') return stopServer(options, dependencies)
  throw new Error(`Unknown server command: ${String(action)}`)
}

export async function startRuntimeServer(options, dependencies = {}) {
  const stdout = dependencies.stdout ?? process.stdout
  const detached = dependencies.detached === true
  const result = await (dependencies.startRuntime ?? startRuntime)(options, {
    ...dependencies,
    detached,
    progressOutput: stdout,
    emit: (event) => {
      if (event.type !== 'ready') return
      const ready = event.result
      stdout.write(`OpenAlice ${ready.status.provider?.kind === 'bundle' ? 'Runtime' : 'source'}: ${ready.appDir}\n`)
      stdout.write(`OpenAlice home: ${ready.homeRoot}\n`)
      stdout.write(`OpenAlice Server: ${ready.status.endpoints.web}\n`)
      if (detached) {
        stdout.write(`OpenAlice Server log: ${ready.logPath}\n`)
        stdout.write('The Server will keep running after this command exits. Use "openalice server stop" to stop it.\n')
      } else {
        stdout.write('The Server stays active until this command exits. Press Ctrl+C to stop it.\n')
      }
    },
  })
  if (result.outcome === 'already-running') {
    stdout.write(`OpenAlice Server is already running at ${result.status.endpoints.web ?? `http://127.0.0.1:${options.port}`}\n`)
  }
  return result.exitCode ?? 0
}

export async function showServerStatus(options, dependencies = {}) {
  const stdout = dependencies.stdout ?? process.stdout
  const status = await (dependencies.inspectRuntime ?? inspectRuntime)(options, dependencies)
  stdout.write(options.json ? `${JSON.stringify(status)}\n` : formatRuntimeStatus(status))
  return 0
}

export async function stopServer(options, dependencies = {}) {
  const stdout = dependencies.stdout ?? process.stdout
  const result = await (dependencies.stopRuntime ?? stopRuntime)(options, dependencies)
  if (options.json) {
    stdout.write(`${JSON.stringify({ stopped: result.stopped, status: result.status })}\n`)
  } else if (result.stopped) {
    stdout.write(`OpenAlice Server stopped (${result.status.home})\n`)
  } else {
    stdout.write(`OpenAlice Server is not running (${result.status.home})\n`)
  }
  return 0
}

export function formatServerHelp() {
  return `Usage:
  openalice server run [path] [options]
  openalice server start [path] [options]
  openalice server status [options]
  openalice server stop [options]

Compatibility surface for the persistent Runtime lifecycle. Prefer the
top-level "openalice run|up|status|down" commands in new scripts.

"run" owns the Runtime in the foreground; "start" detaches after Guardian and
Alice are ready.

Run/start options:
  --app-dir <path>   Advanced source override (default: installed Runtime)
  --home <path>      User-state root (default: OPENALICE_HOME or ~/.openalice)
  --port <port>      Local web port (default: 47331)
  --log <path>       Detached Server log (default: <home>/logs/server.log)
  --rebuild          Reinstall dependencies and rebuild server artifacts
  --skip-prepare     Fail instead of installing/building missing artifacts
  --takeover         Replace the recorded Guardian owner tree
  --wait <seconds>   Readiness timeout, 1-600 (default: 120)

Status/stop options:
  --home <path>      User-state root (default: OPENALICE_HOME or ~/.openalice)
  --wait <seconds>   Control timeout (status: 2, stop: 15)
  --json             Print the legacy machine-readable payload
  -h, --help         Show this help
`
}

function takeValueOption(argv, flag) {
  const output = []
  let value = null
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] !== flag) {
      output.push(argv[index])
      continue
    }
    if (value !== null) throw new Error(`${flag} may only be provided once`)
    value = requireValue(argv, ++index, flag)
  }
  return { argv: output, value }
}

function requireValue(argv, index, flag) {
  const value = argv[index]
  if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value`)
  return value
}

function parsePort(raw, flag) {
  const value = Number(raw)
  if (!Number.isInteger(value) || value < 1 || value > 65_535) {
    throw new Error(`${flag} must be an integer between 1 and 65535`)
  }
  return value
}
