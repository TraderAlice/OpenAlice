import { resolveLaunchContext } from '../launch-context.ts'
import { runSupervisorTui } from '../supervisor-tui.ts'

const checked: string[] = []

const exitCode = await runSupervisorTui({}, {
  env: process.env,
  resolveContext: () => resolveLaunchContext({
    cwd: process.cwd(),
    homeDir: '/fixture',
    flags: { project: 'default', home: '/fixture/default' },
  }),
  inspect: async () => ({ class: 'absent', state: 'absent', owner: null, endpoints: {} }),
  checkUpdate: async (channel) => {
    checked.push(channel)
    return {
      status: 'current',
      currentVersion: '0.91.0-beta.3',
      channel,
      sourceChannel: channel,
    }
  },
  discoverUpdate: async () => null,
  pollIntervalMs: 60_000,
  version: '0.91.0-beta.3',
  channel: 'beta',
})

process.stdout.write(`\nFIXTURE_RESULT checked=${checked.join(',')}\n`)
process.exitCode = exitCode
