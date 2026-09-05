import { main as runLegacyCommand } from '../bin/openalice.mjs'
import { isBunStandalone } from './bun-standalone.mjs'
import { runDependencySetup } from './dependency-setup.mjs'
import {
  parseTuiLaunchArgs,
  type TuiLaunchFlags,
} from './launch-context.ts'
import { runSupervisorTui } from './supervisor-tui.ts'

export interface CliDependencies {
  standalone?: boolean
  runSetup?: (args: string[]) => Promise<number>
  runCommand?: (args: string[]) => Promise<number>
  runTui?: (
    flags?: TuiLaunchFlags,
  ) => Promise<number>
}

export async function main(
  argv: string[] = process.argv.slice(2),
  dependencies: CliDependencies = {},
): Promise<number> {
  const [command, ...args] = argv
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
  if (command === undefined) {
    await setup()
    return (dependencies.runTui ?? runSupervisorTui)({})
  }
  if (command.startsWith('-') && !['--help', '-h', '--version'].includes(command)) {
    const flags = parseTuiLaunchArgs(argv)
    await setup()
    return (dependencies.runTui ?? runSupervisorTui)(flags)
  }
  if (['up', 'run', 'start'].includes(command) && !args.includes('--help') && !args.includes('-h')) {
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
