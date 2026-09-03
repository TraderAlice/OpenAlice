import { resolveLaunchContext } from '../launch-context.ts'
import { runSupervisorTui } from '../supervisor-tui.ts'

let diagnoses = 0

const exitCode = await runSupervisorTui({}, {
  env: process.env,
  resolveContext: () => resolveLaunchContext({
    cwd: process.cwd(),
    homeDir: '/fixture',
    flags: { project: 'default', home: '/fixture/default' },
  }),
  inspect: async () => ({
    class: 'incompatible',
    state: 'incompatible',
    owner: null,
    endpoints: {},
  }),
  diagnose: async () => {
    diagnoses += 1
    return {
      overall: 'fail',
      summary: { passed: 0, warnings: 0, failures: 1 },
      checks: [{
        status: 'fail',
        summary: 'Fixture Runtime protocol mismatch',
        detail: 'The Launchpad Doctor fallback reached the existing diagnostic service.',
      }],
    }
  },
  discoverUpdate: async () => null,
  pollIntervalMs: 60_000,
})

process.stdout.write(`\nFIXTURE_RESULT diagnoses=${diagnoses}\n`)
process.exitCode = exitCode
