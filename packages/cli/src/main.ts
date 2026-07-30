import { main as runLegacyCommand } from '../bin/openalice.mjs'
import { runSupervisorTui } from './supervisor-tui.ts'

export interface CliDependencies {
  runTui?: typeof runSupervisorTui
}

export async function main(
  argv: string[] = process.argv.slice(2),
  dependencies: CliDependencies = {},
): Promise<number> {
  const [command, ...args] = argv
  if (command === 'tui') {
    if (args.includes('--help') || args.includes('-h')) {
      process.stdout.write(`Usage:
  openalice tui

Open the local OpenAlice Supervisor TUI. Detaching never stops the Runtime.
`)
      return 0
    }
    if (args.length > 0) {
      throw usageError(`Unknown tui option: ${args[0]}`)
    }
    return (dependencies.runTui ?? runSupervisorTui)()
  }
  if (command === undefined) {
    return (dependencies.runTui ?? runSupervisorTui)()
  }
  return runLegacyCommand(argv)
}

function usageError(message: string): Error & { code: string; exitCode: number } {
  return Object.assign(new Error(message), {
    code: 'EUSAGE',
    exitCode: 2,
  })
}
