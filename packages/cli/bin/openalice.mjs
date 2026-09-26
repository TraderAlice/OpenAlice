#!/usr/bin/env node

import { realpathSync } from 'node:fs'
import { runDependencySetup } from '../src/dependency-setup.mjs'
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
import {
  formatObservabilityHelp,
  parseObservabilityArgs,
  runObservabilityCommand,
} from '../src/observability-command.mjs'
import { connectRemote, formatRemoteHelp, parseRemoteArgs } from '../src/remote.mjs'
import { formatMachineTargetHelp, runMachineTarget } from '../src/machine-target-command.mjs'
import { formatRollbackHelp, runRollbackCommand } from '../src/rollback.mjs'
import { formatServerHelp, parseServerArgs, runServerCommand } from '../src/server.mjs'
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
  if (command === 'setup') return runDependencySetup(args)
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
    })}\n`)
    return 0
  }
  if (command === '--version' || command === '-v' || command === 'version') {
    process.stdout.write(`${readVersion()}\n`)
    return 0
  }
  if (command === '--remote') {
    if (args.includes('--help') || args.includes('-h')) {
      process.stdout.write(formatRemoteHelp())
      return 0
    }
    const options = parseRemoteArgs(args)
    if (options.mode === 'connect' && !options.planOnly) {
      throw usageError('Direct SSH browser attach is retired. Run "openalice machine add <user@host> --label <name>" to probe and register the Machine, then run "openalice" and choose its AliceProject in the GUI.')
    }
    return connectRemote(options)
  }
  if (command === '--machine') {
    const [selector, ...commandArgs] = args
    if (!selector || selector === '--help' || selector === '-h' || commandArgs.includes('--help') && commandArgs.length === 1) {
      process.stdout.write(formatMachineTargetHelp())
      return selector ? 0 : 2
    }
    return runMachineTarget(selector, commandArgs, {
      runLocal: async (localArgs) => (await import('../src/main.ts')).main(localArgs),
    })
  }
  if (command === 'start') {
    throw usageError('"openalice start" is retired. Run "openalice" for the TUI and relay GUI, or "openalice run" for a foreground Runtime without a GUI.')
  }
  if (!command || command.startsWith('-')) {
    return (await import('../src/main.ts')).main(argv)
  }
  if (command === 'open') {
    throw usageError('"openalice open" is retired. Run "openalice" for the TUI and relay GUI, or "openalice relay" for a GUI without the TUI.')
  }
  if (['up', 'run', 'down', 'status'].includes(command)) {
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
  if (command === 'server') {
    const [action, ...serverArgs] = args
    if (!action || action === 'help' || action === '--help' || action === '-h' || serverArgs.includes('--help') || serverArgs.includes('-h')) {
      process.stdout.write(formatServerHelp())
      return 0
    }
    return runServerCommand(action, parseServerArgs(action, serverArgs))
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

function usageError(message) {
  return Object.assign(new Error(message), { code: 'EUSAGE', exitCode: 2 })
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
