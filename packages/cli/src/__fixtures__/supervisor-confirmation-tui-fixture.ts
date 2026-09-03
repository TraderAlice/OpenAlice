import { resolveLaunchContext } from '../launch-context.ts'
import { runSupervisorTui } from '../supervisor-tui.ts'

const exitCode = await runSupervisorTui({}, {
  env: process.env,
  resolveContext: () => resolveLaunchContext({
    cwd: process.cwd(),
    homeDir: '/fixture',
    flags: { project: 'default', home: '/fixture/default' },
  }),
  inspect: async () => ({ class: 'absent', state: 'absent', owner: null, endpoints: {} }),
  inspectManagedSource: async () => ({
    appDir: '/fixture/managed-source',
    installRoot: '/fixture',
    repositoryUrl: 'https://github.com/TraderAlice/OpenAlice.git',
    selector: { kind: 'branch', value: 'dev' },
    state: 'absent',
  }),
  discoverUpdate: async () => null,
  pollIntervalMs: 60_000,
})

process.stdout.write('\nFIXTURE_RESULT confirmation=cancelled\n')
process.exitCode = exitCode
