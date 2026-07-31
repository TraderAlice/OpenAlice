import { diagnoseRuntime } from './doctor.mjs'
import {
  buildManagedPiEnv,
} from './launch-context.ts'
import { readRuntimeLogs } from './logs.mjs'
import { resolveStoredLaunchContext } from './supervisor-config.ts'

export function parseObservabilityArgs(action, argv) {
  if (!['logs', 'doctor'].includes(action)) throw usageError(`Unknown observability command: ${String(action)}`)
  const options = {
    instance: null,
    homeRoot: null,
    json: false,
    waitMs: 2_000,
    ...(action === 'logs' ? { lines: 200 } : {}),
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
    if (arg === '--instance') {
      options.instance = requireValue(argv, ++index, arg)
      continue
    }
    if (arg === '--wait' && action === 'doctor') {
      options.waitMs = parseWait(requireValue(argv, ++index, arg))
      continue
    }
    if (arg === '--lines' && action === 'logs') {
      options.lines = parseLines(requireValue(argv, ++index, arg))
      continue
    }
    throw usageError(arg?.startsWith('-') ? `Unknown option: ${arg}` : `Unexpected argument: ${arg}`)
  }
  return options
}

export async function runObservabilityCommand(action, options, dependencies = {}) {
  const stdout = dependencies.stdout ?? process.stdout
  const stderr = dependencies.stderr ?? process.stderr
  try {
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
    })
    const resolvedOptions = {
      ...options,
      homeRoot: context.home,
    }
    const runtimeDependencies = {
      ...dependencies,
      env: buildManagedPiEnv(context, dependencies.env ?? process.env),
    }
    if (action === 'logs') {
      const logs = await (dependencies.readLogs ?? readRuntimeLogs)(
        resolvedOptions,
        runtimeDependencies,
      )
      if (options.json) writeJson(stdout, successEnvelope(action, { logs }))
      else stdout.write(formatRuntimeLogs(logs))
      return 0
    }
    if (action === 'doctor') {
      const doctor = await (dependencies.diagnose ?? diagnoseRuntime)(
        resolvedOptions,
        runtimeDependencies,
      )
      if (options.json) writeJson(stdout, successEnvelope(action, { doctor }))
      else stdout.write(formatDoctor(doctor))
      return doctor.summary.failures > 0 ? 1 : 0
    }
    throw usageError(`Unknown observability command: ${String(action)}`)
  } catch (error) {
    if (options.json) {
      writeJson(stderr, errorEnvelope(action, error))
      return Number.isInteger(error?.exitCode) ? error.exitCode : 1
    }
    throw error
  }
}

export function formatObservabilityHelp(action) {
  if (action === 'logs') {
    return `Usage:
  openalice logs [options]

Prints a bounded, redacted tail of the selected Runtime log. Only regular
server.log rotation files inside the selected OpenAlice home are read.

Options:
  --instance <name>  Select a named complete-home instance
  --home <path>      User-state root (default: OPENALICE_HOME or ~/.openalice)
  --lines <count>    Last 1-5000 lines (default: 200)
  --json             Print a versioned machine-readable result
  -h, --help         Show this help
`
  }
  if (action === 'doctor') {
    return `Usage:
  openalice doctor [options]

Runs read-only checks for CLI provenance, Node.js, Runtime ownership and
compatibility, Web readiness, components, provider artifacts, update metadata,
and safe log discovery.

Options:
  --instance <name>  Select a named complete-home instance
  --home <path>      User-state root (default: OPENALICE_HOME or ~/.openalice)
  --wait <seconds>   Control timeout, 1-600 (default: 2)
  --json             Print a versioned machine-readable result
  -h, --help         Show this help
`
  }
  throw usageError(`Unknown observability command: ${String(action)}`)
}

function formatRuntimeLogs(logs) {
  if (logs.entries.length === 0) {
    return `No OpenAlice Runtime log entries found under ${logs.home}/logs.\n`
  }
  const lines = [
    `OpenAlice Runtime logs (${logs.entries.length} lines from ${logs.files.length} file${logs.files.length === 1 ? '' : 's'}):`,
  ]
  lines.push(...logs.entries.map((entry) => entry.text))
  if (logs.truncated) lines.push('[log output bounded; use --lines to adjust the tail]')
  return `${lines.join('\n')}\n`
}

function formatDoctor(doctor) {
  const lines = [
    `OpenAlice Doctor: ${doctor.overall}`,
    `Passed ${doctor.summary.passed}; warnings ${doctor.summary.warnings}; failures ${doctor.summary.failures}`,
    '',
  ]
  for (const check of doctor.checks) {
    lines.push(`[${check.status.toUpperCase()}] ${check.summary}`)
    if (check.detail) lines.push(`       ${check.detail}`)
  }
  return `${lines.join('\n')}\n`
}

function successEnvelope(command, result) {
  return {
    schemaVersion: 1,
    command,
    ok: true,
    result,
  }
}

function errorEnvelope(command, error) {
  return {
    schemaVersion: 1,
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

function parseLines(raw) {
  const lines = Number(raw)
  if (!Number.isInteger(lines) || lines < 1 || lines > 5_000) {
    throw usageError('--lines must be an integer between 1 and 5000')
  }
  return lines
}

function usageError(message) {
  const error = new Error(message)
  error.code = 'EUSAGE'
  error.exitCode = 2
  return error
}
