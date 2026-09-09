import { createInterface } from 'node:readline/promises'
import { coordinateDependencies } from './dependency-installation.mjs'
import { inspectSystemDependencies } from './system-dependencies.mjs'
import { planDependencyInstallation, executeDependencyInstallation } from './dependency-provider.mjs'

export async function runDependencySetup(args = [], io = {}) {
  const write = io.write ?? (text => process.stdout.write(text))
  if (args.includes('--help') || args.includes('-h')) {
    write('Usage: openalice setup [--check] [--json]\n\nCheck system Git/Bash and coordinate installation with your consent.\n--check and --json never install software. Existing dependencies remain system-owned.\n')
    return 0
  }
  if (args.some(arg => !['--check', '--json'].includes(arg))) throw new Error('Unknown setup option; use openalice setup --help')
  const json = args.includes('--json')
  const inspect = io.inspect ?? (() => inspectSystemDependencies())
  const interactive = !json && !args.includes('--check') && (io.interactive ?? Boolean(process.stdin.isTTY && process.stdout.isTTY))
  const confirm = io.confirm ?? (async ({ checks, actions }) => {
    write(`Missing dependencies: ${checks.map(check => check.id).join(', ')}\n`)
    for (const action of actions) write(`  ${[action.command, ...action.args].map(arg => JSON.stringify(arg)).join(' ')}\n`)
    write('These commands install system-owned software and may request administrator access.\n')
    const prompt = createInterface({ input: process.stdin, output: process.stdout })
    try { return /^(y|yes)$/i.test((await prompt.question('Install these dependencies? [y/N] ')).trim()) }
    finally { prompt.close() }
  })
  const result = await coordinateDependencies({
    inspect,
    plan: io.plan ?? (checks => planDependencyInstallation(checks)),
    confirm,
    execute: io.execute ?? executeDependencyInstallation,
    interactive,
    refresh: io.refresh,
  })
  if (result.status === 'ready' && io.quietReady) return 0
  if (json) write(`${JSON.stringify(result)}\n`)
  else {
    for (const check of result.checks) write(`${check.id}: ${check.status}${check.executable ? ` (${check.executable})` : ''}${check.detail ? ` — ${check.detail}` : ''}\n`)
    if (result.status !== 'ready') {
      write(`Dependency setup: ${result.status}.\n`)
      if (result.error) write(`Installation error: ${result.error}\n`)
      if (result.code !== undefined) write(`Installer exited with code ${result.code}.\n`)
      if (result.status === 'install-failed' || result.status === 'verification-failed' || result.status === 'declined') {
        write('OpenAlice remains installed. Run openalice setup to retry this installation step.\n')
      }
      if (!interactive && result.actions.length) {
        write('Run openalice setup in an interactive terminal, or install using:\n')
        for (const action of result.actions) write(`  ${[action.command, ...action.args].map(arg => JSON.stringify(arg)).join(' ')}\n`)
      }
      if (!result.actions.length) write('Install or repair Git and Bash using your system package manager (Git for Windows includes Bash), then rerun openalice setup.\n')
    }
  }
  return result.status === 'ready' ? 0 : 1
}
