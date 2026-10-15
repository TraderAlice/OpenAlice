import { resolveStartupTarget } from './startup-target.ts'
import { runMachineTarget } from './machine-target-command.mjs'
import { runProjectCli } from './project-cli.ts'
import { main as runLegacyCommand } from '../bin/openalice.mjs'
import { isBunStandalone } from './bun-standalone.mjs'
import { runDependencySetup } from './dependency-setup.mjs'
import {
  parseTuiLaunchArgs,
  type TuiLaunchFlags,
} from './launch-context.ts'
import { runSupervisorTui } from './supervisor-tui.ts'
import { runWebRelay } from './web-relay.ts'

export interface CliDependencies {
  standalone?: boolean
  runSetup?: (args: string[]) => Promise<number>
  runCommand?: (args: string[]) => Promise<number>
  runTui?: (
    flags?: TuiLaunchFlags,
  ) => Promise<number>
  runRelay?: (args: string[]) => Promise<number>
}

export async function main(
  argv: string[] = process.argv.slice(2),
  dependencies: CliDependencies = {},
): Promise<number> {
  const [command, ...args] = argv
  if (command === 'exec') return runProjectCli(args)
  if (command === 'relay') return (dependencies.runRelay ?? runWebRelay)(args)
  if (command === 'start') {
    throw usageError('"openalice start" is retired. Run "openalice" for the TUI and relay GUI, or "openalice run" for a foreground Runtime without a GUI.')
  }
  if (command === 'open') {
    throw usageError('"openalice open" is retired. Run "openalice" for the TUI and relay GUI, or "openalice relay" for a GUI without the TUI.')
  }
  const setup = async () => {
    if (!(dependencies.standalone ?? isBunStandalone())) return 0
    return (dependencies.runSetup ?? ((setupArgs: string[]) => runDependencySetup(setupArgs, { quietReady: true })))(args.includes('--json') ? ['--json'] : [])
  }
  if (command === 'tui') {
    if (args.includes('--help') || args.includes('-h')) {
      process.stdout.write(`Usage:
  openalice tui [options]

Open the local OpenAlice Supervisor TUI. Detaching never stops the Runtime.

Options:
  --project <key>    Select an AliceProject
  --instance <key>   Deprecated alias for --project
  --home <path>      Override the selected complete home
  --port <port>      Runtime Web port for a start/restart
  --app-dir <path>   Source Runtime checkout
  --no-update-check  Disable background update discovery
  --update-check     Enable background update discovery
`)
      return 0
    }
    const flags = parseTuiLaunchArgs(args)
    // Setup is offered here, but the TUI also manages remote Runtimes.
    // Only local process startup requires local Git/Bash to be ready.
    await setup()
    return (dependencies.runTui ?? runSupervisorTui)(flags)
  }
  if (command === '--machine' && args[0] && args[1]?.startsWith('--') && !['--help', '-h'].includes(args[1])) {
    const flags = parseTuiLaunchArgs(argv)
    if (!flags.project) throw usageError('--machine requires --project for startup.')
    return (dependencies.runTui ?? runSupervisorTui)(flags)
  }
  if (command === '--remote' || command === '--machine') {
    return (dependencies.runCommand ?? runLegacyCommand)(argv)
  }
  if (command === undefined) {
    await setup()
    return (dependencies.runTui ?? runSupervisorTui)({})
  }
  if (command.startsWith('-') && !['--help', '-h', '--version'].includes(command)) {
    const flags = parseTuiLaunchArgs(argv)
    await setup()
    return (dependencies.runTui ?? runSupervisorTui)(flags)
  }
  if (!dependencies.runCommand && ['up', 'run', 'down', 'status', 'logs', 'doctor'].includes(command) && !args.some(arg => ['--project', '--instance', '--home', '--help', '-h'].includes(arg)) && !process.env.OPENALICE_HOME && !process.env.OPENALICE_PROJECT && !process.env.OPENALICE_INSTANCE) {
    const { target } = await resolveStartupTarget()
    if (!target) throw usageError('Choose a Default AliceProject or pass --project/--home.')
    if (target.machine !== 'local') return runMachineTarget(target.machine, [command, ...args, '--project', target.project])
  }
  const startsLocalRuntime = ['up', 'run'].includes(command)
    || (command === 'server' && ['start', 'run'].includes(args[0] ?? ''))
  if (startsLocalRuntime && !args.includes('--help') && !args.includes('-h')) {
    const setupCode = await setup()
    if (setupCode !== 0) return setupCode
  }
  return (dependencies.runCommand ?? runLegacyCommand)(argv)
}

function usageError(message: string): Error & { code: string; exitCode: number } {
  return Object.assign(new Error(message), {
    code: 'EUSAGE',
    exitCode: 2,
  })
}
