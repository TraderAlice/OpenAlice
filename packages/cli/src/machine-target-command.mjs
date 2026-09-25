import { readMachineRegistrySummary, findRegisteredMachine, machineIsEnabled } from './machine-registry.ts'
import { spawn } from 'node:child_process'
import { buildRemoteSshArgs } from './remote.mjs'

/**
 * Herdr's --machine mode is a target selector in front of the ordinary
 * command dispatcher. OpenAlice keeps that shape while using its existing
 * SSH transport until the shared remote API exists.
 */
export async function runMachineTarget(selector, commandArgs, dependencies = {}) {
  if (!selector) throw usageError('A Machine id or label is required after --machine')
  if (!Array.isArray(commandArgs) || commandArgs.length === 0) {
    throw usageError(formatMachineTargetHelp())
  }
  if (commandArgs[0] === '--remote' || commandArgs[0] === '--machine') {
    throw usageError('Target selectors cannot be nested')
  }

  if (selector === 'local') {
    const runLocal = dependencies.runLocal
    if (!runLocal) throw usageError('The local Machine target is unavailable in this invocation')
    return runLocal(commandArgs)
  }

  const summary = await (dependencies.loadMachines
    ?? (() => readMachineRegistrySummary(dependencies)))()
  const machine = findRegisteredMachine(summary, selector)
  if (!machine) throw usageError(`Machine "${selector}" is not registered.`)
  if (!machineIsEnabled(machine)) {
    throw usageError(`Machine "${selector}" is disabled. Enable it before using --machine.`)
  }

  const remoteCommand = buildRemoteCommand(commandArgs)
  const runRemote = dependencies.runRemote ?? runTargetCommand
  return runRemote({
    destination: machine.sshTarget,
    sshPort: machine.sshPort ?? null,
    identityFile: machine.identityFile ?? null,
  }, remoteCommand, dependencies)
}

/** User commands stream directly and run once: disconnect is not retry authority. */
export async function runTargetCommand(options, command, dependencies = {}) {
  const child = (dependencies.spawnProcess ?? spawn)('ssh', buildRemoteSshArgs(options, command), {
    stdio: 'inherit',
    windowsHide: true,
  })
  return new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (signal) reject(new Error(`Remote command interrupted by ${signal}`))
      else resolve(code ?? 1)
    })
  })
}

export function formatMachineTargetHelp() {
  return `Usage:
  openalice --machine <id-or-label> <command> [options]

Run an ordinary OpenAlice CLI command against a saved remote Machine.
The remote CLI is selected by its normal PATH or ~/.openalice installation.
Output streams directly and the remote exit code is preserved. Commands are
never retried automatically. Interactive TUI use requires a terminal on the
remote host; use --remote for the browser tunnel. "local" uses the full local
dispatcher. Pass --project or --home to commands that support those options.
`
}

export function buildRemoteCommand(commandArgs) {
  return [
    'set -eu',
    'cli=$(command -v openalice 2>/dev/null || true)',
    '[ -n "$cli" ] || { [ -x "$HOME/.openalice/bin/openalice" ] || { printf \'%s\\n\' \'OpenAlice CLI is not installed\' >&2; exit 127; }; cli="$HOME/.openalice/bin/openalice"; }',
    `exec "$cli" ${commandArgs.map(shellQuote).join(' ')}`,
  ].join('\n')
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`
}

function usageError(message) {
  return Object.assign(new Error(message), { code: 'EUSAGE', exitCode: 2 })
}
