import { main as runLegacyCommand } from '../bin/openalice.mjs'
import {
  parseTuiLaunchArgs,
  type TuiLaunchFlags,
} from './launch-context.ts'
import { runSupervisorTui } from './supervisor-tui.ts'

export interface CliDependencies {
  runTui?: (
    flags?: TuiLaunchFlags,
  ) => Promise<number>
}

export async function main(
  argv: string[] = process.argv.slice(2),
  dependencies: CliDependencies = {},
): Promise<number> {
  const [command, ...args] = argv
  if (command === 'tui') {
    if (args.includes('--help') || args.includes('-h')) {
      process.stdout.write(`Usage:
  openalice tui [options]

Open the local OpenAlice Supervisor TUI. Detaching never stops the Runtime.

Options:
  --instance <name>  Select a named complete-home instance
  --home <path>      Override the selected complete home
  --port <port>      Runtime Web port for a start/restart
  --app-dir <path>   Source Runtime checkout
  --no-update-check  Disable background update discovery
  --update-check     Enable background update discovery
`)
      return 0
    }
    return (dependencies.runTui ?? runSupervisorTui)(parseTuiLaunchArgs(args))
  }
  if (command === undefined) {
    return (dependencies.runTui ?? runSupervisorTui)({})
  }
  if (command.startsWith('-') && !['--help', '-h', '--version'].includes(command)) {
    return (dependencies.runTui ?? runSupervisorTui)(parseTuiLaunchArgs(argv))
  }
  return runLegacyCommand(argv)
}

function usageError(message: string): Error & { code: string; exitCode: number } {
  return Object.assign(new Error(message), {
    code: 'EUSAGE',
    exitCode: 2,
  })
}
