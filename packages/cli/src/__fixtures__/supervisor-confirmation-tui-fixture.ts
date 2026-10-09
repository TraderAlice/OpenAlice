import { fixtureHome } from './fixture-home.ts'
import { resolveLaunchContext } from '../launch-context.ts'
import { runSupervisorTui } from '../supervisor-tui.ts'

const exitCode = await runSupervisorTui({}, {
  env: process.env,
  webRelay: null,
  resolveContext: () => resolveLaunchContext({
    cwd: process.cwd(),
    homeDir: `${fixtureHome}`,
    flags: { project: 'default', home: `${fixtureHome}/default` },
  }),
  inspect: async () => ({ class: 'absent', state: 'absent', owner: null, endpoints: {} }),
  inspectManagedSource: async () => ({
    appDir: `${fixtureHome}/managed-source`,
    installRoot: `${fixtureHome}`,
    repositoryUrl: 'https://github.com/TraderAlice/OpenAlice.git',
    selector: { kind: 'branch', value: 'dev' },
    state: 'absent',
  }),
  discoverUpdate: async () => null,
  pollIntervalMs: 60_000,
})

process.stdout.write('\nFIXTURE_RESULT confirmation=cancelled\n')
process.exitCode = exitCode
