#!/usr/bin/env node

import { realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import {
  CLI_VERSION,
  installedContentIdentity,
  readInstallSource,
} from '../src/install-source.mjs'
import {
  formatLifecycleHelp,
  formatRootHelp,
  formatShellCompletion,
  parseLifecycleArgs,
  runLifecycleCommand,
} from '../src/lifecycle-command.mjs'
import { formatLocalStartHelp, parseLocalStartArgs, startLocal } from '../src/local-start.mjs'
import {
  formatObservabilityHelp,
  parseObservabilityArgs,
  runObservabilityCommand,
} from '../src/observability-command.mjs'
import { connectRemote, formatRemoteHelp, parseRemoteArgs } from '../src/remote.mjs'
import { formatRollbackHelp, runRollbackCommand } from '../src/rollback.mjs'
import { formatServerHelp, parseServerArgs, runServerCommand } from '../src/server.mjs'
import { connectSsh, formatSshHelp, parseSshConnectArgs } from '../src/ssh-connect.mjs'
import { formatUninstallHelp, runUninstallCommand } from '../src/uninstall.mjs'
import { formatUpdateHelp, maybeNotifyUpdate, runUpdateCommand } from '../src/update.mjs'
import {
  formatCreateAliceProjectHelp,
  runCreateAliceProjectCommand,
} from '../src/create-alice-project.ts'
import {
  formatProjectHelp,
  runProjectCommand,
} from '../src/project-command.ts'
import {
  formatMachineHelp,
  runMachineCommand,
} from '../src/machine-command.ts'

export async function main(argv = process.argv.slice(2)) {
  const [command, ...args] = argv
  if (command === '--help' || command === '-h' || command === 'help') {
    process.stdout.write(formatRootHelp())
    return 0
  }
  if (command === 'version' && args[0] === '--json') {
    const version = readVersion()
    process.stdout.write(`${JSON.stringify({
      version,
      installSource: await readInstallSource(),
      contentIdentity: installedContentIdentity(),
      managedRuntime: installedRuntimeInfo(version),
      runtimeCapabilities: ['railway-flock-v1', 'railway-runtime-lock-v2'],
    })}\n`)
    return 0
  }
  if (command === '--version' || command === '-v' || command === 'version') {
    process.stdout.write(`${readVersion()}\n`)
    return 0
  }
  if (!command || command === 'start' || command.startsWith('-')) {
    const startArgs = command === 'start' ? args : argv
    if (startArgs.includes('--help') || startArgs.includes('-h')) {
      process.stdout.write(formatLocalStartHelp())
      return 0
    }
    const options = parseLocalStartArgs(startArgs)
    await maybeNotifyUpdate({ enabled: options.checkUpdates })
    return startLocal(options)
  }
  if (['up', 'run', 'down', 'status', 'open'].includes(command)) {
    if (args.includes('--help') || args.includes('-h')) {
      process.stdout.write(formatLifecycleHelp(command))
      return 0
    }
    const options = parseLifecycleArgs(command, args)
    if ((command === 'up' || command === 'run') && options.checkUpdates && !options.json) {
      await maybeNotifyUpdate({ enabled: true })
    }
    return runLifecycleCommand(command, options)
  }
  if (command === 'logs' || command === 'doctor') {
    if (args.includes('--help') || args.includes('-h')) {
      process.stdout.write(formatObservabilityHelp(command))
      return 0
    }
    return runObservabilityCommand(command, parseObservabilityArgs(command, args))
  }
  if (command === 'completion') {
    if (args.includes('--help') || args.includes('-h') || args.length === 0) {
      process.stdout.write(`Usage:
  openalice completion <bash|zsh|fish|powershell>

Prints a completion script to stdout without modifying shell configuration.
`)
      return args.length === 0 ? 2 : 0
    }
    if (args.length !== 1) {
      const error = new Error('completion expects exactly one shell name')
      error.code = 'EUSAGE'
      error.exitCode = 2
      throw error
    }
    process.stdout.write(formatShellCompletion(args[0]))
    return 0
  }
  if (command === 'ssh') {
    if (args.includes('--help') || args.includes('-h')) {
      process.stdout.write(formatSshHelp())
      return 0
    }
    return connectSsh(parseSshConnectArgs(args))
  }
  if (command === 'server') {
    const [action, ...serverArgs] = args
    if (!action || action === 'help' || action === '--help' || action === '-h' || serverArgs.includes('--help') || serverArgs.includes('-h')) {
      process.stdout.write(formatServerHelp())
      return 0
    }
    return runServerCommand(action, parseServerArgs(action, serverArgs))
  }
  if (command === 'remote') {
    if (args.includes('--help') || args.includes('-h')) {
      process.stdout.write(formatRemoteHelp())
      return 0
    }
    return connectRemote(parseRemoteArgs(args))
  }
  if (command === 'update') {
    if (args.includes('--help') || args.includes('-h')) {
      process.stdout.write(formatUpdateHelp())
      return 0
    }
    return runUpdateCommand(args)
  }
  if (command === 'rollback') {
    if (args.includes('--help') || args.includes('-h')) {
      process.stdout.write(formatRollbackHelp())
      return 0
    }
    return runRollbackCommand(args)
  }
  if (command === 'uninstall') {
    if (args.includes('--help') || args.includes('-h')) {
      process.stdout.write(formatUninstallHelp())
      return 0
    }
    return runUninstallCommand(args)
  }
  if (command === 'create') {
    const [subject, ...createArgs] = args
    if (!subject || subject === '--help' || subject === '-h' || createArgs.includes('--help') || createArgs.includes('-h')) {
      process.stdout.write(formatCreateAliceProjectHelp())
      return !subject || subject === '--help' || subject === '-h' ? 2 : 0
    }
    if (subject !== 'alice-project') {
      const error = new Error(`Unknown create target: ${subject}\n\n${formatCreateAliceProjectHelp()}`)
      error.code = 'EUSAGE'
      error.exitCode = 2
      throw error
    }
    return runCreateAliceProjectCommand(createArgs)
  }
  if (command === 'project') {
    if (args.includes('--help') || args.includes('-h')) {
      process.stdout.write(formatProjectHelp())
      return 0
    }
    return runProjectCommand(args)
  }
  if (command === 'machine') {
    if (args.includes('--help') || args.includes('-h')) {
      process.stdout.write(formatMachineHelp())
      return 0
    }
    return runMachineCommand(args)
  }
  const error = new Error(`Unknown command: ${command}\n\n${formatRootHelp()}`)
  error.code = 'EUSAGE'
  error.exitCode = 2
  throw error
}

function installedRuntimeInfo(productVersion) {
  const nativePath = process.env['OPENALICE_RELEASE_DIR']?.trim()
  const nativeContentIdentity = process.env['OPENALICE_CONTENT_IDENTITY']?.trim()
  if (nativePath && /^[a-f0-9]{16}$/.test(nativeContentIdentity ?? '')) {
    return {
      productVersion,
      platform: process.platform,
      arch: process.arch,
      path: nativePath,
      contentIdentity: nativeContentIdentity,
    }
  }
  const path = process.env['OPENALICE_MANAGED_RUNTIME_PATH']?.trim()
  const contentIdentity = process.env[
    'OPENALICE_MANAGED_RUNTIME_CONTENT_IDENTITY'
  ]?.trim()
  if (!path || !contentIdentity) return null
  return {
    productVersion,
    platform: process.platform,
    arch: process.arch,
    path,
    contentIdentity,
  }
}

function readVersion() {
  return CLI_VERSION
}

if (
  globalThis.__OPENALICE_BUILD_VERSION__ === undefined
  && process.argv[1]
  && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().then(
    (code) => { process.exitCode = code },
    (error) => {
      process.stderr.write(`openalice: ${error instanceof Error ? error.message : String(error)}\n`)
      process.exitCode = Number.isInteger(error?.exitCode) ? error.exitCode : 1
    },
  )
}
